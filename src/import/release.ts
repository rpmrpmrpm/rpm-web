// Looking a record up. Ported from ReleaseSearch, ReleaseMatcher, ReleaseTrackMatcher, DiscogsJson and
// RpmMetadataProvider. Everything goes through rpm's API with the signed-in token: the rpm database
// answers any account, and Discogs answers on the account's own connection.

import { ApiError, type Api } from '../api/http';

export type ReleaseMedia = 'any' | 'cd' | 'vinyl' | 'cassette' | 'digital';

export interface ReleaseQuery {
  album: string;
  artist: string;
  media: ReleaseMedia;
  catalogNumber: string;
  barcode: string;
  country: string;
  year: number;
}

export interface ReleaseResult {
  provider: 'rpm' | 'discogs';
  id: string;
  title: string;
  artist: string | null;
  year: number;
  country: string | null;
  format: string | null;
  trackCount: number;
  label: string | null;
  catalogNumber: string | null;
  relevance: number;
  coverUrl: string | null;
}

export interface ReleaseTrack {
  position: number;
  title: string;
  artist: string | null;
  lengthSeconds: number | null;
  disc: number;
  discPosition: number;
  discSubtitle?: string | null;
  artistSort?: string | null;
  recordingId?: string | null;
  artistId?: string | null;
  isrc?: string | null;
  work?: string | null;
  movementName?: string | null;
  movementNumber?: number;
  movementCount?: number;
  composers?: string | null;
}

export interface ReleaseDetail {
  provider: 'rpm' | 'discogs';
  id: string;
  title: string;
  artist: string | null;
  year: number;
  originalYear: number;
  country: string | null;
  format: string | null;
  tracks: ReleaseTrack[];
  discCount: number;
  artistSort: string | null;
  artistId: string | null;
  releaseGroupId: string | null;
  barcode: string | null;
  label: string | null;
  catalogNumber: string | null;
  genre: string | null;
  subgenre: string | null;
  coverUrl: string | null;
}

export type SourceState = 'searching' | 'found' | 'none' | 'unavailable' | 'failed';

export interface SourceAnswer {
  name: string;
  state: SourceState;
  found: number;
}

const blank = (text: unknown): string | null => (typeof text === 'string' && text.trim() ? text : null);
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

function mediaMatches(media: ReleaseMedia, format: string | null): boolean {
  if (media === 'any') return true;
  const text = (format ?? '').toLowerCase();
  if (media === 'vinyl') return /vinyl|\blp\b|\d+"/.test(text);
  if (media === 'cd') return /\bcd\b/.test(text);
  if (media === 'cassette') return /cassette/.test(text);
  return /digital|file/.test(text);
}

export function orderResults(results: readonly ReleaseResult[], query: Pick<ReleaseQuery, 'media'>): ReleaseResult[] {
  return [...results].sort(
    (a, b) =>
      Number(mediaMatches(query.media, b.format)) - Number(mediaMatches(query.media, a.format)) ||
      b.relevance - a.relevance ||
      Number(b.trackCount > 0) - Number(a.trackCount > 0) ||
      (a.year || Infinity) - (b.year || Infinity),
  );
}

// The rpm database.

interface CatalogRelease {
  releaseId: string;
  title: string;
  artist?: string;
  year?: number;
  country?: string;
  format?: string;
  trackCount?: number;
  label?: string;
  catalogNumber?: string;
  score?: number;
}

// The API answers per medium, because a release is often a box as well as a record. A row is a release.
export function foldRpmSearch(rows: readonly CatalogRelease[]): ReleaseResult[] {
  const byRelease = new Map<string, CatalogRelease[]>();
  for (const row of rows) byRelease.set(row.releaseId, [...(byRelease.get(row.releaseId) ?? []), row]);

  return [...byRelease.values()].map((media) => {
    const release = media[0]!;
    const formats = [...new Set(media.map((row) => row.format).filter((format): format is string => !!blank(format)))];
    return {
      provider: 'rpm',
      id: release.releaseId,
      title: release.title,
      artist: blank(release.artist),
      year: release.year ?? 0,
      country: blank(release.country),
      format: formats.length ? formats.join(' + ') : null,
      trackCount: media.reduce((sum, row) => sum + (row.trackCount ?? 0), 0),
      label: blank(release.label),
      catalogNumber: blank(release.catalogNumber),
      relevance: clamp((release.score ?? 0) / 100, 0, 1),
      coverUrl: null,
    };
  });
}

