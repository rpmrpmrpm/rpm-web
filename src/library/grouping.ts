// What one album is. An album is a folder with tracks directly in it. That is the shape the library is
// filed in (Artist/Album/track), and it gets three cases a tag-based grouping cannot: a compilation
// belongs to its album artist, a merged multi-disc set is one record, and a disc given its own folder
// reads as its own record. This is the desktop's rule, as the phone apps have it.

import type { CloudTrack } from '../api/wire';

const blank = (value: string | null | undefined) => !value || value.trim().length === 0;
const norm = (value: string | null | undefined) => (value ?? '').trim().toLowerCase();

// The desktop's own pattern: strips "Album (Disc 2)" and the like, so a set groups as one record.
const DISC_SUFFIX = /[\s\-–—_:,]*[([]?\s*(cd|disc|disk)\s*[-_ ]?\d+\s*[)\]]?$/i;

// A name that is nothing but a decoration keeps it: an album called "Disc 2" would otherwise normalise
// to the empty string and join every other untitled record.
export function normalizedAlbumName(album: string): string {
  const trimmed = album.trim();
  return trimmed.replace(DISC_SUFFIX, '').trim() || trimmed;
}

// The folder a row sits in: everything ahead of the file name, the empty string for a track loose at
// the library root, which is one album too. Null only when the row carries no path.
export function folderOf(relativePath: string | null | undefined): string | null {
  if (blank(relativePath)) return null;
  const path = relativePath!.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  const cut = path.lastIndexOf('/');
  return cut < 0 ? '' : path.slice(0, cut);
}

export function albumKey(
  relativePath: string | null | undefined,
  albumArtist: string | null | undefined,
  artist: string | null | undefined,
  album: string | null | undefined,
): string {
  const folder = folderOf(relativePath);
  if (folder !== null) return `folder:${folder.toLowerCase()}`;

  const owner = blank(albumArtist) ? artist : albumArtist;
  const name = blank(album) ? '' : normalizedAlbumName(album!);
  return `tags:${norm(owner)}|${norm(name)}`;
}

export const keyOfTrack = (track: CloudTrack): string =>
  albumKey(track.relativePath, track.tags?.albumArtist, track.artist, track.album);

function firstFilled(values: readonly (string | null | undefined)[]): string | null {
  const found = values.find((value) => !blank(value));
  return found ? found.trim() : null;
}

// One segment of a folder, counted from the end: 0 is the folder itself, 1 the one above it.
function segment(folder: string | null, fromEnd: number): string | null {
  if (blank(folder)) return null;
  const parts = folder!.split('/').filter(Boolean);
  return parts.length > fromEnd ? parts[parts.length - 1 - fromEnd]! : null;
}

export function albumNameOf(tracks: readonly CloudTrack[], folder: string | null): string | null {
  return firstFilled(tracks.map((t) => t.album)) ?? segment(folder, 0);
}

// The album artist and not the track artist: on a compilation only one of them names the record.
export function albumArtistOf(tracks: readonly CloudTrack[], folder: string | null): string | null {
  return firstFilled(tracks.map((t) => t.tags?.albumArtist)) ?? firstFilled(tracks.map((t) => t.artist)) ?? segment(folder, 1);
}

const position = (value: number | undefined) => (value && value > 0 ? value : 0);
export const discOf = (track: CloudTrack): number => position(track.tags?.discNumber);
export const trackOf = (track: CloudTrack): number => position(track.tags?.trackNumber);
