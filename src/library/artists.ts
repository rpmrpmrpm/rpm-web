// The collection read by who made it: one entry per act, not per credit. Ported from ArtistCredit,
// ArtistWall and ArtistSort rule for rule, so every app holds the same wall.
//
// A track's artist field is a credit, not a name: "Ellie Goulding" and "Calvin Harris feat. Ellie
// Goulding" name one person twice. So every credit is split into the acts it names. Except where the
// credit is itself a band: the same separators are in "Earth, Wind & Fire". What tells the two apart is
// the collection: a credit it files a record under is a name.

import { addedOf, type CloudAlbum } from './albums';
import { same, squash } from './names';

export interface ArtistCreditRow {
  album: string;
  albumArtist: string | null;
  artist: string | null;
  tracks: number;
}

export interface ArtistWallItem {
  name: string;
  // Filed under this act alone.
  albums: string[];
  // Filed under a credit naming this act and somebody else.
  together: string[];
  // Credited on a track of somebody else's record.
  appearances: string[];
  tracks: number;
}

export const ownAlbums = (artist: ArtistWallItem): string[] => [...artist.albums, ...artist.together];
export const everyAlbum = (artist: ArtistWallItem): string[] => [...ownAlbums(artist), ...artist.appearances];

const MAX_CREDITED = 8;
export const VARIOUS_ARTISTS = 'Various Artists';

