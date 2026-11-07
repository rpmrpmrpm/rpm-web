// The release lookup and the album picker were made for the import queue: they fill rows. An edit window
// hands them rows that stand for the tracks it edits, written to a queue of its own, and reads the boxes
// back from the rows when they are done.

import type { CloudTrack } from '../../api/wire';
import { ImportQueue, type ImportRow } from '../../import/queue';
import type { TagSet } from '../../library/tag-fields';

const extensionOf = (path: string | null) => {
  const dot = path?.lastIndexOf('.') ?? -1;
  return dot > 0 ? path!.slice(dot).toLowerCase() : '';
};

export function lookupRow(track: CloudTrack, tags: TagSet): ImportRow {
  const path = track.relativePath ?? `${track.title ?? track.rpmId}`;
  return {
    id: track.rpmId,
    file: new File([], path.split('/').pop() ?? path),
    path,
    extension: extensionOf(track.relativePath),
    tags: { ...tags, DurationSeconds: track.tags?.durationSeconds ?? 0 },
    hasArt: false,
    ticked: true,
    cover: null,
    disc: null,
    guessed: false,
    state: 'ready',
    note: null,
  };
}

// A queue for the lookup to write to. Nothing in it is ever imported.
export const lookupQueue = () => new ImportQueue();

// The fields a lookup changed on a row, as the sidecar names them.
export function changedBy(row: ImportRow, before: TagSet): TagSet {
  const changed: TagSet = {};
  for (const [key, value] of Object.entries(row.tags)) {
    if (key === 'DurationSeconds') continue;
    if (value !== before[key] && value !== undefined && value !== null && value !== '') changed[key] = value;
  }
  return changed;
}
