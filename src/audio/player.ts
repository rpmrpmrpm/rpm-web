// The player: the queue, what the keys do, and which track is signed and handed to the stream.

import { EQ_BANDS } from './equalizer.js';
import { ListenTally, listenCounts, type Listened } from './listen';
import type { CloudClient } from '../api/cloud';
import type { CloudStream, CloudTrack } from '../api/wire';
import { gainFor, levelOf, levelOfRecord, type Level, type NormalizeMode } from './level';
import type { Failure, WorkerTrack } from './playback.worker';
import { RESTART_AFTER_SECONDS, restored, Retries, shuffled, StartGate, Transport, type Loaded } from './queue';
import { Stream } from './stream';
import { volumeWorks, type Volume } from './volume';

// One row of the queue. A row is an object of its own, because one record can stand in the queue twice.
export interface QueueRow {
  track: CloudTrack;
}

export type Repeat = 'off' | 'all' | 'one';

const EQUALIZER_KEY = 'rpm-equalizer';
// A larger step of the playhead between two ticks is a seek, or a jump to the next audio.
const MOST_STEP_SECONDS = 2;
export const LOCK_SCREEN_ART = 512;
const SMALL = /Mobi|Android|iPhone|iPad/.test(navigator.userAgent);
const COMPUTER_RATE = 0;
const PHONE_RATE = 320;

const name = (track: CloudTrack) => track.relativePath?.split('/').pop() ?? `${track.rpmId}.flac`;

export type Signer = Pick<CloudClient, 'stream' | 'requestRendition'>;

// The opening seconds of tracks, held so a key press has something to play at once.
export interface Heads {
  held(rpmId: string): Uint8Array | null;
  warm(rpmIds: readonly string[]): void;
}

const noHeads: Heads = { held: () => null, warm: () => {} };

export interface EqualizerSettings {
  on: boolean;
  preamp: number;
  bands: number[];
}

const FLAT: EqualizerSettings = { on: false, preamp: 0, bands: EQ_BANDS.map(() => 0) };

export class Player {
  queue: QueueRow[] = [];
  index = -1;
  seconds = 0;
  duration = 0;
  loaded: Loaded = 'nothing';
  starting = false;
  // The strings.json key of what went wrong with the last track, or null.
  trouble: string | null = null;
  repeat: Repeat = 'off';
  isShuffled = false;
  normalize: NormalizeMode = 'album';
  // Called when a track starts, for what else was playing to stop.
  onStarting: () => void = () => {};
  // What the keys on the lock screen drive when it is not this.
  remote: { toggle(): void; next(): void; previous(): void } | null = null;

  private readonly audio: HTMLAudioElement;
  private readonly stream: Stream;
  private readonly gate = new StartGate();
  private readonly transport = new Transport();
  private readonly retries = new Retries();
  private readonly listeners = new Set<() => void>();
  private beforeShuffle: QueueRow[] | null = null;
  private recordLevel: Level = { lufs: null, truePeak: null };
  private readonly tally = new ListenTally();
  private listenSession = 0;
  private listenStart = 0;
  private heard = 0;
  private lastTime = 0;
  equalizer: EqualizerSettings = FLAT;
  private artworkOf = '';
  private artwork: MediaImage[] = [];
  private inAlbumOrder = true;

  // Which entry of the stream is which row. An entry is one handing of a row to the stream.
  private entries = new Map<string, QueueRow>();
  private nextEntry = 1;
  // The queue position of the last row handed to the stream. It is one ahead of the playing row once
  // the next track is in the worker's queue.
  private tail = -1;
  // The entry the playhead is on, so a track repeated with itself still counts as a crossing.
  private currentEntry: string | null = null;
  private signing = false;
  // Counts key presses that moved the queue.
  private moves = 0;
  // Set from a key press until the audio of that press is under the playhead.
  private settling = false;

