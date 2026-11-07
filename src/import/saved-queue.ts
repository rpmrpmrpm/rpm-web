// The queue kept between visits, per account. Only what the person did is kept. The audio is not: a page
// cannot reopen a file by itself, and a copy of a library in the page's storage would fill it. So a row
// waits until its file is added again, and is found by its relative path and size. Chrome and Edge can keep
// the folders that were picked too, and open them again with one press.

import type { ImportQueue, SavedRow } from './queue';

export interface SavedQueue {
  rows: SavedRow[];
  sources: FileSystemHandle[];
}

export interface QueueStore {
  read(userId: string): Promise<SavedQueue | null>;
  write(userId: string, saved: SavedQueue): Promise<void>;
}

const SAVE_DELAY_MS = 500;

const DATABASE = 'rpm-import';
const QUEUE = 'queue';

function open(): Promise<IDBDatabase> {
  return new Promise((done, fail) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(QUEUE);
    request.onsuccess = () => done(request.result);
    request.onerror = () => fail(request.error);
  });
}

export const browserQueue: QueueStore = {
  async read(userId) {
    const database = await open();
    return new Promise<SavedQueue | null>((done, fail) => {
      const request = database.transaction(QUEUE).objectStore(QUEUE).get(userId);
      request.onsuccess = () => done((request.result as SavedQueue | undefined) ?? null);
      request.onerror = () => fail(request.error);
    });
  },

  async write(userId, saved) {
    const database = await open();
    await new Promise<void>((done, fail) => {
      const transaction = database.transaction(QUEUE, 'readwrite');
      transaction.objectStore(QUEUE).put(saved, userId);
      transaction.oncomplete = () => done();
      transaction.onerror = () => fail(transaction.error);
    });
  },
};

export class QueueKeeper {
  private userId = '';
  private planned = false;
  sources: FileSystemHandle[] = [];

  constructor(
    private readonly queue: ImportQueue,
    private readonly store: QueueStore,
    private readonly later: (run: () => void) => void = (run) => setTimeout(run, SAVE_DELAY_MS),
  ) {
    queue.onChange(() => this.plan());
  }

  private plan() {
    if (!this.userId || this.planned) return;
    this.planned = true;
    this.later(() => {
      this.planned = false;
      void this.save();
    });
  }

  // The queue is a convenience. Storage that is blocked or full must not stop an import.
  private async save() {
    if (!this.userId) return;
    const rows = this.queue.keepable();
    if (rows.length === 0) this.sources = [];
    await this.store.write(this.userId, { rows, sources: this.sources }).catch(() => {});
  }

  async open(userId: string) {
    this.userId = userId;
    const saved = await this.store.read(userId).catch(() => null);
    if (this.userId !== userId || !saved) return;
    this.sources = saved.sources;
    this.queue.restore(saved.rows);
  }

  close() {
    this.userId = '';
    this.sources = [];
    this.queue.restore([]);
  }

  addSources(handles: readonly FileSystemHandle[]) {
    this.sources.push(...handles);
    this.plan();
  }

  async forget() {
    this.sources = [];
    this.queue.restore([]);
    await this.save();
  }
}
