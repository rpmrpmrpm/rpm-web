// What a list of stations is made of: one row per station, under the admin's rules, narrowed and put in order. These
// are RadioResults, StationRules, StationSieve, StationSort and RadioCountries in the other apps.

import { GENRE_TABLE } from './genre-table';
import { rankLogo, isDrawable, samePicture } from './logo';
import { carriesAds, displayOf, distinguish, foldName, genresOf, shownTags, type RadioStation, type StationEdit } from './station';

const bare = (tag: string) => tag.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const foldTag = (tag: string) => bare(tag).replace(/[^\p{L}\p{N}]/gu, '');

const BY_TAG = (() => {
  const byTag = new Map<string, string>();
  const claim = (tag: string, genre: string) => {
    const key = foldTag(tag);
    if (!byTag.has(key)) byTag.set(key, genre);
  };
  for (const [genre, , tags] of GENRE_TABLE) {
    claim(genre, genre);
    for (const tag of tags) claim(tag, genre);
  }
  return byTag;
})();

const SUFFIXES = ['music', 'radio', 'fm', 'hits', 'station'];

export const GENRES = GENRE_TABLE.map(([genre]) => genre);

function whole(folded: string): string | null {
  const genre = BY_TAG.get(folded);
  if (genre) return genre;
  for (const suffix of SUFFIXES) {
    if (folded.length > suffix.length && folded.endsWith(suffix)) {
      const found = BY_TAG.get(folded.slice(0, -suffix.length));
      if (found) return found;
    }
  }
  return null;
}

// The genres a tag names. A tag of several words can name more than one, read longest first.
export function genreNames(tag: string | null | undefined): string[] {
  if (!tag?.trim()) return [];
  const folded = foldTag(tag);
  if (!folded) return [];
  const genre = whole(folded);
  if (genre) return [genre];

  const parts = bare(tag).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (parts.length < 2) return [];
  const named: string[] = [];
  for (let at = 0; at < parts.length; ) {
    let run = '';
    let hit: string | null = null;
    let end = at + 1;
    for (let upto = at; upto < parts.length; upto++) {
      run += parts[upto];
      const found = whole(run);
      if (found) {
        hit = found;
        end = upto + 1;
      }
    }
    if (hit && !named.includes(hit)) named.push(hit);
    at = hit ? end : at + 1;
  }
  return named;
}

export const genreTerm = (genre: string | null | undefined): string | null => GENRE_TABLE.find(([name]) => name === genre)?.[1] ?? null;

export const isGenre = (tags: readonly string[] | null | undefined, genre: string) => (tags ?? []).some((tag) => genreNames(tag).includes(genre));

function streamKey(station: RadioStation): string {
  let address: URL;
  try {
    address = new URL(station.streamUrl.trim());
  } catch {
    return '';
  }
  const host = address.hostname.toLowerCase().replace(/^www\./, '');
  const path = address.pathname.replace(/\/+$/, '');
  return `${host}${address.port ? `:${address.port}` : ''}${path}${address.search}|${countryOf(station)}`;
}

const countryOf = (station: RadioStation) => station.countryCode?.trim().toLowerCase() ?? '';

function nameKey(station: RadioStation): string {
  const name = foldName(station.name, station.countryCode);
  return name ? `${name}|${countryOf(station)}` : '';
}

const rank = (station: RadioStation) => (station.reachable === false ? 0 : 1_000_000) + ((station.bitrateKbps ?? 0) > 0 ? 1_000 + station.bitrateKbps! : 0);

// One station from two rows: the better stream, every id it is filed under, and every logo, best first.
function better(kept: RadioStation, other: RadioStation): RadioStation {
  const winner = rank(other) > rank(kept) ? { ...other } : { ...kept };

  const filed: string[] = [];
  for (const source of [kept, other]) {
    for (const id of [...(source.alsoFiledAs ?? []), source.uuid]) {
      const lower = id.toLowerCase();
      if (lower !== winner.uuid.toLowerCase() && !filed.some((known) => known.toLowerCase() === lower)) filed.push(id);
    }
  }
  winner.alsoFiledAs = filed;

  const logos: string[] = [];
  const votes = new Map<string, number>();
  const gather = (from: RadioStation, counts: boolean) => {
    for (const url of [from.favicon, ...(from.otherLogos ?? [])]) {
      if (!url || !isDrawable(url)) continue;
      if (counts) votes.set(samePicture(url), (votes.get(samePicture(url)) ?? 0) + 1);
      if (!logos.some((known) => known.toLowerCase() === url.toLowerCase())) logos.push(url);
    }
  };
  gather(winner, false);
  gather(kept, true);
  gather(other, true);
  if (!logos.length) return winner;

  const scored = logos.map((url, place) => ({ url, place, score: rankLogo(url, winner.homepage), votes: votes.get(samePicture(url)) ?? 0 }));
  scored.sort((a, b) => b.score - a.score || b.votes - a.votes || a.place - b.place);
  winner.favicon = scored[0]!.url;
  winner.otherLogos = scored.slice(1).map((row) => row.url);
  return winner;
}