const VARIOUS_NAMES = new Set([squash('Various'), squash('Various Artist'), squash(VARIOUS_ARTISTS)]);
const SEPARATORS = /\s*[,;/&]\s*|[\s([]+(?:feat\.?|featuring|ft\.?)\s+/gi;
const GUEST_SEPARATORS = /[\s([]+(?:feat\.?|featuring|ft\.?)\s+/gi;
const NAME_SEPARATORS = /\s*[,;/&]\s*/g;
const WIDE_SEPARATORS = /\s*[,;/&]\s*|[\s([]+(?:feat\.?|featuring|ft\.?)\s+|\s+(?:with|and|x)\s+/gi;

export const isVariousArtists = (name: string | null | undefined): boolean => !!name && VARIOUS_NAMES.has(squash(name));

const blank = (text: string | null | undefined): boolean => !text || text.trim() === '';

function named(part: string, already: readonly string[]): string | null {
  const name = part
    .trim()
    .replace(/^[()[\]\-–]+|[()[\]\-–]+$/g, '')
    .trim();
  if ([...name].length < 2 || isVariousArtists(name)) return null;
  const lower = name.toLowerCase();
  return already.some((held) => held.toLowerCase() === lower) ? null : name;
}

function cut(credit: string | null | undefined, separators: RegExp): string[] {
  if (blank(credit)) return [];
  const names: string[] = [];
  for (const part of credit!.split(separators)) {
    const name = named(part, names);
    if (!name) continue;
    names.push(name);
    if (names.length === MAX_CREDITED) break;
  }
  return names;
}

export const splitCredit = (credit: string | null | undefined): string[] => cut(credit, SEPARATORS);
export const splitWide = (credit: string | null | undefined): string[] => cut(credit, WIDE_SEPARATORS);

// A credit by the people on it, with those after a "feat" in a group of their own.
export function splitGuests(credit: string | null | undefined): string[][] {
  if (blank(credit)) return [];
  const groups: string[][] = [];
  const all: string[] = [];
  for (const group of credit!.split(GUEST_SEPARATORS)) {
    const names: string[] = [];
    for (const part of group.split(NAME_SEPARATORS)) {
      const name = named(part, all);
      if (!name) continue;
      all.push(name);
      names.push(name);
      if (all.length === MAX_CREDITED) break;
    }
    if (names.length) groups.push(names);
    if (all.length === MAX_CREDITED) break;
  }
  return groups;
}

// The credit rows a wall of records makes, one per album and track artist. An album with no track
// artists still gives a row, so a record nobody's tags credit is filed under whoever it is filed under.
export function creditRows(albums: readonly CloudAlbum[]): ArtistCreditRow[] {
  const rows: ArtistCreditRow[] = [];
  for (const album of albums) {
    const counts = new Map<string, number>();
    for (const track of album.tracks) {
      const credit = (track.artist ?? '').trim();
      if (credit) counts.set(credit, (counts.get(credit) ?? 0) + 1);
    }
    if (!counts.size) rows.push({ album: album.key, albumArtist: album.artist, artist: null, tracks: album.tracks.length });
    for (const [credit, tracks] of counts) rows.push({ album: album.key, albumArtist: album.artist, artist: credit, tracks });
  }
  return rows;
}

// A split credit with any run of its parts that spells a filed name put back together: "Tyler, The
// Creator" cuts in two, and is one act. Only a run that squashes to a filed credit is rejoined, so this
// never invents an act. Never across a "feat".
function rejoined(groups: readonly string[][], bands: ReadonlyMap<string, string>): string[] {
  const kept: string[] = [];
  for (const parts of groups) {
    let i = 0;
    while (i < parts.length) {
      let run = squash(parts[i]);
      let joined = run;
      let last = i;
      for (let j = i + 1; j < parts.length; j++) {
        joined += squash(parts[j]);
        if (bands.has(joined)) {
          run = joined;
          last = j;
        }
      }
      if (last === i) kept.push(parts[i]!);
      else if (!kept.some((name) => squash(name) === run)) kept.push(bands.get(run)!);
      i = last + 1;
    }
  }
  return kept;
}

function namesIn(credit: string | null | undefined, bands: ReadonlyMap<string, string>, joint: ReadonlyMap<string, string[]>): string[] {
  if (blank(credit)) return [];
  if (isVariousArtists(credit)) return [VARIOUS_ARTISTS];
  const whole = credit!.trim();
  const key = squash(whole);
  const together = joint.get(key);
  if (together) return together;
  if (bands.has(key)) return [whole];
  return rejoined(splitGuests(whole), bands);
}

// Which filed credits name two acts working together. Every part must be somebody the collection knows
// on their own: a collection with his solo records knows "Nick Cave", and that must not break up "Nick
// Cave & The Bad Seeds".
function collaborations(credits: readonly ArtistCreditRow[], bands: ReadonlyMap<string, string>, filed: readonly string[]): Map<string, string[]> {
  const known = new Set<string>();
  const none = new Map<string, string[]>();
  for (const row of credits) {
    for (const name of namesIn(row.albumArtist, bands, none)) known.add(squash(name));
    for (const name of namesIn(row.artist, bands, none)) known.add(squash(name));
  }
  const joint = new Map<string, string[]>();
  for (const credit of filed) {
    const parts = splitWide(credit);
    if (parts.length > 1 && parts.every((part) => known.has(squash(part)))) joint.set(squash(credit), parts);
  }
  return joint;
}

const byKeyNoCase = (one: string, other: string): number => {
  const a = one.toLowerCase();
  const b = other.toLowerCase();
  return a < b ? -1 : a > b ? 1 : one < other ? -1 : one > other ? 1 : 0;
};

class Act {
  private readonly spellings = new Map<string, number>();
  private readonly albums: string[] = [];
  private readonly together: string[] = [];
  private appearances: string[] = [];
  private readonly leads = new Set<string>();
  private readonly guests = new Set<string>();
  private readonly counted = new Set<number>();
  private tracks = 0;

  static at(acts: Map<string, Act>, name: string): Act {
    const key = squash(name);
    let act = acts.get(key);
    if (!act) acts.set(key, (act = new Act()));
    act.spellings.set(name, (act.spellings.get(name) ?? 0) + 1);
    return act;
  }

  private count(row: number, tracks: number) {
    if (this.counted.has(row)) return;
    this.counted.add(row);
    this.tracks += tracks;
  }

  lead(album: string, row: number, tracks: number, shared: boolean) {
    this.count(row, tracks);
    const folded = album.toLowerCase();
    if (this.leads.has(folded)) return;
    this.leads.add(folded);
    if (this.guests.delete(folded)) this.appearances = this.appearances.filter((held) => held.toLowerCase() !== folded);
    (shared ? this.together : this.albums).push(album);
  }

  guest(album: string, row: number, tracks: number) {
    this.count(row, tracks);
    const folded = album.toLowerCase();
    if (this.leads.has(folded) || this.guests.has(folded)) return;
    this.guests.add(folded);
    this.appearances.push(album);
  }

  settle(): ArtistWallItem {
    const name = [...this.spellings].sort(([a, m], [b, n]) => (m !== n ? n - m : a < b ? -1 : a > b ? 1 : 0))[0]?.[0] ?? '';
    return {
      name,
      albums: [...this.albums].sort(byKeyNoCase),
      together: [...this.together].sort(byKeyNoCase),
      appearances: [...this.appearances].sort(byKeyNoCase),
      tracks: this.tracks,
    };
  }
}

export function buildArtistWall(credits: readonly ArtistCreditRow[]): ArtistWallItem[] {
  const bands = new Map<string, string>();
  const filed: string[] = [];
  for (const row of credits) {
    const credit = row.albumArtist;
    if (!credit || isVariousArtists(credit) || bands.has(squash(credit))) continue;
    const spelled = credit.trim();
    bands.set(squash(credit), spelled);
    filed.push(spelled);
  }

  const joint = collaborations(credits, bands, filed);
  const acts = new Map<string, Act>();

  credits.forEach((row, index) => {
    const leads = namesIn(row.albumArtist, bands, joint);
    for (const name of leads) Act.at(acts, name).lead(row.album, index, row.tracks, leads.length > 1);
    for (const name of namesIn(row.artist, bands, joint)) Act.at(acts, name).guest(row.album, index, row.tracks);
  });

  // An act with no record of their own is still named, and is not on the wall. Filtered only now,
  // because a guest credit is how the collection comes to know a name.
  const wall = [...acts.values()].map((act) => act.settle()).filter((act) => act.albums.length || act.together.length);
  return sortArtists(wall, 'Name', new Map());
}

// Whether one credit as typed names this act, for picking their songs out of somebody else's record.
export function creditNames(credit: string | null | undefined, artist: string | null | undefined): boolean {
  if (blank(credit) || blank(artist)) return false;
  return same(credit, artist) || splitWide(credit).some((part) => same(part, artist));
}

// The letter a name sits under: its first letter with the accent off, or # for anything else.
export function initialOf(name: string | null | undefined): string {
  for (const character of (name ?? '').trim()) {
    if (!/[\p{L}\p{N}]/u.test(character)) continue;
    const base = character.toUpperCase().normalize('NFD')[0]!;
    return base >= 'A' && base <= 'Z' ? base : '#';
  }
  return '#';
}

// A name as the search compares it. Lower case, accents off, everything but letters and digits gone:
// "sigur ros" finds Sigur Rós, "acdc" finds AC/DC.
export function searchKey(text: string | null | undefined): string {
  return (text ?? '')
    .normalize('NFD')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase();
}

export function artistMatches(name: string, query: string): boolean {
  const wanted = searchKey(query);
  return !wanted || searchKey(name).includes(wanted);
}

export type ArtistOrdering = 'Name' | 'Albums' | 'Tracks' | 'Added';

const collator = new Intl.Collator(undefined, { sensitivity: 'accent' });

function byName(one: ArtistWallItem, other: ArtistWallItem): number {
  const oneLast = initialOf(one.name) === '#';
  if (oneLast !== (initialOf(other.name) === '#')) return oneLast ? 1 : -1;
  return collator.compare(one.name, other.name) || (one.name < other.name ? -1 : one.name > other.name ? 1 : 0);
}

export function sortArtists(artists: readonly ArtistWallItem[], ordering: ArtistOrdering, albums: ReadonlyMap<string, CloudAlbum>): ArtistWallItem[] {
  const arrival = (artist: ArtistWallItem) =>
    ownAlbums(artist).reduce((latest, key) => {
      const album = albums.get(key);
      return album ? Math.max(latest, addedOf(album.tracks)) : latest;
    }, 0);
  const arrivals = ordering === 'Added' ? new Map(artists.map((artist) => [artist, arrival(artist)])) : null;

  return [...artists].sort((a, b) => {
    if (ordering === 'Albums') {
      const difference = ownAlbums(b).length - ownAlbums(a).length;
      if (difference) return difference;
    } else if (ordering === 'Tracks' && a.tracks !== b.tracks) {
      return b.tracks - a.tracks;
    } else if (arrivals) {
      const difference = arrivals.get(b)! - arrivals.get(a)!;
      if (difference) return difference;
    }
    return byName(a, b);
  });
}
