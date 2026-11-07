// What Home shows. Ported from HomeAlbums, HomeShelf, ListeningTaste and SimilarAlbums, so the rows
// mean the same as on the other apps. A row with nothing to show is left out, so a new account starts
// with Recently added.

import { addedOf, yearOf, type CloudAlbum } from './albums';
import { genresOf } from './genres';

export interface Played {
  plays: number;
  lastPlayedAt: number;
}

export interface HomeAlbum {
  key: string;
  album: string;
  artist: string;
  genres: string[];
  year: number;
  addedAt: number;
  plays: number;
  lastPlayedAt: number;
}

export type HomeRowKind = 'listened' | 'suggested' | 'taste' | 'played' | 'added';

export interface HomeRow {
  kind: HomeRowKind;
  keys: string[];
}

export const ROW_LENGTH = 20;
const TASTE_SEEDS = 5;
const POOL = 3;
const LEANING_ARTISTS = 12;
const LEANING_GENRES = 6;
const ACT_LEAN = 1.6;
const PLAYED_SHARE = 0.3;
const PREFERRED_PER_ACT = 1;
const ERA_SPAN = 25;
const ARTIST_GENRE_WEIGHT = 1.5;
const ALBUM_GENRE_WEIGHT = 2;
const ERA_WEIGHT = 1;

export function homeAlbums(albums: readonly CloudAlbum[], played: ReadonlyMap<string, Played>): HomeAlbum[] {
  return albums.map((album) => {
    let plays = 0;
    let lastPlayedAt = 0;
    for (const track of album.tracks) {
      const heard = played.get(track.rpmId);
      if (!heard) continue;
      plays += heard.plays;
      lastPlayedAt = Math.max(lastPlayedAt, heard.lastPlayedAt);
    }
    return {
      key: album.key,
      album: album.album,
      artist: album.artist,
      genres: genresOf(album.tracks),
      year: yearOf(album.tracks),
      addedAt: addedOf(album.tracks),
      plays,
      lastPlayedAt,
    };
  });
}

const lower = (key: string) => key.toLowerCase();
const byKey = (a: HomeAlbum, b: HomeAlbum) => (lower(a.key) < lower(b.key) ? -1 : lower(a.key) > lower(b.key) ? 1 : 0);

export const listenedRow = (shelf: readonly HomeAlbum[], count: number): string[] =>
  shelf
    .filter((album) => album.lastPlayedAt > 0)
    .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt || byKey(a, b))
    .slice(0, count)
    .map((album) => album.key);

export const playedRow = (shelf: readonly HomeAlbum[], count: number): string[] =>
  shelf
    .filter((album) => album.plays > 0)
    .sort((a, b) => b.plays - a.plays || b.lastPlayedAt - a.lastPlayedAt || byKey(a, b))
    .slice(0, count)
    .map((album) => album.key);

export const addedRow = (shelf: readonly HomeAlbum[], count: number): string[] =>
  [...shelf]
    .sort((a, b) => b.addedAt - a.addedAt || byKey(a, b))
    .slice(0, count)
    .map((album) => album.key);

// A shuffle that one draw and one salt always answer the same way. The arithmetic is the other apps'.
export function shuffled(keys: readonly string[], draw: number, salt: string): string[] {
  let state = draw | 0;
  for (const character of salt) state = (Math.imul(state, 31) + character.codePointAt(0)!) | 0;
  state = Math.imul(state, 2654435761 | 0);

  const out = [...keys];
  for (let i = out.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1103515245) + 12345) | 0;
    const j = ((state >> 8) >>> 0) % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// Case, accents and punctuation off, and a leading "the". Two spellings of one act compare equal.
export function foldName(text: string | null | undefined): string {
  const folded = (text ?? '')
    .trim()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase()
    .normalize('NFC');
  return folded.startsWith('the ') ? folded.slice(4) : folded;
}

