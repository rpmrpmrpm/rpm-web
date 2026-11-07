// Searching the collection. Ported from SongSearch: the album's fields are asked once per album, and a
// search stops at a ceiling, because it runs on every key press.

import type { CloudTrack } from '../api/wire';
import type { CloudAlbum } from './albums';

export const SONG_CEILING = 300;
export const RECORD_CEILING = 60;

export interface SongHit {
  track: CloudTrack;
  album: CloudAlbum;
}

const has = (field: string | null | undefined, asking: string): boolean => !!field && field.toLowerCase().includes(asking);

export function searchSongs(albums: readonly CloudAlbum[], asked: string): SongHit[] {
  const asking = asked.trim().toLowerCase();
  if (!asking) return [];
  const found: SongHit[] = [];
  for (const album of albums) {
    const sleeve = has(album.album, asking) || has(album.artist, asking);
    for (const track of album.tracks) {
      if (!sleeve && !has(track.title, asking) && !has(track.artist, asking)) continue;
      found.push({ track, album });
      if (found.length >= SONG_CEILING) return found;
    }
  }
  return found;
}

export function searchRecords(albums: readonly CloudAlbum[], asked: string): CloudAlbum[] {
  const asking = asked.trim().toLowerCase();
  if (!asking) return [];
  const found: CloudAlbum[] = [];
  for (const album of albums) {
    if (!has(album.album, asking) && !has(album.artist, asking)) continue;
    found.push(album);
    if (found.length >= RECORD_CEILING) return found;
  }
  return found;
}
