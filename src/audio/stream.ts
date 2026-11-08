// The stream: one MediaSource and one audio element, fed by the worker. The whole queue is one
// continuous stream, because a locked iPhone cannot start a new track. The next track is written into
// the stream that is already playing.

// @ts-expect-error chain.js is plain JavaScript, shared with the tests that run in Node.
import { STREAM_TYPES } from './chain.js';
import type { Boundary, Failure, FromWorker, ToWorker, WorkerTrack } from './playback.worker';

const small = /Mobi|Android|iPhone|iPad/.test(navigator.userAgent);

// A few seconds ahead on a computer, so an EQ change is heard soon. More on a phone, so a locked phone
// stays ahead. The browser's own limit is below this on an iPhone.
const AHEAD_SECONDS = small ? 90 : 12;
const RENDER_SECONDS = 4;

// Below this much audio, the stream asks for more even if ManagedMediaSource has said to stop.
const LOW_SECONDS = 10;

// A browser limits a seek to the duration, so a duration that follows the buffer would stop a key press
// from jumping ahead. The real length is set when the queue ends.
const OPEN_DURATION = 7 * 24 * 3600;

type SourceClass = typeof MediaSource;
const MediaSourceType: SourceClass | undefined =
  (window as unknown as { ManagedMediaSource?: SourceClass }).ManagedMediaSource ?? window.MediaSource;
const managed = 'ManagedMediaSource' in window;
const streamType: string | undefined = (STREAM_TYPES as string[]).find((type) => MediaSourceType?.isTypeSupported(type));

export const streamSupported = !!streamType;

export interface StreamEvents {
  // The first audio of the stream can play, and has not started.
  arrived(): void;
  // The worker has run out of tracks.
  drained(): void;
  failed(failure: Failure): void;
  // The playhead moved. Called often.
  tick(): void;
  // The stream played to its end.
  ended(): void;
  // The stream itself broke, which no retry of a track can mend.
  broken(said: string): void;
}

type BufferOperation = { kind: 'append'; bytes: Uint8Array } | { kind: 'remove'; from: number; to: number };

export class Stream {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private source: MediaSource | null = null;
  private buffer: SourceBuffer | null = null;
  private operations: BufferOperation[] = [];
  private boundaries: Boundary[] = [];
  private epoch = 0;
  private rendering = false;
  private drained = false;
  private finished = false;
  private started = false;
  private outbox: ToWorker[] = [];
  // A track was added while a render was out. That render's "drained" was said of a queue that has grown since,
  // so it is not passed on.
  private addedWhileRendering = false;
  private answerWithdrawn: ((count: number) => void) | null = null;
  // The stream time the playhead is moving to after a key press. Until it gets there, the boundary
  // table says nothing true about what is playing.
  private jumpTo: number | null = null;

  constructor(
    private readonly audio: HTMLAudioElement,
    private readonly events: StreamEvents,
  ) {
    audio.addEventListener('timeupdate', () => {
      this.pull();
      this.landJump();
      this.events.tick();
    });
    // A playhead with nothing to play sends no timeupdate, so these have to ask for more.
    audio.addEventListener('waiting', () => this.pull());
    audio.addEventListener('seeking', () => this.pull());
    audio.addEventListener('loadeddata', () => this.events.arrived());
    audio.addEventListener('ended', () => this.events.ended());
    audio.addEventListener('error', () => this.events.broken(audio.error?.message ?? 'The audio element failed.'));
  }

  // Tracks can be ready before the buffer and the worker are. They wait here, in order.
  private send(message: ToWorker) {
    if (this.started) this.worker!.postMessage(message);
    else this.outbox.push(message);
  }