interface CatalogTrack {
  position?: number;
  title?: string;
  artist?: string;
  lengthSeconds?: number;
  artistSort?: string;
  recordingId?: string;
  artistId?: string;
  isrc?: string;
  work?: string;
  movementName?: string;
  movementNumber?: number;
  movementCount?: number;
  composers?: string;
}

interface CatalogDetail {
  id: string;
  title: string;
  artist?: string;
  year?: number;
  originalYear?: number;
  country?: string;
  tracks?: CatalogTrack[];
  media?: { position: number; title?: string; format?: string; tracks: CatalogTrack[] }[];
  artistSort?: string;
  artistId?: string;
  releaseGroupId?: string;
  barcode?: string;
  label?: string;
  catalogNumber?: string;
  genre?: string;
  subgenre?: string;
}

function rpmTrack(track: CatalogTrack, releaseArtist: string | null, position: number, disc = 0, discPosition = 0, discSubtitle: string | null = null): ReleaseTrack {
  return {
    position,
    title: track.title ?? '',
    artist: blank(track.artist) ?? releaseArtist,
    lengthSeconds: track.lengthSeconds ?? null,
    disc,
    discPosition,
    discSubtitle,
    artistSort: blank(track.artistSort),
    recordingId: blank(track.recordingId),
    artistId: blank(track.artistId),
    isrc: blank(track.isrc),
    work: blank(track.work),
    movementName: blank(track.movementName),
    movementNumber: track.movementNumber ?? 0,
    movementCount: track.movementCount ?? 0,
    composers: blank(track.composers),
  };
}

export function readRpmRelease(details: CatalogDetail): ReleaseDetail {
  const artist = blank(details.artist);
  const media = details.media ?? [];
  const discCount = media.length;
  const tracks: ReleaseTrack[] = [];

  if (media.length) {
    let overall = 0;
    for (const medium of media) {
      const disc = discCount > 1 ? medium.position : 0;
      medium.tracks.forEach((track, index) => {
        tracks.push(rpmTrack(track, artist, ++overall, disc, index + 1, discCount > 1 ? blank(medium.title) : null));
      });
    }
  } else {
    (details.tracks ?? []).forEach((track, index) => tracks.push(rpmTrack(track, artist, track.position || index + 1)));
  }

  return {
    provider: 'rpm',
    id: details.id,
    title: details.title,
    artist,
    year: details.year ?? 0,
    originalYear: details.originalYear ?? 0,
    country: blank(details.country),
    format: [...new Set(media.map((medium) => medium.format).filter(Boolean))].join(' + ') || null,
    tracks,
    discCount: discCount || (tracks.length ? 1 : 0),
    artistSort: blank(details.artistSort),
    artistId: blank(details.artistId),
    releaseGroupId: blank(details.releaseGroupId),
    barcode: blank(details.barcode),
    label: blank(details.label),
    catalogNumber: blank(details.catalogNumber),
    genre: blank(details.genre),
    subgenre: blank(details.subgenre),
    coverUrl: null,
  };
}

// Discogs.

// Discogs tells two acts of one name apart with a number: "Nirvana (2)". A name marked for a variation
// ends in a star.
export const discogsName = (name: string): string => name.replace(/\s*\(\d+\)\s*$/, '').replace(/\*+$/, '').trim();

export function splitDiscogsTitle(title: string): { artist: string | null; title: string } {
  const at = title.indexOf(' - ');
  return at > 0 ? { artist: discogsName(title.slice(0, at).trim()), title: title.slice(at + 3).trim() } : { artist: null, title: title.trim() };
}

interface DiscogsResult {
  type?: string;
  id?: number | string;
  title?: string;
  year?: string | number;
  country?: string;
  format?: string[];
  label?: string[];
  catno?: string;
  thumb?: string;
  cover_image?: string;
}

const discogsYear = (year: unknown): number => {
  if (typeof year === 'number') return year > 0 ? year : 0;
  return typeof year === 'string' && year.length >= 4 ? Number(year.slice(0, 4)) || 0 : 0;
};

export function readDiscogsSearch(json: { results?: DiscogsResult[] }, limit: number): ReleaseResult[] {
  const found: ReleaseResult[] = [];
  for (const result of json.results ?? []) {
    // A master is the abstract album. The results wanted are pressings.
    if (result.type && result.type.toLowerCase() !== 'release') continue;
    if (result.id === undefined || result.id === null || result.id === '') continue;
    const { artist, title } = splitDiscogsTitle(result.title ?? '');
    found.push({
      provider: 'discogs',
      id: String(result.id),
      title,
      artist,
      year: discogsYear(result.year),
      country: blank(result.country),
      format: blank(result.format?.join(', ')),
      trackCount: 0,
      label: blank(result.label?.[0]),
      catalogNumber: blank(result.catno),
      // Discogs orders by relevance and publishes no score, so position is the only signal.
      relevance: limit > 0 ? clamp(1 - found.length / limit, 0, 1) : 0,
      coverUrl: blank(result.thumb) ?? blank(result.cover_image),
    });
  }
  return found;
}

