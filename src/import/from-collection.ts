// Files that belong with a record already in the collection. Pointing at the record gives what it says about
// itself, taken as the album editor takes it. This is PickLibraryAlbumAsync of the desktop app.

import type { CloudAlbum } from '../library/albums';
import type { TrackTags } from './queue';

const SHOWN = 100;

// The value most of the tracks carry, with blanks losing to anything named. A half-tagged album still gives
// an answer, and a tie always gives the same one.
export function dominant(values: readonly (string | null | undefined)[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) {
    const named = value?.trim();
    if (named) counts.set(named, (counts.get(named) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [value, count] of counts) {
    const most = best === null ? 0 : counts.get(best)!;
    if (count > most || (count === most && value < best!)) best = value;
  }
  return best;
}

export function albumFields(album: CloudAlbum): Partial<TrackTags> {
  const { tracks } = album;
  const fields: Partial<TrackTags> = {};
  const name = dominant(tracks.map((track) => track.album));
  const albumArtist = dominant(tracks.map((track) => track.tags?.albumArtist));
  const genre = dominant(tracks.map((track) => track.tags?.genre));
  const discs = Math.max(0, ...tracks.map((track) => track.tags?.discCount ?? 0));
  if (name) fields.Album = name;
  if (albumArtist) fields.AlbumArtist = albumArtist;
  if (genre) fields.Genre = genre;
  if (album.year > 0) fields.Year = album.year;
  if (discs > 0) fields.DiscCount = discs;
  return fields;
}

// Every word must be in the album or the artist.
export function findAlbums(albums: readonly CloudAlbum[], words: string): CloudAlbum[] {
  const wanted = words.toLowerCase().split(/\s+/).filter(Boolean);
  const found = albums.filter((album) => {
    const name = `${album.album} ${album.artist}`.toLowerCase();
    return wanted.every((word) => name.includes(word));
  });
  return found.slice(0, SHOWN);
}
