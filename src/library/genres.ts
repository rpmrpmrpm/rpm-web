// Which of the app's genres a tag means. Ported from Genres and GenreWall, with the table generated from
// the same file as the other apps, so a record is filed under the same genre on every platform.

import type { CloudTrack } from '../api/wire';
import type { CloudAlbum } from './albums';
import { addedOf, yearOf } from './albums';
import { ownAlbums, type ArtistWallItem } from './artists';
import table from './subgenres.json';

export const UNKNOWN_GENRE = 'Other / Unknown';
export const UNCLASSIFIED = 'Other';

const SEPARATORS = /[/,&;|]/;
const WORD_BREAKS = /[/,&;| \-_]/;

export function foldGenre(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase();
}

function keysOf(value: string, ...breaks: RegExp[]): string[] {
  const keys = [foldGenre(value)];
  for (const cut of breaks) {
    if (cut.test(value)) keys.push(...value.split(cut).map(foldGenre).filter(Boolean));
  }
  return keys;
}

const ALIASES: readonly (readonly [string, string])[] = [
  ['rocknroll', 'Rock'], ['rockandroll', 'Rock'],
  ['rb', 'R&B'], ['rnb', 'R&B'], ['randb', 'R&B'], ['rhythmandblues', 'R&B'],
  ['funksoul', 'Funk'], ['motown', 'Soul'],
  ['electronica', 'Electronic / Dance'], ['edm', 'Electronic / Dance'],
  ['hiphoprap', 'Hip-Hop / Rap'],
  ['worldmusic', 'World'], ['ethnic', 'World'],
  ['gospel', 'Religious'], ['christian', 'Religious'], ['spiritual', 'Religious'],
  ['ost', 'Soundtrack'], ['filmscore', 'Soundtrack'], ['stagescreen', 'Soundtrack'],
  ['spoken', 'Spoken Word'], ['audiobook', 'Spoken Word'],
  ['ska', 'Reggae'],
  ['international', 'World'], ['score', 'Soundtrack'],
  ['game', 'Video Game'], ['vgm', 'Video Game'],
  ['videogamesoundtrack', 'Video Game'], ['gamesoundtrack', 'Video Game'],
  ['rbsoul', 'R&B'],
  ['worldinternational', 'World'],
  ['gospelreligious', 'Religious'],
  ['soundtrackscore', 'Soundtrack'],
];

const shelfKeys = new Map<string, string>();
for (const genre of table.shelves) {
  if (genre === UNKNOWN_GENRE) continue;
  for (const key of keysOf(genre, SEPARATORS)) {
    if (key.length >= 3 && !shelfKeys.has(key)) shelfKeys.set(key, genre);
  }
}
for (const [alias, genre] of ALIASES) {
  if (!shelfKeys.has(alias)) shelfKeys.set(alias, genre);
}

const shared = new Set(table.sharedKeys);
const blocked = new Set(table.blockedKeys);
const styleKeys = new Map<string, string>();
for (const [name, genre] of table.styles as [string, string][]) {
  const key = foldGenre(name);
  if (!key || shared.has(key) || blocked.has(key) || styleKeys.has(key)) continue;
  styleKeys.set(key, genre);
}

// One walk down the tag's keys, asking the styles and then the shelves for each. So "Deep House" is House,
// and "Pop Rap" is not filed under Pop by its first word.
export function matchGenre(tag: string | null | undefined): string | null {
  if (!tag || !tag.trim()) return null;
  for (const key of keysOf(tag, SEPARATORS, WORD_BREAKS)) {
    const genre = styleKeys.get(key) ?? shelfKeys.get(key);
    if (genre) return genre;
  }
  return null;
}

// The genres of a record, in the order its tracks name them.
export function genresOf(tracks: readonly CloudTrack[]): string[] {
  const genres: string[] = [];
  for (const track of tracks) {
    const genre = matchGenre(track.tags?.genre);
    if (genre && !genres.includes(genre)) genres.push(genre);
  }
  return genres;
}

export interface GenreWallItem {
  name: string;
  albums: string[];
}

// The tag most of its tracks carry, and a tie keeps the one that came first.
export function genreOfAlbum(album: CloudAlbum): string {
  const counts = new Map<string, number>();
  for (const track of album.tracks) {
    const tag = track.tags?.genre?.trim();
    if (tag) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  let most: string | null = null;
  for (const [tag, count] of counts) {
    if (most === null || count > counts.get(most)!) most = tag;
  }
  return matchGenre(most) ?? UNCLASSIFIED;
}

export function buildGenreWall(albums: readonly CloudAlbum[]): GenreWallItem[] {
  const filed = new Map<string, string[]>();
  for (const album of albums) {
    const genre = genreOfAlbum(album);
    const held = filed.get(genre);
    if (held) held.push(album.key);
    else filed.set(genre, [album.key]);
  }
  return [...table.shelves.filter((genre) => genre !== UNKNOWN_GENRE), UNCLASSIFIED].flatMap((name) => {
    const keys = filed.get(name);
    return keys ? [{ name, albums: keys }] : [];
  });
}

export interface GenreShelves {
  albums: string[];
  added: string[];
  acts: ArtistWallItem[];
  eras: { decade: number; albums: string[] }[];
}

const MOST_ADDED = 20;
const MOST_ACTS = 12;

// One genre's page: what arrived last, who makes up most of it here, and its decades.
export function shelvesOf(genre: GenreWallItem, albums: ReadonlyMap<string, CloudAlbum>, artists: readonly ArtistWallItem[]): GenreShelves {
  const records = genre.albums.flatMap((key) => albums.get(key) ?? []);
  const keys = new Set(genre.albums);

  const added = records
    .map((album) => ({ key: album.key, at: addedOf(album.tracks) }))
    .filter((album) => album.at > 0)
    .sort((a, b) => b.at - a.at)
    .slice(0, MOST_ADDED)
    .map((album) => album.key);

  // Counted for this genre only: an act with four hundred rock songs and two jazz records is not who
  // the jazz page is about.
  const acts = artists
    .flatMap((artist) => {
      const here = ownAlbums(artist).filter((key) => keys.has(key)).length;
      return here ? [{ artist, here }] : [];
    })
    .sort((a, b) => b.here - a.here || b.artist.tracks - a.artist.tracks || a.artist.name.localeCompare(b.artist.name))
    .slice(0, MOST_ACTS)
    .map(({ artist }) => artist);

  const decades = new Map<number, string[]>();
  for (const album of records) {
    const year = yearOf(album.tracks);
    if (!year) continue;
    const decade = Math.floor(year / 10) * 10;
    decades.set(decade, [...(decades.get(decade) ?? []), album.key]);
  }

  return { albums: genre.albums, added, acts, eras: [...decades].sort(([a], [b]) => b - a).map(([decade, keys]) => ({ decade, albums: keys })) };
}