// "1-1", "2-3" or "CD2-05" on a set. A bare "1" or "A1" says nothing about a disc.
export function discogsDisc(position: string | null | undefined): number {
  const text = position?.trim();
  if (!text) return 0;
  const at = text.search(/[-.:]/);
  if (at <= 0) return 0;
  const digits = /(\d+)$/.exec(text.slice(0, at));
  return digits ? Number(digits[1]) : 0;
}

// "4:05" or "1:02:03".
export function discogsDuration(text: string | null | undefined): number | null {
  if (!text?.trim()) return null;
  const parts = text.trim().split(':').map(Number);
  if (parts.some((part) => Number.isNaN(part))) return null;
  return parts.reduce((total, part) => total * 60 + part, 0) || null;
}

interface DiscogsRow {
  type_?: string;
  position?: string;
  title?: string;
  duration?: string;
  artists?: { name?: string }[];
  sub_tracks?: DiscogsRow[];
}

interface DiscogsRelease {
  title?: string;
  year?: number | string;
  country?: string;
  formats?: { name?: string }[];
  artists?: { name?: string }[];
  labels?: { name?: string; catno?: string }[];
  tracklist?: DiscogsRow[];
  identifiers?: { type?: string; value?: string }[];
  genres?: string[];
  images?: { type?: string; uri?: string; uri150?: string }[];
}

const discogsArtists = (row: { artists?: { name?: string }[] }): string | null =>
  blank((row.artists ?? []).map((artist) => (artist.name ? discogsName(artist.name) : '')).filter(Boolean).join(', '));

const titleOf = (work: string | null, movement: string): string => {
  const name = movement.trim();
  if (!work) return name;
  const piece = work.trim();
  if (!name) return piece;
  return name.startsWith(piece) ? name : `${piece}: ${name}`;
};

// A tracklist holds tracks, headings for a side or a disc, and index rows whose movements sit one level
// down. Every classical release is written that way, so reading only the top level loses them.
function flattenDiscogs(list: readonly DiscogsRow[]) {
  const rows: { row: DiscogsRow; work: string | null; movement: number; movements: number; heading: string | null }[] = [];
  let heading: string | null = null;
  for (const entry of list) {
    const parts = entry.sub_tracks ?? [];
    if (parts.length) {
      parts.forEach((part, index) => {
        rows.push({ row: part, work: blank(entry.title), movement: index + 1, movements: parts.length, heading });
        heading = null;
      });
    } else if (entry.type_ === 'heading') {
      heading = blank(entry.title);
    } else if (!entry.type_ || entry.type_ === 'track') {
      rows.push({ row: entry, work: null, movement: 0, movements: 0, heading });
      heading = null;
    }
  }
  return rows;
}

export function readDiscogsRelease(json: DiscogsRelease, id: string): ReleaseDetail {
  const artist = discogsArtists(json);
  const perDisc = new Map<number, number>();
  const subtitles = new Map<number, string>();
  let discCount = 0;

  const tracks = flattenDiscogs(json.tracklist ?? []).map(({ row, work, movement, movements, heading }, index): ReleaseTrack => {
    const disc = discogsDisc(row.position);
    const discPosition = (perDisc.get(disc) ?? 0) + 1;
    perDisc.set(disc, discPosition);
    discCount = Math.max(discCount, disc);
    if (disc > 0 && heading && !subtitles.has(disc)) subtitles.set(disc, heading);
    return {
      position: index + 1,
      title: titleOf(work, row.title ?? ''),
      artist: discogsArtists(row) ?? artist,
      lengthSeconds: discogsDuration(row.duration),
      disc,
      discPosition,
      work,
      movementName: work ? blank(row.title) : null,
      movementNumber: movement,
      movementCount: movements,
    };
  });

  // A single disc carries no disc number, as a one-disc listing from the rpm database does not.
  for (const track of tracks) {
    if (discCount > 1) track.discSubtitle = subtitles.get(track.disc) ?? null;
    else track.disc = 0;
  }

  const label = json.labels?.find((entry) => entry.name || entry.catno);
  const images = json.images ?? [];
  const front = images.find((image) => image.type === 'primary') ?? images[0];

  return {
    provider: 'discogs',
    id,
    title: json.title ?? '',
    artist,
    year: discogsYear(json.year),
    originalYear: 0,
    country: blank(json.country),
    format: blank((json.formats ?? []).map((format) => format.name).filter(Boolean).join(', ')),
    tracks,
    discCount: discCount > 1 ? discCount : tracks.length ? 1 : 0,
    artistSort: null,
    artistId: null,
    releaseGroupId: null,
    barcode: blank(json.identifiers?.find((identifier) => identifier.type === 'Barcode')?.value),
    label: blank(label?.name ? discogsName(label.name) : null),
    catalogNumber: blank(label?.catno),
    genre: blank(json.genres?.[0]),
    subgenre: null,
    coverUrl: blank(front?.uri),
  };
}

