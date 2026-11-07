// What this browser has played, kept in IndexedDB per account.

import type { PlaysStore, SavedPlays } from './plays';

const DATABASE = 'rpm-plays';
const PLAYS = 'plays';

function open(): Promise<IDBDatabase> {
  return new Promise((done, fail) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(PLAYS);
    request.onsuccess = () => done(request.result);
    request.onerror = () => fail(request.error);
  });
}

export const browserPlays: PlaysStore = {
  async read(userId) {
    const database = await open();
    return new Promise<SavedPlays | null>((done, fail) => {
      const request = database.transaction(PLAYS).objectStore(PLAYS).get(userId);
      request.onsuccess = () => done((request.result as SavedPlays | undefined) ?? null);
      request.onerror = () => fail(request.error);
    });
  },

  async write(userId, saved) {
    const database = await open();
    await new Promise<void>((done, fail) => {
      const transaction = database.transaction(PLAYS, 'readwrite');
      transaction.objectStore(PLAYS).put(saved, userId);
      transaction.oncomplete = () => done();
      transaction.onerror = () => fail(transaction.error);
    });
  },
};
