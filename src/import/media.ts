// Calls to the import worker, as promises.

import type { ArtBytes, Fingerprint, Loudness, ToImportWorker } from './import.worker';
import type { TrackTags } from './queue';

type Message = ToImportWorker extends infer M ? (M extends { id: number } ? Omit<M, 'id'> : never) : never;

export interface ImportMedia {
  tags(file: File): Promise<{ tags: TrackTags; hasArt: boolean }>;
  art(file: File): Promise<ArtBytes | null>;
  canonical(file: File, extension: string): Promise<{ bytes: Uint8Array; sha256: string }>;
  loudness(file: File): Promise<Loudness | null>;
  fingerprint(file: File): Promise<Fingerprint>;
  clip(file: File, kilobits: number, start: number, seconds: number): Promise<Uint8Array>;
  renditions(file: File, kilobits: number, headKilobits: number, headSeconds: number): Promise<{ head: Uint8Array; rendition: Uint8Array }>;
}

export class WorkerMedia implements ImportMedia {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 1;
  private readonly waiting = new Map<number, { done: (value: never) => void; fail: (error: Error) => void }>();

  private start(): Promise<void> {
    this.ready ??= new Promise((ready, failed) => {
      this.worker = new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onerror = (event) => failed(new Error(event.message));
      this.worker.onmessage = ({ data }) => {
        if (data.ready) return ready();
        const call = this.waiting.get(data.id);
        this.waiting.delete(data.id);
        if (data.error !== undefined) call?.fail(new Error(data.error));
        else call?.done(data.result as never);
      };
    });
    return this.ready;
  }

  private async call<T>(message: Message): Promise<T> {
    await this.start();
    const id = this.nextId++;
    return new Promise<T>((done, fail) => {
      this.waiting.set(id, { done: done as (value: never) => void, fail });
      this.worker!.postMessage({ ...message, id });
    });
  }

  tags(file: File) {
    return this.call<{ tags: TrackTags; hasArt: boolean }>({ type: 'tags', file });
  }

  loudness(file: File) {
    return this.call<Loudness | null>({ type: 'loudness', file });
  }

  // One fingerprint per file: Recognise and the report after the upload ask for the same one, and each costs a
  // decode of the whole track. A failure is not kept, so a later ask tries again.
  private readonly prints = new WeakMap<File, Promise<Fingerprint>>();

  fingerprint(file: File) {
    let print = this.prints.get(file);
    if (!print) {
      print = this.call<Fingerprint>({ type: 'fingerprint', file });
      this.prints.set(file, print);
      print.catch(() => this.prints.delete(file));
    }
    return print;
  }

  clip(file: File, kilobits: number, start: number, seconds: number) {
    return this.call<Uint8Array>({ type: 'clip', file, kilobits, start, seconds });
  }

  art(file: File) {
    return this.call<ArtBytes | null>({ type: 'art', file });
  }

  canonical(file: File, extension: string) {
    return this.call<{ bytes: Uint8Array; sha256: string }>({ type: 'canonical', file, extension });
  }

  renditions(file: File, kilobits: number, headKilobits: number, headSeconds: number) {
    return this.call<{ head: Uint8Array; rendition: Uint8Array }>({ type: 'renditions', file, kilobits, headKilobits, headSeconds });
  }
}
