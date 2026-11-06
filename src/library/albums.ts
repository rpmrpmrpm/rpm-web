// Turning a listing into a wall.

import type { CloudTrack } from '../api/wire';
import { albumArtistOf, albumNameOf, discOf, folderOf, keyOfTrack, trackOf } from './grouping';
import { byDisc } from './tracklist';

export interface CloudAlbum {
  key: string;
  album: string;
  artist: string;
  tracks: CloudTrack[];
  addedAt: number;
  year: number;
}

export type AlbumOrdering = 'Artist' | 'Album' | 'Added' | 'Year';

const collator = new Intl.Collator(undefined, { sensitivity: 'accent' });

// The record's year: the one most of its tracks agree on, the earlier year on a tie. A compilation
// carries the year of each original recording on the track that came from it.
export function yearOf(tracks: readonly CloudTrack[]): number {
  const seen = new Map<number, number>();
  for (const track of tracks) {
    const year = track.tags?.year;
    if (year && year > 0) seen.set(year, (seen.get(year) ?? 0) + 1);
  }
  let best = 0;
  let most = 0;
  for (const [year, count] of [...seen].sort((a, b) => a[0] - b[0])) {
    if (count > most) {
      best = year;
      most = count;
    }
  }
  return best;
}

// The newest of its tracks: a record still going up should not sit below one that finished yesterday.
export const addedOf = (tracks: readonly CloudTrack[]): number => tracks.reduce((newest, t) => Math.max(newest, t.addedAt), 0);

// Every order falls back to artist and album, so a wall never reshuffles between two runs that agree.
export function sortAlbums(albums: readonly CloudAlbum[], ordering: AlbumOrdering): CloudAlbum[] {
  const shelf = (a: CloudAlbum, b: CloudAlbum) => collator.compare(a.artist, b.artist) || collator.compare(a.album, b.album);

  return [...albums].sort((a, b) => {
    switch (ordering) {
      case 'Album':
        return collator.compare(a.album, b.album) || shelf(a, b);
      case 'Added':
        return b.addedAt - a.addedAt || shelf(a, b);
      case 'Year':
        // Untagged last: a library half of which has no year would otherwise open on that half.
        if ((a.year === 0) !== (b.year === 0)) return a.year === 0 ? 1 : -1;
        return b.year - a.year || shelf(a, b);
      default:
        return shelf(a, b);
    }
  });
}

export function groupAlbums(tracks: readonly CloudTrack[]): CloudAlbum[] {
  const byKey = new Map<string, CloudTrack[]>();
  for (const track of tracks) {
    const key = keyOfTrack(track);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(track);
  }

  const albums = [...byKey].map(([key, rows]): CloudAlbum => {
    const folder = folderOf(rows[0]!.relativePath);

    // Title first, so it is the tiebreak: two tracks with no number read alphabetically and not in
    // whatever order the listing arrived in.
    const byTitle = [...rows].sort((a, b) => collator.compare(a.title ?? '', b.title ?? ''));

    return {
      key,
      album: albumNameOf(rows, folder) ?? '',
      artist: albumArtistOf(rows, folder) ?? '',
      tracks: byDisc(byTitle, discOf, trackOf).flatMap((disc) => disc.tracks),
      addedAt: addedOf(rows),
      year: yearOf(rows),
    };
  });

  return sortAlbums(albums, 'Artist');
}