  constructor(
    private readonly cloud: Signer,
    private readonly sound: Volume,
    private readonly findArtwork: (track: CloudTrack) => Promise<string | null> = async () => null,
    private readonly listened: (rpmId: string) => void = () => {},
    private readonly heads: Heads = noHeads,
  ) {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.setAttribute('playsinline', '');
    sound.drive(this.audio);
    sound.onChange(() => this.changed());

    this.stream = new Stream(this.audio, {
      arrived: () => this.arrived(),
      drained: () => void this.onDrained(),
      failed: (failure) => void this.onFailed(failure),
      tick: () => this.onTick(),
      ended: () => this.onEnded(),
      broken: (said) => this.onBroken(said),
    });

    this.audio.addEventListener('playing', () => this.setLoaded('playing'));
    this.audio.addEventListener('pause', () => {
      if (this.loaded === 'playing') this.setLoaded('paused');
    });
    this.controls();
    this.equalizer = this.storedEqualizer();
    if (this.equalizer.on) this.sendEqualizer();
  }

  private storedEqualizer(): EqualizerSettings {
    try {
      const stored = JSON.parse(localStorage.getItem(EQUALIZER_KEY) ?? 'null') as EqualizerSettings | null;
      return stored && stored.bands?.length === EQ_BANDS.length ? stored : FLAT;
    } catch {
      return FLAT;
    }
  }

  private sendEqualizer() {
    const { on, preamp, bands } = this.equalizer;
    this.stream.setEqualizer(on ? preamp : 0, on ? bands : FLAT.bands);
  }

  // What is buffered was made with the old curve, so the track is opened again from where it is.
  setEqualizer(settings: EqualizerSettings) {
    this.equalizer = settings;
    try {
      localStorage.setItem(EQUALIZER_KEY, JSON.stringify(settings));
    } catch {
      // The curve holds until the page closes.
    }
    this.sendEqualizer();
    if (this.stream.isOpen && this.index >= 0) this.moveTo(this.index, this.seconds);
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed() {
    for (const listener of this.listeners) listener();
  }

  get current(): CloudTrack | null {
    return this.queue[this.index]?.track ?? null;
  }

  // Stopped, and not paused: the queue stays where it was, and the art band closes.
  stopped = false;

  // What the play key shows: what the listener asked for.
  get wantsToPlay(): boolean {
    return this.transport.wantsToPlay(this.starting, this.loaded);
  }

  get volume(): number {
    return this.sound.level;
  }

  get volumeWorks(): boolean {
    return volumeWorks(this.audio);
  }

  // The one level, which the radio follows too. See Volume.
  setVolume(level: number) {
    this.sound.set(level);
  }

  toggleMute() {
    this.sound.toggleMute();
  }

  private setLoaded(loaded: Loaded) {
    this.loaded = loaded;
    this.publishSession();
    this.changed();
  }

  private gainOf(track: CloudTrack): number {
    return gainFor(this.normalize, this.inAlbumOrder, levelOf(track), this.recordLevel);
  }

  private async sign(row: QueueRow, signal?: AbortSignal): Promise<CloudStream> {
    return this.cloud.stream(row.track.rpmId, SMALL ? PHONE_RATE : COMPUTER_RATE, signal);
  }

  private entryOf(row: QueueRow, url?: string, startAt?: number, head?: Uint8Array): WorkerTrack {
    const id = `entry-${this.nextEntry++}`;
    this.entries.set(id, row);
    return { id, name: name(row.track), url, gain: this.gainOf(row.track), startAt, head };
  }

  // Plays these tracks from this position. Runs inside the key press up to the first await, because a
  // browser allows play() only there.
  play(tracks: readonly CloudTrack[], index: number, options: { inAlbumOrder: boolean } = { inAlbumOrder: true }) {
    this.queue = tracks.map((track) => ({ track }));
    this.beforeShuffle = null;
    this.isShuffled = false;
    this.inAlbumOrder = options.inAlbumOrder;
    this.recordLevel = options.inAlbumOrder ? levelOfRecord(tracks) : { lufs: null, truePeak: null };
    this.moveTo(index);
    this.heads.warm(tracks.slice(index).map((track) => track.rpmId));
  }

  // These tracks straight after the one playing. The next track is usually in the worker's queue already, and it
  // waits its turn behind them: it is taken back, unless it has started.
  async playNext(tracks: readonly CloudTrack[]) {
    if (!tracks.length) return;
    if (!this.current || this.stopped) {
      this.play(tracks, 0, { inAlbumOrder: false });
      return;
    }
    const moves = this.moves;
    const taken = this.tail > this.index ? await this.stream.withdraw() : 0;
    if (moves !== this.moves) return;
    if (taken) this.tail = this.index;
    this.waitingLive = null;
    this.insert(tracks, this.tail + 1);
  }

  // These tracks at the end of the queue. With nothing playing they start.
  addToQueue(tracks: readonly CloudTrack[]) {
    if (!tracks.length) return;
    if (!this.current || this.stopped) this.play(tracks, 0, { inAlbumOrder: false });
    else this.insert(tracks, this.queue.length);
  }

  private insert(tracks: readonly CloudTrack[], at: number) {
    const rows = tracks.map((track) => ({ track }));
    this.queue = [...this.queue.slice(0, at), ...rows, ...this.queue.slice(at)];
    this.beforeShuffle?.push(...rows);
    this.inAlbumOrder = false;
    this.requeue();
    void this.handAfterTail();
  }

  // Starts the row at this position, whatever was playing.
  private moveTo(index: number, startAt?: number) {
    const row = this.queue[index];
    if (!row) return;

    this.onStarting();
    this.stopped = false;
    this.moves++;
    this.listenSession++;
    this.listenStart = startAt ?? 0;
    this.heard = 0;
    this.waitingLive = null;
    this.index = index;
    this.seconds = startAt ?? 0;
    this.duration = row.track.tags?.durationSeconds ?? 0;
    this.trouble = null;
    this.starting = true;
    this.settling = true;
    this.tail = index;
    this.currentEntry = null;
    this.loaded = 'nothing';
    this.transport.starting();
    this.retries.forget();

    const attempt = this.gate.begin();

    const opening = !this.stream.isOpen;
    if (opening) {
      this.setAudioSession();
      this.stream.open();
    } else {
      // The old track stops at once. The element stays playing, because a locked phone could not start
      // it again, so it is silenced until the new audio is under the playhead. A first start has nothing
      // to silence, and on an iPhone it has to be audible for the tap to count.
      this.audio.muted = true;
    }
    void this.audio.play().catch((error: unknown) => {
      // Replaced by a later play is nothing. Refused means the audio arrives paused, with the key showing
      // Play, because a press is what it needs.
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        this.transport.pause(this.starting, this.loaded);
        this.changed();
      }
    });

    this.publishSession();
    this.changed();

    void this.handOver(row, attempt, opening, startAt);
  }