// The directory holds a row per stream. Rows with the same name in one country, or the same stream, are one station.
export function onePerStation(stations: readonly RadioStation[]): RadioStation[] {
  if (stations.length < 2) return [...stations];

  const parent = stations.map((_, row) => row);
  const find = (row: number): number => {
    while (parent[row] !== row) {
      parent[row] = parent[parent[row]!]!;
      row = parent[row]!;
    }
    return row;
  };
  const union = (a: number, b: number) => {
    const [first, second] = [find(a), find(b)];
    if (first !== second) parent[Math.max(first, second)] = Math.min(first, second);
  };
  const join = (index: Map<string, number>, key: string, row: number) => {
    if (!key) return;
    const first = index.get(key);
    if (first === undefined) index.set(key, row);
    else union(first, row);
  };

  const byName = new Map<string, number>();
  const byStream = new Map<string, number>();
  stations.forEach((station, row) => {
    join(byName, nameKey(station), row);
    join(byStream, streamKey(station), row);
  });

  const at = new Map<number, number>();
  const kept: RadioStation[] = [];
  stations.forEach((station, row) => {
    const group = find(row);
    const seen = at.get(group);
    if (seen === undefined) {
      at.set(group, kept.length);
      kept.push(station);
    } else {
      kept[seen] = better(kept[seen]!, station);
    }
  });
  return kept;
}

// A station the admin filed under a genre is a search result too, in its place by listeners, if it passes the rest of
// the question.
export function withRetagged(answer: readonly RadioStation[], retagged: readonly RadioStation[], question: { name?: string; countryCode?: string | null }): RadioStation[] {
  const present = new Set(answer.map((row) => row.uuid.toLowerCase()));
  const text = question.name?.trim().toLowerCase();
  const country = question.countryCode?.trim().toLowerCase();
  const added = retagged
    .filter((row) => {
      const key = row.uuid.toLowerCase();
      if (present.has(key)) return false;
      present.add(key);
      return true;
    })
    .filter((row) => !country || row.countryCode?.toLowerCase() === country)
    .filter((row) => !text || row.name.toLowerCase().includes(text) || row.edit?.name?.toLowerCase().includes(text))
    .sort((a, b) => (b.clickCount ?? 0) - (a.clickCount ?? 0));

  const merged: RadioStation[] = [];
  for (const row of answer) {
    while (added.length && (added[0]!.clickCount ?? 0) > (row.clickCount ?? 0)) merged.push(added.shift()!);
    merged.push(row);
  }
  return [...merged, ...added];
}

export interface StationRules {
  hidden: Set<string>;
  edits: Map<string, StationEdit>;
}

export const NO_RULES: StationRules = { hidden: new Set(), edits: new Map() };

const hides = (rules: StationRules, station: RadioStation) =>
  rules.hidden.has(station.uuid.toLowerCase()) && (station.alsoFiledAs ?? []).every((id) => rules.hidden.has(id.toLowerCase()));

function editOf(rules: StationRules, station: RadioStation): StationEdit | null {
  if (!rules.edits.size) return null;
  for (const id of [station.uuid, ...(station.alsoFiledAs ?? [])]) {
    const edit = rules.edits.get(id.toLowerCase());
    if (edit) return edit;
  }
  return null;
}

// What the admin decided. A hidden station goes only when every id it is filed under is hidden.
export const underRules = (rules: StationRules, stations: readonly RadioStation[]): RadioStation[] =>
  distinguish(stations.filter((station) => !hides(rules, station)).map((station) => ({ ...station, edit: editOf(rules, station) })));

export type AdsWanted = 'either' | 'without' | 'with';

export interface Sieve {
  format: string | null;
  genre: string | null;
  ads: AdsWanted;
}

export const NO_SIEVE: Sieve = { format: null, genre: null, ads: 'either' };

export const FORMATS = ['MP3', 'AAC', 'AAC+', 'OGG'];