// How well a listing fits the files in hand.

const TOLERANCE_SECONDS = 6;
export const GOOD_MATCH = 0.7;
const COUNT_ONLY_SCORE = 0.6;

function totalOnlyScore(detectedTotal: number, expectedTotal: number, countDelta: number): number {
  if (expectedTotal <= 0 || detectedTotal <= 0) return 0;
  const ceiling = clamp(0.55 - 0.1 * (countDelta - 1), 0.2, 0.55);
  return clamp(1 - (Math.abs(detectedTotal - expectedTotal) / detectedTotal) * 4, 0, 1) * ceiling;
}

export function measureMatch(expected: readonly (number | null)[], detected: readonly number[]): number {
  if (!expected.length || !detected.length) return 0;

  const detectedTotal = detected.reduce((sum, length) => sum + length, 0);
  const expectedTotal = expected.reduce<number>((sum, length) => sum + (length ?? 0), 0);

  // Counts differ: a different edition. Only the running time is left to weigh, under a ceiling.
  if (expected.length !== detected.length) return totalOnlyScore(detectedTotal, expectedTotal, Math.abs(expected.length - detected.length));

  let pairedDetected = 0;
  let pairedExpected = 0;
  let paired = 0;
  detected.forEach((length, index) => {
    const wanted = expected[index];
    if (!wanted || wanted <= 0) return;
    pairedDetected += length;
    pairedExpected += wanted;
    paired++;
  });
  if (!paired) return COUNT_ONLY_SCORE;

  const drift = pairedExpected > 0 ? pairedDetected / pairedExpected : 1;
  let sumError = 0;
  detected.forEach((length, index) => {
    const wanted = expected[index];
    if (wanted && wanted > 0) sumError += Math.abs(length - wanted * drift);
  });
  return 0.5 + 0.5 * clamp(1 - sumError / paired / TOLERANCE_SECONDS, 0, 1);
}

// The whole listing and each disc, whichever fits best, so a double album still appears when one of its
// discs is in hand.
export function fitOf(detail: ReleaseDetail, detected: readonly number[]): number {
  let best = measureMatch(detail.tracks.map((track) => track.lengthSeconds), detected);
  if (detail.discCount > 1) {
    for (const disc of new Set(detail.tracks.map((track) => track.disc).filter((value) => value > 0))) {
      best = Math.max(best, measureMatch(detail.tracks.filter((track) => track.disc === disc).map((track) => track.lengthSeconds), detected));
    }
  }
  return best;
}

// Which listing row each file is.

export interface TrackPlace {
  disc: number;
  track: number;
  title: string | null;
}

const placeNumber = (track: ReleaseTrack) => track.discPosition || track.position;

function byNumber(place: TrackPlace, listing: readonly ReleaseTrack[]): ReleaseTrack | null {
  if (!place.track) return null;
  const candidates = listing.filter((track) => placeNumber(track) === place.track && (!place.disc || !track.disc || track.disc === place.disc));
  if (candidates.length === 1) return candidates[0]!;
  const title = place.title?.trim().toLowerCase();
  return (title && candidates.find((track) => track.title.trim().toLowerCase() === title)) || null;
}