  // A track with a head clip starts on it at once, and the stream is joined behind it when it has been signed. The
  // clip is three seconds to do that in. A key press into the middle of a track has no use for one.
  private async handOver(row: QueueRow, attempt: ReturnType<StartGate['begin']>, opening: boolean, startAt?: number) {
    const head = startAt ? null : this.heads.held(row.track.rpmId);
    const started = head ? this.entryOf(row, undefined, undefined, head) : null;
    if (started) {
      if (opening) this.stream.add(started);
      else this.stream.replace([started]);
    }

    let signed: CloudStream;
    try {
      signed = await this.sign(row, attempt.signal);
    } catch (error) {
      if (attempt.isLive) this.cannotPlay(error);
      return;
    }
    if (!attempt.isLive) return;

    if (started) {
      this.stream.join(started.id, signed.url);
    } else {
      const entry = this.entryOf(row, signed.url, startAt);
      if (opening) this.stream.add(entry);
      else this.stream.replace([entry]);
    }

    void this.handAfterTail();
  }

  private cannotPlay(error: unknown) {
    this.starting = false;
    this.settling = false;
    this.audio.muted = false;
    this.trouble = error instanceof DOMException ? null : 'Rpm_Playback_Unreachable';
    this.changed();
  }

  // A pause pressed before the audio arrived is applied here, before anything is heard.
  private arrived() {
    if (this.transport.arrives()) this.settled('paused');
  }

  // The audio of the last key press is under the playhead.
  private settled(loaded: Loaded) {
    this.settling = false;
    this.starting = false;
    if (loaded === 'paused') this.audio.pause();
    this.audio.muted = false;
    this.setLoaded(loaded);
  }

  // Which position comes after this one, with repeat. Null at the end of the queue.
  private after(index: number): number | null {
    if (this.repeat === 'one') return index;
    if (index + 1 < this.queue.length) return index + 1;
    return this.repeat === 'all' && this.queue.length > 0 ? 0 : null;
  }

