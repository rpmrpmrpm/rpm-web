// Reading what was dropped or picked. Folders dropped on a page arrive as entries to walk.

import type { PickedFile } from './queue';

function readEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((done, fail) => reader.readEntries(done, fail));
}

async function walk(entry: FileSystemEntry, into: PickedFile[]) {
  if (entry.isFile) {
    const file = await new Promise<File>((done, fail) => (entry as FileSystemFileEntry).file(done, fail));
    into.push({ file, path: entry.fullPath.replace(/^\//, '') });
    return;
  }

  // A reader answers in batches, and an empty batch is the end.
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  for (let batch = await readEntries(reader); batch.length > 0; batch = await readEntries(reader)) {
    for (const child of batch) await walk(child, into);
  }
}

export async function pickedFromDrop(items: DataTransferItemList): Promise<PickedFile[]> {
  const entries = [...items].map((item) => item.webkitGetAsEntry()).filter((entry) => entry !== null);
  const picked: PickedFile[] = [];
  for (const entry of entries) await walk(entry, picked);
  return picked;
}

export const pickedFromInput = (files: FileList): PickedFile[] =>
  [...files].map((file) => ({ file, path: file.webkitRelativePath || file.name }));