const overlap = (a: ReadonlySet<string>, b: ReadonlySet<string>): number => {
  if (!a.size || !b.size) return 0;
  const shared = [...a].filter((value) => b.has(value)).length;
  return shared / new Set([...a, ...b]).size;
};

const era = (a: number, b: number) => Math.max(0, 1 - Math.abs(a - b) / ERA_SPAN);

function similarScore(subject: HomeAlbum, other: HomeAlbum, subjectPool: ReadonlySet<string>, otherPool: ReadonlySet<string>): number {
  let total = 0;
  let asked = 0;
  const ask = (weight: number, value: number) => {
    total += weight * value;
    asked += weight;
  };
  if (subjectPool.size && otherPool.size) ask(ARTIST_GENRE_WEIGHT, overlap(subjectPool, otherPool));
  if (subject.genres.length && other.genres.length) ask(ALBUM_GENRE_WEIGHT, overlap(new Set(subject.genres), new Set(other.genres)));
  if (subject.year > 0 && other.year > 0) ask(ERA_WEIGHT, era(subject.year, other.year));
  return asked > 0 ? total / asked : 0;
}

// Records like this one by other acts: the best of each act first, then a second round for a short shelf.
export function similarAlbums(subject: HomeAlbum, library: readonly HomeAlbum[], count: number): string[] {
  if (count <= 0) return [];
  const subjectKey = foldName(subject.artist);
  const pools = new Map<string, Set<string>>();
  for (const album of library) {
    if (!album.genres.length) continue;
    const key = foldName(album.artist);
    const pool = pools.get(key) ?? new Set<string>();
    for (const genre of album.genres) pool.add(genre);
    pools.set(key, pool);
  }
  if (subject.genres.length) {
    const pool = pools.get(subjectKey) ?? new Set<string>();
    for (const genre of subject.genres) pool.add(genre);
    pools.set(subjectKey, pool);
  }
  const subjectPool = pools.get(subjectKey) ?? new Set<string>();
  const identity = (album: HomeAlbum) => `${foldName(album.artist)}|${foldName(album.album)}`;

  const seen = new Set([identity(subject)]);
  const scored: { album: HomeAlbum; score: number }[] = [];
  for (const other of library) {
    if (!other.album.trim() || foldName(other.artist) === subjectKey || seen.has(identity(other))) continue;
    seen.add(identity(other));
    scored.push({ album: other, score: similarScore(subject, other, subjectPool, pools.get(foldName(other.artist)) ?? new Set()) });
  }
  scored.sort((a, b) => b.score - a.score || (a.album.key < b.album.key ? -1 : a.album.key > b.album.key ? 1 : 0));

  const picked: string[] = [];
  const acts = new Map<string, number>();
  const taken = new Set<string>();
  for (let round = 0; round < 2 && picked.length < count; round++) {
    for (const { album } of scored) {
      if (picked.length >= count) break;
      if (taken.has(album.key)) continue;
      const act = foldName(album.artist);
      const already = acts.get(act) ?? 0;
      if (round === 0 && already >= PREFERRED_PER_ACT) continue;
      acts.set(act, already + 1);
      taken.add(album.key);
      picked.push(album.key);
    }
  }
  return picked;
}

export function suggestedRow(seeds: readonly HomeAlbum[], shelf: readonly HomeAlbum[], exclude: readonly string[], count: number, draw: number): string[] {
  if (count <= 0 || !seeds.length) return [];
  const taken = new Set(exclude.map(lower));
  const answers = seeds.map((seed) => shuffled(similarAlbums(seed, shelf, count * POOL), draw, seed.key));

  const row: string[] = [];
  for (let round = 0; row.length < count; round++) {
    let addedThisRound = false;
    for (const answer of answers) {
      if (round >= answer.length) continue;
      addedThisRound = true;
      const key = answer[round]!;
      if (taken.has(lower(key))) continue;
      taken.add(lower(key));
      row.push(key);
      if (row.length === count) return row;
    }
    // Every seed has run out. On a shelf too small to fill the row, this is what ends the loop.
    if (!addedThisRound) break;
  }
  return row;
}

