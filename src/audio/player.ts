// The player: the queue, what the keys do, and which track is signed and handed to the stream.

import type { CloudClient } from '../api/cloud';
import type { CloudStream, CloudTrack } from '../api/wire';
import { gainFor, levelOf, levelOfRecord, type Level, type NormalizeMode } from './level';
import type { Failure, WorkerTrack } from './playback.worker';
import { RESTART_AFTER_SECONDS, restored, Retries, shuffled, StartGate, Transport, type Loaded } from './queue';
import { Stream } from './stream';

// One row of the queue. A row is an object of its own, because one record can stand in the queue twice.
export interface QueueRow {
  track: CloudTrack;
}

export type Repeat = 'off' | 'all' | 'one';

const VOLUME_KEY = 'rpm-volume';
const SMALL = /Mobi|Android|iPhone|iPad/.test(navigator.userAgent);
const COMPUTER_RATE = 0;
const PHONE_RATE = 320;

const name = (track: CloudTrack) => track.relativePath?.split('/').pop() ?? `${track.rpmId}.flac`;

export type Signer = Pick<CloudClient, 'stream' | 'requestRendition'>;

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

  private readonly audio: HTMLAudioElement;
  private readonly stream: Stream;
  private readonly gate = new StartGate();
  private readonly transport = new Transport();
  private readonly retries = new Retries();
  private readonly listeners = new Set<() => void>();
  private beforeShuffle: QueueRow[] | null = null;
  private recordLevel: Level = { lufs: null, truePeak: null };
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

  constructor(private readonly cloud: Signer) {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.setAttribute('playsinline', '');
    this.audio.volume = this.storedVolume();

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

  // What the play key shows: what the listener asked for.
  get wantsToPlay(): boolean {
    return this.transport.wantsToPlay(this.starting, this.loaded);
  }

  get volume(): number {
    return this.audio.volume;
  }

  // iOS ignores element.volume, so its slider would do nothing. The hardware keys set the level there.
  get volumeWorks(): boolean {
    const before = this.audio.volume;
    this.audio.volume = before > 0.5 ? before - 0.1 : before + 0.1;
    const works = this.audio.volume !== before;
    this.audio.volume = before;
    return works;
  }

  setVolume(level: number) {
    this.audio.volume = Math.min(Math.max(level, 0), 1);
    try {
      localStorage.setItem(VOLUME_KEY, String(this.audio.volume));
    } catch {
      // The level holds until the page closes.
    }
    this.changed();
  }

  private storedVolume(): number {
    try {
      const stored = Number(localStorage.getItem(VOLUME_KEY));
      return stored > 0 && stored <= 1 ? stored : 1;
    } catch {
      return 1;
    }
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

  private entryOf(row: QueueRow, url: string, startAt?: number): WorkerTrack {
    const id = `entry-${this.nextEntry++}`;
    this.entries.set(id, row);
    return { id, name: name(row.track), url, gain: this.gainOf(row.track), startAt };
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
  }

  // Starts the row at this position, whatever was playing.
  private moveTo(index: number, startAt?: number) {
    const row = this.queue[index];
    if (!row) return;

    this.moves++;
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
    if (opening) this.stream.open();

    // The old track stops at once. The element stays playing, because a locked phone could not start
    // it again, so it is silenced until the new audio is under the playhead.
    this.audio.muted = true;
    void this.audio.play().catch(() => {
      // Refused until a key is pressed, or replaced by a later play. Neither is a failure of the track.
    });

    this.publishSession();
    this.changed();

    void this.handOver(row, attempt, opening, startAt);
  }

  private async handOver(row: QueueRow, attempt: ReturnType<StartGate['begin']>, opening: boolean, startAt?: number) {
    let signed: CloudStream;
    try {
      signed = await this.sign(row, attempt.signal);
    } catch (error) {
      if (attempt.isLive) this.cannotPlay(error);
      return;
    }
    if (!attempt.isLive) return;

    const entry = this.entryOf(row, signed.url, startAt);
    if (opening) this.stream.add(entry);
    else this.stream.replace([entry]);

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
      const position = this.queue.indexOf(row);
      if (position >= 0) this.index = position;
      if (crossed) this.retries.forget();
      if (this.tail === this.index) void this.handAfterTail();
      this.publishSession();
    }

    this.seconds = now.seconds;
    this.duration = row.track.tags?.durationSeconds || now.duration;
    this.publishPosition();
    this.changed();
  }

  private onEnded() {
    this.loaded = 'nothing';
    this.starting = false;
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
    navigator.mediaSession.metadata = track
      ? new MediaMetadata({ title: track.title ?? '', artist: track.artist ?? '', album: track.album ?? '' })
      : null;
    navigator.mediaSession.playbackState = this.wantsToPlay ? 'playing' : 'paused';
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
    session.setActionHandler('play', () => this.toggle());
    session.setActionHandler('pause', () => this.toggle());
    session.setActionHandler('nexttrack', () => this.next());
    session.setActionHandler('previoustrack', () => this.previous());
    session.setActionHandler('seekto', (details) => {
      if (details.seekTime !== undefined) this.seek(details.seekTime);
    });
    const audio = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (audio) audio.type = 'playback';
  }
}
