// The rules the desktop's MigrationMerge, MigrationEstimate and AlbumBatch hold, for the web app. Times
// here are unix seconds, 0 meaning none.

import type { SourceLibrary, SourceTrack } from './model';

export interface AccountSide {
  rating: number;
  favorite: boolean;
  favoritedAt: number;
  added: number;
  lastPlayed: number;
}

const toSeconds = (at: Date | null) => (at ? Math.floor(at.getTime() / 1000) : 0);
const earlier = (a: number, b: number) => (a <= 0 ? b : b <= 0 ? a : Math.min(a, b));

// Rating: the account's if it has one, else the source's. Favourite: either; the account's date stays when
// it had the mark, a mark only the source has is dated when the song joined that library. Date added:
// the earlier. Last played: the later.
export function mergeDetails(account: AccountSide, source: SourceTrack): AccountSide {
  const added = toSeconds(source.added);
  return {
    rating: account.rating > 0 ? account.rating : Math.min(10, Math.max(0, source.rating)),
    favorite: account.favorite || source.favorite,
    favoritedAt: account.favorite ? account.favoritedAt : source.favorite ? added || Math.floor(Date.now() / 1000) : 0,
    added: earlier(account.added, added),
    lastPlayed: Math.max(account.lastPlayed, toSeconds(source.lastPlayed)),
  };
}

export const LENGTH_TOLERANCE = 2;

export const songKey = (artist: string, album: string, title: string) =>
  `${artist.trim().toLowerCase()}\u0001${album.trim().toLowerCase()}\u0001${title.trim().toLowerCase()}`;

export interface KnownSong {
  artist: string;
  album: string;
  title: string;
  durationSeconds: number;
}

export function estimate(library: SourceLibrary, known: readonly KnownSong[]): { aboutAlreadyInRpm: number; aboutBytesNeeded: number; totalBytes: number } {
  const byKey = new Map<string, number[]>();
  for (const song of known) {
    const key = songKey(song.artist, song.album, song.title);
    byKey.set(key, [...(byKey.get(key) ?? []), song.durationSeconds]);
  }
  let already = 0;
  let needed = 0;
  let total = 0;
  for (const track of library.tracks) {
    total += track.sizeBytes;
    const lengths = byKey.get(songKey(track.artist, track.album, track.title));
    if (lengths?.some((l) => Math.abs(l - track.durationSeconds) <= LENGTH_TOLERANCE)) already++;
    else needed += track.sizeBytes;
  }
  return { aboutAlreadyInRpm: already, aboutBytesNeeded: needed, totalBytes: total };
}

// The albums in the source's order, so an import that runs out of space never stops half-way through one.
export function albumBatches(tracks: readonly SourceTrack[]): SourceTrack[][] {
  const order: SourceTrack[][] = [];
  const byKey = new Map<string, SourceTrack[]>();
  for (const track of tracks) {
    const artist = track.albumArtist.trim() ? track.albumArtist : track.artist;
    const key = `${artist.trim().toLowerCase()}\u0001${track.album.trim().toLowerCase()}`;
    let album = byKey.get(key);
    if (!album) {
      album = [];
      byKey.set(key, album);
      order.push(album);
    }
    album.push(track);
  }
  return order;
}

// Whether a file holds lossless audio, by its type.
export const lossless = (extension: string) => ['.flac', '.wav', '.aiff', '.aif', '.ape', '.wv', '.alac'].includes(extension.toLowerCase());