  // Keeps the next track in the worker's queue, so the join is written before the playhead needs it.
  // Signing looks ahead. Opening does not, for a live transcode: it cannot be stopped once opened, so
  // that track is filed for a stored copy and handed over only when the stream runs dry.
  private async handAfterTail(): Promise<void> {
    if (this.signing || this.tail < 0) return;

    const position = this.after(this.tail);
    if (position === null) return;

    const row = this.queue[position]!;
    const moves = this.moves;
    this.signing = true;
    try {
      const signed = await this.sign(row);

      // A key press while signing: this hand-over was for a position that is gone.
      if (moves !== this.moves) return;

      if (signed.live) {
        void this.cloud.requestRendition([row.track.rpmId], signed.kilobits).catch(() => {});
        this.waitingLive = { row, position, url: signed.url };
        return;
      }
      this.tail = position;
      this.stream.add(this.entryOf(row, signed.url));
    } catch {
      // The track is signed again when it is reached.
    } finally {
      this.signing = false;
    }
  }

  private waitingLive: { row: QueueRow; position: number; url: string } | null = null;

  private async onDrained() {
    const waiting = this.waitingLive;
    if (waiting) {
      this.waitingLive = null;
      this.tail = waiting.position;
      this.stream.add(this.entryOf(waiting.row, waiting.url));
      return;
    }
    if (this.signing) return;
    if (this.after(this.tail) === null) this.stream.finish();
    else await this.handAfterTail();
  }

  // A read failed. The track is signed again and opened where it stopped, so a dropped connection is a
  // short pause and not a skip. Failures of an old queue are dropped by the stream's epoch.
  private async onFailed(failure: Failure) {
    const row = this.entries.get(failure.id);
    if (!row) return;

    if (this.retries.mayRetry(row.track.rpmId)) {
      try {
        const signed = await this.sign(row);
        this.stream.add(this.entryOf(row, signed.url, failure.at), true);
        return;
      } catch {
        // Falls through to moving on.
      }
    }

    // Out of goes. The queue carries on after this row, wherever it stands. If nothing was ever heard
    // of it, the listener still needs to hear what follows, so the start is finished here too.
    this.trouble = 'Rpm_Playback_Unreachable';
    this.tail = this.queue.indexOf(row);
    this.changed();
    await this.onDrained();
  }

  private onTick() {
    const now = this.stream.now();
    if (!now) return;

    const row = this.entries.get(now.id);
    if (!row) return;

    if (this.settling) {
      // A failed track was skipped during the start, so the playhead may be on a later row.
      if (this.queue.indexOf(row) < this.index) return;
      this.settled(this.transport.arrives() ? 'paused' : 'playing');
    }

    // The playhead crossed into the next entry.
    if (now.id !== this.currentEntry) {
      const crossed = this.currentEntry !== null;
      this.currentEntry = now.id;
      this.listenSession++;
      this.listenStart = 0;
      this.heard = 0;
      const position = this.queue.indexOf(row);
      if (position >= 0) this.index = position;
      if (crossed) this.retries.forget();
      if (this.tail === this.index) void this.handAfterTail();
      this.publishSession();
    }

    this.seconds = now.seconds;
    this.duration = row.track.tags?.durationSeconds || now.duration;
    this.countListening(row.track.rpmId);
    this.publishPosition();
    this.changed();
  }

  // Time heard, not position: a seek is not listening, and neither is the audio sitting paused.
  private countListening(rpmId: string) {
    const time = this.audio.currentTime;
    const step = time - this.lastTime;
    this.lastTime = time;
    if (step > 0 && step < MOST_STEP_SECONDS && !this.audio.paused) this.heard += step;
    this.reportListen(this.tally.read(rpmId, this.listenSession, this.listenStart, this.heard, this.duration));
  }

  private reportListen(done: Listened | null) {
    if (done && listenCounts(done.heardSeconds, done.lengthSeconds)) this.listened(done.track);
  }

  private onEnded() {
    this.reportListen(this.tally.settle());
    this.loaded = 'nothing';
    this.starting = false;
    this.stopped = true;
    this.changed();
  }