  private startWorker(): Promise<void> {
    this.ready ??= new Promise((done) => {
      this.worker = new Worker(new URL('./playback.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onerror = (event) => this.events.broken(event.message);
      this.worker.onmessage = ({ data }: MessageEvent<FromWorker>) => {
        if (data.type === 'ready') done();
        else this.received(data);
      };
    });
    return this.ready;
  }

  // Runs inside the key press, because a browser allows play() only there. The audio arrives later.
  open() {
    if (!MediaSourceType || !streamType) throw new Error('This browser cannot play the stream.');

    this.operations = [];
    this.boundaries = [];
    this.epoch++;
    this.rendering = false;
    this.addedWhileRendering = false;
    this.drained = false;
    this.finished = false;
    this.jumpTo = null;
    this.buffer = null;
    this.started = false;
    this.outbox = [];

    const source = new MediaSourceType();
    this.source = source;
    if (managed) {
      source.addEventListener('startstreaming', () => this.pull());
    }
    this.audio.disableRemotePlayback = true;
    this.audio.src = URL.createObjectURL(source);

    const epoch = this.epoch;
    source.addEventListener(
      'sourceopen',
      async () => {
        source.duration = OPEN_DURATION;
        this.buffer = source.addSourceBuffer(streamType);
        this.buffer.addEventListener('updateend', () => this.nextOperation());
        await this.startWorker();
        if (epoch !== this.epoch) return;

        this.worker!.postMessage({ type: 'start', epoch } satisfies ToWorker);
        this.started = true;
        for (const message of this.outbox) this.worker!.postMessage(message);
        this.outbox = [];
        this.pull();
      },
      { once: true },
    );
  }

  get isOpen(): boolean {
    return this.source !== null && !this.finished;
  }

  // Kept by the worker, so it holds for every stream after this one too.
  setEqualizer(preamp: number, bands: number[]) {
    void this.startWorker().then(() => this.worker!.postMessage({ type: 'equalizer', preamp, bands } satisfies ToWorker));
  }

  add(track: WorkerTrack, first = false) {
    this.send({ type: 'add', track, first });
    if (this.rendering) this.addedWhileRendering = true;
    this.drained = false;
    this.pull();
  }

  // Takes back the tracks the worker has not started. The answer is how many there were.
  withdraw(): Promise<number> {
    return new Promise((done) => {
      this.answerWithdrawn = done;
      this.send({ type: 'withdraw' });
    });
  }

  // A key press: everything ahead of the playhead goes, and these tracks follow. The stream's clock
  // runs on, so the playhead jumps to the time the new audio starts at.
  replace(tracks: WorkerTrack[]) {
    this.epoch++;
    this.rendering = false;
    this.addedWhileRendering = false;
    this.drained = false;
    this.operations = [];
    this.send({ type: 'stop', epoch: this.epoch });
    for (const track of tracks) this.send({ type: 'add', track, first: false });
  }

  finish() {
    this.send({ type: 'finish', epoch: this.epoch });
  }

  private received(data: FromWorker) {
    if (data.type === 'error') {
      this.rendering = false;
      this.events.broken(data.said);
      return;
    }
    if (data.type === 'ready') return;
    if (data.type === 'withdrawn') {
      this.answerWithdrawn?.(data.count);
      this.answerWithdrawn = null;
      return;
    }

    // Audio of what was playing before the last key press.
    if (data.epoch !== this.epoch) return;

    switch (data.type) {
      case 'bytes':
        this.rendering = false;
        this.boundaries.push(...data.boundaries);
        if (data.bytes.length > 0) this.operate({ kind: 'append', bytes: data.bytes });
        for (const failure of data.failures) this.events.failed(failure);
        if (data.drained && !this.addedWhileRendering) {
          this.drained = true;
          this.events.drained();
        }
        this.addedWhileRendering = false;
        this.pull();
        break;

      case 'stopped':
        this.jumpTo = data.at;
        this.operate({ kind: 'remove', from: Math.min(this.audio.currentTime, data.at), to: OPEN_DURATION });
        this.pull();
        break;

      case 'finished':
        this.finished = true;
        if (data.bytes.length > 0) this.operate({ kind: 'append', bytes: data.bytes });
        else this.nextOperation();
        break;
    }
  }

  private operate(operation: BufferOperation) {
    this.operations.push(operation);
    this.nextOperation();
  }

  private nextOperation() {
    const buffer = this.buffer;
    if (!buffer || buffer.updating) return;

    const operation = this.operations[0];
    if (!operation) {
      if (this.finished && this.source?.readyState === 'open') this.source.endOfStream();
      this.landJump();
      this.pull();
      return;
    }

    try {
      if (operation.kind === 'remove') {
        this.operations.shift();
        if (operation.to > operation.from) buffer.remove(operation.from, operation.to);
        else this.nextOperation();
        return;
      }

      buffer.appendBuffer(operation.bytes as BufferSource);
      this.operations.shift();
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'QuotaExceededError') {
        this.events.broken(String(error));
        return;
      }
      // The browser holds no more. Played audio goes, and the same bytes are tried again.
      const keepFrom = this.audio.currentTime - 2;
      if (buffer.buffered.length > 0 && keepFrom > buffer.buffered.start(0)) buffer.remove(0, keepFrom);
    }
  }

  private bufferEnd(): number {
    const ranges = this.buffer?.buffered;
    return ranges && ranges.length > 0 ? ranges.end(ranges.length - 1) : 0;
  }

  // Moves the playhead to the new audio as soon as the buffer holds it.
  private landJump() {
    if (this.jumpTo === null) return;
    if (this.bufferEnd() <= this.jumpTo) return;
    if (this.audio.currentTime >= this.jumpTo) {
      this.jumpTo = null;
      return;
    }
    this.audio.currentTime = this.jumpTo;
  }

  // The worker makes only what the buffer has room for, so the stream sets the pace.
  private pull() {
    if (!this.started || !this.buffer || this.rendering || this.drained || this.finished) return;
    if (this.operations.length > 0 || this.buffer.updating) return;

    const start = this.jumpTo ?? this.audio.currentTime;
    const ahead = this.bufferEnd() - start;
    if (ahead >= AHEAD_SECONDS) return;
    if (managed && (this.source as unknown as { streaming?: boolean }).streaming === false && ahead > LOW_SECONDS) return;

    this.rendering = true;
    this.send({ type: 'render', epoch: this.epoch, seconds: RENDER_SECONDS });
  }

  // What the playhead is on, from the boundary table. Null until the audio of a key press has landed.
  now(): { id: string; seconds: number; duration: number } | null {
    if (this.jumpTo !== null) return null;
    const time = this.audio.currentTime;
    let found: Boundary | undefined;
    for (const boundary of this.boundaries) {
      if (boundary.at <= time + 0.01) found = boundary;
      else break;
    }
    return found ? { id: found.id, seconds: time - found.at + found.offset, duration: found.duration } : null;
  }

  // The stream time of a position in the entry that is playing, if that part is in the buffer. A seek
  // inside the buffer needs no new audio.
  bufferedTime(id: string, seconds: number): number | null {
    const entries = this.boundaries.filter((b) => b.id === id);
    const entry = entries[entries.length - 1];
    if (!entry) return null;
    const time = entry.at + seconds - entry.offset;
    const ranges = this.buffer?.buffered;
    if (!ranges) return null;
    for (let i = 0; i < ranges.length; i++) {
      if (time >= ranges.start(i) && time < ranges.end(i) - 0.5) return time;
    }
    return null;
  }
}