function byOrder(places: readonly TrackPlace[], listing: readonly ReleaseTrack[]): { matched: (ReleaseTrack | null)[]; discNumbersIgnored: boolean } {
  const matched: (ReleaseTrack | null)[] = places.map(() => null);
  const byDisc = new Map<number, number[]>();
  places.forEach((place, index) => byDisc.set(place.disc, [...(byDisc.get(place.disc) ?? []), index]));
  const listingNamesDiscs = listing.some((track) => track.disc > 0);

  // The files give discs and the listing does not, so there is no telling which half the second folder is.
  if (!listingNamesDiscs && byDisc.size > 1) return { matched, discNumbersIgnored: false };

  const inOrder = (tracks: readonly ReleaseTrack[]) => [...tracks].sort((a, b) => a.disc - b.disc || placeNumber(a) - placeNumber(b));

  // A disc the listing cannot hold is a wrong tag: a ripper that wrote "disc 1" on all twenty-four files of
  // a double album. With the counts exactly equal, the files are that release, so they are read as its
  // running order.
  if (listingNamesDiscs && places.length === listing.length && [...byDisc].some(([disc, rows]) => listing.filter((track) => track.disc === disc).length < rows.length)) {
    const whole = inOrder(listing);
    places.forEach((_, index) => (matched[index] = whole[index]!));
    return { matched, discNumbersIgnored: true };
  }

  for (const [disc, rows] of byDisc) {
    const side = inOrder(listingNamesDiscs ? listing.filter((track) => track.disc === disc) : listing);
    rows.forEach((row, index) => (matched[row] = side[index] ?? null));
  }
  return { matched, discNumbersIgnored: false };
}

export function matchTracks(places: readonly TrackPlace[], listing: readonly ReleaseTrack[]): { matched: (ReleaseTrack | null)[]; discNumbersIgnored: boolean } {
  if (!places.length || !listing.length) return { matched: places.map(() => null), discNumbersIgnored: false };
  return places.every((place) => !place.track) ? byOrder(places, listing) : { matched: places.map((place) => byNumber(place, listing)), discNumbersIgnored: false };
}

// The sources.

const searchAddress = (query: ReleaseQuery, media: ReleaseMedia, limit: number) => {
  const words = new URLSearchParams({ limit: String(limit) });
  if (query.album) words.set('text', query.album);
  if (query.artist) words.set('artist', query.artist);
  if (media !== 'any') words.set('media', media);
  if (query.catalogNumber) words.set('catno', query.catalogNumber);
  if (query.country) words.set('country', query.country);
  if (query.year) words.set('year', String(query.year));
  return words;
};

export const canSearch = (query: ReleaseQuery): boolean => !!(query.album.trim() || query.artist.trim() || query.catalogNumber.trim() || query.barcode.trim());

export class ReleaseLookup {
  constructor(private readonly api: Pick<Api, 'json'>) {}

  // Asking for one medium and getting none is not a real answer: a CD listing of the same master still
  // names the tracks. So the search widens, but only when the narrow one answered with nothing.
  async searchRpm(query: ReleaseQuery, limit = 25): Promise<ReleaseResult[]> {
    const ask = (media: ReleaseMedia) => this.api.json(`metadata/search?${searchAddress(query, media, limit)}`, (raw) => raw as CatalogRelease[]);
    let found = await ask(query.media);
    if (query.media !== 'any' && !found.length) found = await ask('any');
    return foldRpmSearch(found);
  }

  // Null when no Discogs account is connected.
  async searchDiscogs(query: ReleaseQuery, limit = 25): Promise<ReleaseResult[] | null> {
    const words = searchAddress(query, query.media, limit);
    const text = words.get('text');
    words.delete('text');
    if (text) words.set('q', text);
    if (query.barcode) words.set('barcode', query.barcode);
    try {
      return readDiscogsSearch(await this.api.json(`discogs/search?${words}`, (raw) => raw as { results?: DiscogsResult[] }), limit);
    } catch (error) {
      if (error instanceof ApiError && error.status === 428) return null;
      throw error;
    }
  }

  async detail(result: Pick<ReleaseResult, 'provider' | 'id'>): Promise<ReleaseDetail> {
    if (result.provider === 'discogs') {
      return readDiscogsRelease(await this.api.json(`discogs/releases/${encodeURIComponent(result.id)}`, (raw) => raw as DiscogsRelease), result.id);
    }
    return readRpmRelease(await this.api.json(`metadata/release/${encodeURIComponent(result.id)}`, (raw) => raw as CatalogDetail));
  }

  // The address of a release's front cover, for a list row or for the record.
  async coverOf(result: Pick<ReleaseResult, 'provider' | 'id' | 'coverUrl'>, size: number): Promise<string | null> {
    if (result.coverUrl) return result.coverUrl;
    if (result.provider !== 'rpm') return null;
    const answer = await this.api.json(`metadata/release/${encodeURIComponent(result.id)}/cover?size=${size}`, (raw) => raw as { url?: string | null });
    return blank(answer.url);
  }
}
