// Putting files in the import queue and running the import, for the Import pane and for the setup's import step.
// There is one running state for the page, so an import started in one of them shows as running in the other, and
// cannot be started a second time from there.

import { catalogue, importer, importMedia, importQueue } from '../../app';
import type { ImportRow, PickedFile } from '../../import/queue';
import { text } from '../../strings/loc';

const SMALL = /Mobi|Android|iPhone|iPad/.test(navigator.userAgent);

class Importing {
  running = $state(false);
  // Why the last import stopped, or empty.
  message = $state('');
}

export const importing = new Importing();

// The files go in the queue, and then their tags are read, one file at a time. Returns the rows that were added.
export async function addToQueue(picked: PickedFile[], added: (rows: ImportRow[]) => void = () => {}): Promise<ImportRow[]> {
  const rows = importQueue.add(picked);
  added(rows);
  for (const row of rows) {
    if (row.state !== 'reading') continue;
    try {
      const { tags, hasArt } = await importMedia.tags(row.file);
      importQueue.read(row, tags, hasArt);
    } catch {
      row.state = 'unreadable';
      row.ticked = false;
      row.note = 'Cloud_FailUnreadable';
      importQueue.changed();
    }
  }
  return rows;
}

const leaving = (event: BeforeUnloadEvent) => event.preventDefault();

// Imports every row that is ticked and ready. Asking while an import runs does nothing.
export async function runImport() {
  if (importing.running) return;
  importing.running = true;
  importing.message = '';
  addEventListener('beforeunload', leaving);

  // A phone that sleeps stops the page, and an upload with it.
  let lock: WakeLockSentinel | null = null;
  try {
    lock = (await navigator.wakeLock?.request('screen')) ?? null;
  } catch {
    // A page that may not hold the screen on still imports.
  }

  try {
    const outcome = await importer.run(importQueue.importableRows(), SMALL ? 1 : 3);
    if (outcome === 'full') importing.message = text('Rpm_Error_StorageFull');
  } finally {
    void lock?.release();
    removeEventListener('beforeunload', leaving);
    importing.running = false;
  }
  await catalogue.refresh();
}
