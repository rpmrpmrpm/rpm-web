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

// The handles of what was dropped, in the browsers that have them. This must be called during the drop:
// the items are empty after it.
export function handlesOfDrop(items: DataTransferItemList): Promise<(FileSystemHandle | null)[]> {
  const asked = [...items].map((item) => (item as DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> }).getAsFileSystemHandle?.());
  return Promise.all(asked.map((handle) => handle ?? null));
}

async function walkHandle(handle: FileSystemHandle, above: string, into: PickedFile[]) {
  const path = above ? `${above}/${handle.name}` : handle.name;
  if (handle.kind === 'file') {
    into.push({ file: await (handle as FileSystemFileHandle).getFile(), path });
    return;
  }
  for await (const child of (handle as FileSystemDirectoryHandle & { values(): AsyncIterable<FileSystemHandle> }).values()) {
    await walkHandle(child, path, into);
  }
}

// Paths as a picked folder gives them, from the folder's own name down, so a row is found by either.
export async function pickedFromHandles(handles: readonly FileSystemHandle[]): Promise<PickedFile[]> {
  const picked: PickedFile[] = [];
  for (const handle of handles) await walkHandle(handle, '', picked);
  return picked;
}

export const pickedFromInput = (files: FileList): PickedFile[] =>
  [...files].map((file) => ({ file, path: file.webkitRelativePath || file.name }));