interface Taste {
  artists: { name: string; plays: number }[];
  genres: { genre: string; share: number }[];
}

export function listeningTaste(shelf: readonly HomeAlbum[]): Taste {
  const byAct = new Map<string, { name: string; plays: number }>();
  const byGenre = new Map<string, number>();
  let played = 0;

  for (const album of shelf) {
    if (album.plays <= 0) continue;
    played += album.plays;
    const act = foldName(album.artist);
    if (act) {
      const held = byAct.get(act);
      byAct.set(act, { name: held?.name ?? album.artist, plays: (held?.plays ?? 0) + album.plays });
    }
    for (const genre of album.genres) byGenre.set(genre, (byGenre.get(genre) ?? 0) + album.plays);
  }

  return {
    artists: [...byAct.values()].sort((a, b) => b.plays - a.plays || (a.name < b.name ? -1 : 1)),
    genres: played
      ? [...byGenre].map(([genre, plays]) => ({ genre, share: plays / played })).sort((a, b) => b.share - a.share || (a.genre < b.genre ? -1 : 1))
      : [],
  };
}

export function tasteRow(taste: Taste, shelf: readonly HomeAlbum[], exclude: readonly string[], count: number, draw: number): string[] {
  if (count <= 0 || !taste.artists.length) return [];

  const top = taste.artists.slice(0, LEANING_ARTISTS);
  const actPlays = top.reduce((sum, act) => sum + act.plays, 0);
  const acts = new Map<string, number>();
  for (const act of top) {
    const key = foldName(act.name);
    if (key) acts.set(key, actPlays > 0 ? act.plays / actPlays : 1 / top.length);
  }
  const kinds = new Map(taste.genres.slice(0, LEANING_GENRES).map(({ genre, share }) => [lower(genre), share]));
  const skip = new Set(exclude.map(lower));

  const scored: { key: string; score: number }[] = [];
  for (const album of shelf) {
    if (skip.has(lower(album.key))) continue;
    let score = (acts.get(foldName(album.artist)) ?? 0) * ACT_LEAN;
    for (const genre of album.genres) score += kinds.get(lower(genre)) ?? 0;
    if (score <= 0) continue;
    scored.push({ key: album.key, score: album.plays > 0 ? score * PLAYED_SHARE : score });
  }
  scored.sort((a, b) => b.score - a.score || (lower(a.key) < lower(b.key) ? -1 : 1));

  return shuffled(scored.slice(0, count * POOL).map(({ key }) => key), draw, 'taste').slice(0, count);
}

export function homeRows(shelf: readonly HomeAlbum[], draw: number): HomeRow[] {
  const listened = listenedRow(shelf, ROW_LENGTH);
  const played = playedRow(shelf, ROW_LENGTH);
  const added = addedRow(shelf, ROW_LENGTH);

  // The seeds are what has been played, or what arrived last where nothing has. The whole basis is left
  // out, so a row above is not offered again on the same screen.
  const basis = listened.length ? listened : added;
  const held = new Map(shelf.map((album) => [album.key, album]));
  const seeds = basis.slice(0, TASTE_SEEDS).flatMap((key) => held.get(key) ?? []);
  const suggested = suggestedRow(seeds, shelf, [...listened, ...basis], ROW_LENGTH, draw);
  const taste = tasteRow(listeningTaste(shelf), shelf, [...listened, ...suggested], ROW_LENGTH, draw);

  const rows: HomeRow[] = [
    { kind: 'listened', keys: listened },
    { kind: 'suggested', keys: suggested },
    { kind: 'taste', keys: taste },
    { kind: 'played', keys: played },
    { kind: 'added', keys: added },
  ];
  return rows.filter((row) => row.keys.length);
}
