// The catalogue in this browser, so the wall opens at once. It is a copy of what the store holds, read
// again at every load. One record per account, so a second person on this browser never sees the first
// person's library.

import type { CloudTrack } from '../api/wire';

const DATABASE = 'rpm';
const CATALOGUE = 'catalogue';

export interface CatalogueStore {
  read(userId: string): Promise<CloudTrack[] | null>;
  write(userId: string, tracks: CloudTrack[]): Promise<void>;
}

function open(): Promise<IDBDatabase> {
  return new Promise((done, fail) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(CATALOGUE);
    request.onsuccess = () => done(request.result);
    request.onerror = () => fail(request.error);
  });
}

// A browser with storage blocked has no copy, and the library is read from the store every time.
export const browserStore: CatalogueStore = {
  async read(userId) {
    try {
      const database = await open();
      return await new Promise((done, fail) => {
        const request = database.transaction(CATALOGUE).objectStore(CATALOGUE).get(userId);
        request.onsuccess = () => done(request.result ?? null);
        request.onerror = () => fail(request.error);
      });
    } catch {
      return null;
    }
  },

  async write(userId, tracks) {
    try {
      const database = await open();
      await new Promise<void>((done, fail) => {
        const transaction = database.transaction(CATALOGUE, 'readwrite');
        transaction.objectStore(CATALOGUE).put(tracks, userId);
        transaction.oncomplete = () => done();
        transaction.onerror = () => fail(transaction.error);
      });
    } catch {
      // The copy is only a head start.
    }
  },
};