  private onBroken(said: string) {
    console.error('playback:', said);
    this.trouble = 'Rpm_Playback_Unreachable';
    this.starting = false;
    this.settling = false;
    this.audio.muted = false;
    this.changed();
  }

  toggle() {
    switch (this.transport.toggle(this.starting, this.loaded)) {
      case 'pause':
        this.audio.pause();
        break;
      case 'resume':
        void this.audio.play();
        break;
      case 'remember':
      case 'forget':
      case 'nothing':
        this.changed();
    }
  }

  next() {
    const position = this.index + 1 < this.queue.length ? this.index + 1 : this.repeat === 'all' ? 0 : null;
    if (position !== null) this.moveTo(position);
  }

  previous() {
    if (this.seconds > RESTART_AFTER_SECONDS || this.index === 0) this.seek(0);
    else this.moveTo(this.index - 1);
  }

  // Inside the buffer the playhead just moves. Past it the track is opened at that place.
  seek(seconds: number) {
    const row = this.queue[this.index];
    if (!row) return;

    const entry = [...this.entries].reverse().find(([, value]) => value === row)?.[0];
    const time = entry ? this.stream.bufferedTime(entry, seconds) : null;
    if (time !== null) {
      this.audio.currentTime = time;
      this.seconds = seconds;
      this.changed();
      return;
    }
    this.moveTo(this.index, seconds);
  }

  // The stop key: back to the start of this track, paused.
  stop() {
    if (this.index < 0) return;
    this.moveTo(this.index);
    this.transport.pause(true, 'nothing');
    this.stopped = true;
    this.changed();
  }

  toggleShuffle() {
    if (this.beforeShuffle) {
      this.queue = restored(this.queue, this.index, this.beforeShuffle);
      this.beforeShuffle = null;
      this.isShuffled = false;
    } else {
      this.beforeShuffle = [...this.queue];
      this.queue = shuffled(this.queue, this.index);
      this.isShuffled = true;
      this.inAlbumOrder = false;
    }
    this.requeue();
  }

  cycleRepeat() {
    this.repeat = this.repeat === 'off' ? 'all' : this.repeat === 'all' ? 'one' : 'off';
    this.requeue();
  }

  // What follows the current track changed. What is already in the buffer stays, and the next hand-over
  // reads the new order.
  private requeue() {
    this.changed();
  }

  private publishSession() {
    if (!('mediaSession' in navigator)) return;
    const track = this.current;
    if (track) this.wantArtwork(track);
    navigator.mediaSession.metadata = track
      ? new MediaMetadata({ title: track.title ?? '', artist: track.artist ?? '', album: track.album ?? '', artwork: this.artwork })
      : null;
    navigator.mediaSession.playbackState = this.wantsToPlay ? 'playing' : 'paused';
  }

  // The lock screen's picture. It comes later than the words, and only for the track still playing.
  private wantArtwork(track: CloudTrack) {
    if (this.artworkOf === track.rpmId) return;
    this.artworkOf = track.rpmId;
    this.artwork = [];
    void this.findArtwork(track)
      .then((url) => {
        if (!url || this.artworkOf !== track.rpmId) return;
        this.artwork = [{ src: url, sizes: `${LOCK_SCREEN_ART}x${LOCK_SCREEN_ART}` }];
        this.publishSession();
      })
      .catch(() => {
        // The lock screen shows the words alone.
      });
  }

  private setAudioSession() {
    const audio = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (audio) audio.type = 'playback';
  }

  private publishPosition() {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState || !this.duration) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: this.duration,
        position: Math.min(this.seconds, this.duration),
        playbackRate: 1,
      });
      // After setPositionState, or the next, previous and scrubber controls go missing on iPhone.
      navigator.mediaSession.playbackState = this.wantsToPlay ? 'playing' : 'paused';
    } catch {
      // A bad value is not worth stopping for.
    }
  }

  private controls() {
    if (!('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    session.setActionHandler('play', () => (this.remote ?? this).toggle());
    session.setActionHandler('pause', () => (this.remote ?? this).toggle());
    session.setActionHandler('nexttrack', () => (this.remote ?? this).next());
    session.setActionHandler('previoustrack', () => (this.remote ?? this).previous());
    session.setActionHandler('seekto', (details) => {
      if (details.seekTime !== undefined) this.seek(details.seekTime);
    });
  }
}