const FOLDED_CODECS: Record<string, string> = { AACP: 'AAC+', 'AAC PLUS': 'AAC+', 'HE-AAC': 'AAC+', HEAAC: 'AAC+', VORBIS: 'OGG', 'OGG VORBIS': 'OGG', MPEG: 'MP3', MPEG3: 'MP3' };

function isFormat(codec: string | null | undefined, wanted: string): boolean {
  return (codec ?? '')
    .split(/[,/; ]+/)
    .filter(Boolean)
    .some((part) => {
      const upper = part.trim().toUpperCase();
      return (FOLDED_CODECS[upper] ?? upper) === wanted;
    });
}

export const sieveIsOn = (sieve: Sieve) => sieve.format !== null || sieve.genre !== null || sieve.ads !== 'either';

export function throughSieve(sieve: Sieve, stations: readonly RadioStation[]): RadioStation[] {
  return stations.filter((station) => {
    if (sieve.format && !isFormat(station.codec, sieve.format)) return false;
    if (sieve.genre && !isGenre(genresOf(shownTags(station)), sieve.genre)) return false;
    if (sieve.ads === 'with') return carriesAds(station);
    if (sieve.ads === 'without') return !carriesAds(station);
    return true;
  });
}

export type Ordering = 'listed' | 'nameUp' | 'nameDown' | 'votes' | 'quality';

const collator = new Intl.Collator(undefined, { sensitivity: 'base' });
const byName = (a: RadioStation, b: RadioStation) => collator.compare(displayOf(a), displayOf(b)) || (a.uuid < b.uuid ? -1 : 1);

export function sorted(order: Ordering, stations: readonly RadioStation[]): RadioStation[] {
  const list = [...stations];
  switch (order) {
    case 'nameUp':
      return list.sort(byName);
    case 'nameDown':
      return list.sort((a, b) => byName(b, a));
    case 'votes':
      return list.sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0) || byName(a, b));
    case 'quality':
      return list.sort((a, b) => (b.bitrateKbps ?? 0) - (a.bitrateKbps ?? 0) || byName(a, b));
    default:
      return list;
  }
}

export interface Country {
  name: string;
  code: string;
  stationCount: number;
}

// As many as a list can carry: the largest, and then by name.
const OFFERED = 80;

const COMMON: Record<string, string> = {
  GB: 'United Kingdom', US: 'United States', RU: 'Russia', KR: 'South Korea', KP: 'North Korea', TW: 'Taiwan', VE: 'Venezuela',
  IR: 'Iran', SY: 'Syria', TZ: 'Tanzania', MD: 'Moldova', MK: 'North Macedonia', LA: 'Laos', CD: 'DR Congo', CG: 'Congo',
  PS: 'Palestine', VA: 'Vatican City', FM: 'Micronesia', BN: 'Brunei', CV: 'Cape Verde', SH: 'Saint Helena', MF: 'Saint Martin',
  SX: 'Sint Maarten', FK: 'Falkland Islands', CC: 'Cocos Islands', UM: 'U.S. Outlying Islands', VI: 'U.S. Virgin Islands',
  VG: 'British Virgin Islands', IO: 'British Indian Ocean Territory', SJ: 'Svalbard',
};

const JOINING = new Set(['and', 'of', 'the', 'da', 'de']);

// The name a reader would use. The directory files Britain under a sentence.
export function shortCountry(name: string | null | undefined, code: string | null | undefined): string {
  if (!name?.trim()) return '';
  const known = COMMON[(code ?? '').trim().toUpperCase()];
  if (known) return known;
  const trimmed = name.trim().replace(/^the /i, '').trim();
  return trimmed
    .split(/\s+/)
    .map((word, index) => (index > 0 && JOINING.has(word.toLowerCase()) ? word.toLowerCase() : word))
    .join(' ');
}

export function forPicker(countries: readonly Country[]): Country[] {
  const byCode = new Map<string, Country[]>();
  for (const country of countries) {
    const code = country.code.trim().toUpperCase();
    byCode.set(code, [...(byCode.get(code) ?? []), country]);
  }
  return [...byCode.entries()]
    .map(([code, same]) => ({
      name: same.reduce((best, row) => (row.stationCount > best.stationCount ? row : best)).name,
      code,
      stationCount: same.reduce((sum, row) => sum + row.stationCount, 0),
    }))
    .sort((a, b) => b.stationCount - a.stationCount || (a.code < b.code ? -1 : 1))
    .slice(0, OFFERED)
    .map((country) => ({ ...country, name: shortCountry(country.name, country.code) }))
    .sort((a, b) => collator.compare(a.name, b.name) || (a.code < b.code ? -1 : 1));
}
