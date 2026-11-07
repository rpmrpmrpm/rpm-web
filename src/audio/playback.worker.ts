// Runs the chain away from the page, so decoding never holds up the interface. It handles one message
// at a time, so a render finishes before a stop is read.

// @ts-expect-error chain.js is plain JavaScript, shared with the tests that run in Node.
import { Chain, FileSource, UrlSource } from './chain.js';

export interface WorkerTrack {
  id: string;
  name: string;
  url?: string;
  file?: File;
  gain: number;
  startAt?: number;
}

export type ToWorker =
  | { type: 'start'; epoch: number }
  | { type: 'add'; track: WorkerTrack; first: boolean }
  | { type: 'render'; epoch: number; seconds: number }
  | { type: 'stop'; epoch: number }
  | { type: 'finish'; epoch: number }
  | { type: 'equalizer'; preamp: number; bands: number[] };

export type FromWorker =
  | { type: 'ready' }
  | { type: 'bytes'; epoch: number; bytes: Uint8Array; drained: boolean; failed: boolean; boundaries: Boundary[]; failures: Failure[] }
  | { type: 'stopped'; epoch: number; at: number }
  | { type: 'finished'; epoch: number; bytes: Uint8Array }
  | { type: 'error'; said: string };

export interface Boundary {
  id: string;
  name: string;
  at: number;
  offset: number;
  duration: number;
}

export interface Failure {
  id: string;
  name: string;
  said: string;
  at: number;
}

// Vite must not bundle this: it is the compiled module, served as it is from /media.
const module = new URL('/media/rpm-media.js', self.location.origin).href;
const { default: createRpmMedia } = await import(/* @vite-ignore */ module);
const media = await createRpmMedia();

let chain: InstanceType<typeof Chain> | null = null;
let epoch = 0;
let failuresSent = 0;
// A curve set before the chain exists is applied when it does.
let pendingEqualizer: { preamp: number; bands: number[] } | null = null;
let boundariesSent = 0;

function post(message: FromWorker, transfer: Transferable[] = []) {
  postMessage(message, { transfer });
}

function sendBytes(result: { bytes: Uint8Array; drained: boolean; failed: boolean }) {
  post(
    {
      type: 'bytes',
      epoch,
      bytes: result.bytes,
      drained: result.drained,
      failed: result.failed,
      boundaries: chain.boundaries.slice(boundariesSent),
      failures: chain.failures.slice(failuresSent),
    },
    [result.bytes.buffer as ArrayBuffer],
  );
  boundariesSent = chain.boundaries.length;
  failuresSent = chain.failures.length;
}

const STREAM_RATE = 44100;

const handlers = {
  start(message: { epoch: number }) {
    chain?.close();
    chain = new Chain(media);
    if (pendingEqualizer) chain.equalizer.setGains(pendingEqualizer.preamp, pendingEqualizer.bands);
    epoch = message.epoch;
    failuresSent = 0;
    boundariesSent = 0;
    // The init segment, on its own, so the page can make its buffer before any audio arrives.
    sendBytes({ bytes: chain.take(), drained: false, failed: false });
  },

  add({ track, first }: { track: WorkerTrack; first: boolean }) {
    const entry = { ...track, makeSource: () => (track.file ? new FileSource(track.file) : new UrlSource(track.url)) };
    if (first) chain.addFirst(entry);
    else chain.add(entry);
  },

  render({ seconds, epoch: asked }: { seconds: number; epoch: number }) {
    // A render asked for before a stop has nothing to do with what is playing now.
    if (asked === epoch) sendBytes(chain.render(seconds));
  },

  stop(message: { epoch: number }) {
    chain.stop();
    epoch = message.epoch;
    post({ type: 'stopped', epoch, at: chain.framesWritten / STREAM_RATE });
  },

  equalizer(message: { preamp: number; bands: number[] }) {
    pendingEqualizer = message;
    if (chain) chain.equalizer.setGains(message.preamp, message.bands);
  },

  finish(message: { epoch: number }) {
    if (message.epoch !== epoch) return;
    const bytes: Uint8Array = chain.finish();
    post({ type: 'finished', epoch, bytes }, [bytes.buffer as ArrayBuffer]);
  },
};

self.onmessage = ({ data }: MessageEvent<ToWorker>) => {
  try {
    (handlers[data.type] as (message: ToWorker) => void)(data);
  } catch (error) {
    post({ type: 'error', said: String(error) });
  }
};

post({ type: 'ready' });
