// Every tag field the edit windows show, declared once, as the desktop's TagFields does. The track editor,
// the album editor and the mass edit all read this list, so a field is found under the same heading in each
// of them. A field's key is its name in the sidecar (TagSidecar), which holds the whole set of a track's
// tags in the cloud.

import { matchGenre } from './genres';
import subgenres from './subgenres.json';

// A track's tags as the sidecar names them. Every value is optional: absent, blank and zero all mean that
// the field says nothing.
export type TagSet = Record<string, unknown>;

// How many files a field is a fact about. It decides which window shows the field, not who may change it.
export type TagScope = 'track' | 'disc' | 'album';

export interface TagFieldOption {
  value: string;
  label: string;
}

export interface TagField {
  key: string;
  label: string;
  scope: TagScope;
  group: string;
  numeric?: boolean;
  // A short box: four digits, or two.
  width?: 'narrow' | 'tiny';
  multiline?: boolean;
  // A choice, not free text: the box is a list.
  options?: readonly TagFieldOption[];
  // Values worth offering in a box that can still be typed into.
  suggests?: 'genres' | 'styles';
  // A credit that names several people, one a line.
  lines?: boolean;
}

// The group headings, in the order a window lays them out.
export const GROUPS = {
  track: 'MassEdit_GroupTrack',
  release: 'MassEdit_GroupRelease',
  credits: 'MassEdit_GroupCredits',
  classical: 'MassEdit_GroupClassical',
  publishing: 'MassEdit_GroupPublishing',
  work: 'MassEdit_GroupWork',
  sorting: 'MassEdit_GroupSorting',
  pressing: 'MassEdit_GroupPressing',
  measured: 'MassEdit_GroupMeasured',
  reading: 'MassEdit_GroupReading',
  level: 'MassEdit_GroupLevel',
  identifiers: 'MassEdit_GroupIdentifiers',
} as const;

// The advisory flag. The value is a fixed token and only the label is translated, so a record tagged on one
// language reads back the same on another. The sidecar stores it as ContentAdvisory's number.
export const ADVISORY_OPTIONS: readonly TagFieldOption[] = [
  { value: '', label: 'Details_AdvisoryUnknown' },
  { value: 'explicit', label: 'Details_AdvisoryExplicit' },
  { value: 'clean', label: 'Details_AdvisoryClean' },
];

// The seven release types, by the names they are stored under (ReleaseTypes.ToStored on the desktop).
export const RELEASE_TYPE_OPTIONS: readonly TagFieldOption[] = [
  { value: 'Album', label: 'ReleaseType_Album' },
  { value: 'Ep', label: 'ReleaseType_Ep' },
  { value: 'Single', label: 'ReleaseType_Single' },
  { value: 'Live', label: 'ReleaseType_Live' },
  { value: 'Mixtape', label: 'ReleaseType_Mixtape' },
  { value: 'Compilation', label: 'ReleaseType_Compilation' },
  { value: 'Soundtrack', label: 'ReleaseType_Soundtrack' },
];

const field = (key: string, label: string, scope: TagScope, group: string, more: Partial<TagField> = {}): TagField => ({ key, label, scope, group, ...more });

export const TAG_FIELDS: readonly TagField[] = [
  // True of this file and nothing else.
  field('Title', 'Review_ColTitle', 'track', GROUPS.track),
  field('Artist', 'Review_ColArtist', 'track', GROUPS.track),
  field('TrackNumber', 'Details_TrackNo', 'track', GROUPS.track, { numeric: true, width: 'tiny' }),
  field('Bpm', 'Details_Bpm', 'track', GROUPS.measured, { numeric: true, width: 'narrow' }),
  field('Isrc', 'Details_Isrc', 'track', GROUPS.track),
  field('Grouping', 'Details_Grouping', 'track', GROUPS.track),
  field('Comment', 'Details_Comment', 'track', GROUPS.track, { multiline: true }),
  field('MusicalKey', 'Details_MusicalKey', 'track', GROUPS.measured, { width: 'narrow' }),
  field('Advisory', 'Details_Advisory', 'track', GROUPS.track, { options: ADVISORY_OPTIONS }),

  // A classical record's credits.
  field('Composers', 'Details_Composers', 'track', GROUPS.classical),
  field('Conductor', 'Details_Conductor', 'track', GROUPS.classical),
  field('Ensemble', 'Details_Ensemble', 'track', GROUPS.classical),
  // Two fields over one tag, the soloists: see withPerformers and withVocalists.
  field('Performers', 'Details_Performers', 'track', GROUPS.classical, { lines: true }),
  field('Vocalists', 'Details_Vocalists', 'track', GROUPS.classical, { lines: true }),
  field('Lyricist', 'Details_Lyricist', 'track', GROUPS.credits),
  field('Arranger', 'Details_Arranger', 'track', GROUPS.credits),
  field('RemixedBy', 'Details_RemixedBy', 'track', GROUPS.credits),

  // The composition a track is a movement of. Track scope: a record may hold three symphonies.
  field('Work', 'Details_Work', 'track', GROUPS.work),
  field('MovementName', 'Details_MovementName', 'track', GROUPS.work),
  field('MovementNumber', 'Details_Movement', 'track', GROUPS.work, { numeric: true, width: 'tiny' }),
  field('MovementCount', 'Details_MovementCount', 'track', GROUPS.work, { numeric: true, width: 'tiny' }),

  // How the shelf is ordered.
  field('TitleSort', 'Details_TitleSort', 'track', GROUPS.sorting),
  field('ArtistSort', 'Details_ArtistSort', 'track', GROUPS.sorting),
  field('ComposerSort', 'Details_ComposerSort', 'album', GROUPS.sorting),
  field('AlbumArtistSort', 'Details_AlbumArtistSort', 'album', GROUPS.sorting),

  // True of one disc of the release.
  field('DiscNumber', 'Details_Disc', 'disc', GROUPS.release, { numeric: true, width: 'tiny' }),
  field('TrackCount', 'Details_TrackCount', 'disc', GROUPS.track, { numeric: true, width: 'tiny' }),
  field('DiscSubtitle', 'Details_DiscSubtitle', 'disc', GROUPS.release),

  // True of the whole record.
  field('Album', 'Review_ColAlbum', 'album', GROUPS.release),
  field('AlbumArtist', 'Details_AlbumArtist', 'album', GROUPS.release),
  field('Year', 'Review_ColYear', 'album', GROUPS.release, { numeric: true, width: 'narrow' }),
  field('Genre', 'EditSel_Genre', 'album', GROUPS.release, { suggests: 'genres' }),
  field('Subgenre', 'EditSel_Subgenre', 'album', GROUPS.release, { suggests: 'styles' }),
  field('ReleaseType', 'Details_ReleaseType', 'album', GROUPS.release, { options: RELEASE_TYPE_OPTIONS }),
  field('DiscCount', 'Details_DiscCount', 'album', GROUPS.release, { numeric: true, width: 'tiny' }),
  field('Publisher', 'Details_Publisher', 'album', GROUPS.publishing),
  field('Copyright', 'Details_Copyright', 'album', GROUPS.publishing),

  // Which pressing this is.
  field('OriginalYear', 'Details_OriginalYear', 'album', GROUPS.pressing, { numeric: true, width: 'narrow' }),
  field('Media', 'Details_Media', 'album', GROUPS.pressing),
  field('CatalogNumber', 'Details_CatalogNumber', 'album', GROUPS.pressing),
  field('Barcode', 'Details_Barcode', 'album', GROUPS.pressing),
  field('ReleaseCountry', 'Details_ReleaseCountry', 'album', GROUPS.pressing, { width: 'narrow' }),

  // The MusicBrainz ids, each scoped to what it identifies.
  field('MusicBrainzRecordingId', 'Details_RecordingId', 'track', GROUPS.identifiers),
  field('MusicBrainzArtistId', 'Details_ArtistId', 'track', GROUPS.identifiers),
  field('MusicBrainzReleaseId', 'Details_ReleaseId', 'album', GROUPS.identifiers),
  field('MusicBrainzReleaseGroupId', 'Details_ReleaseGroupId', 'album', GROUPS.identifiers),
  field('MusicBrainzReleaseArtistId', 'Details_ReleaseArtistId', 'album', GROUPS.identifiers),
];

const BY_KEY = new Map(TAG_FIELDS.map((tag) => [tag.key, tag]));

export function tagField(key: string): TagField {
  const found = BY_KEY.get(key);
  if (!found) throw new Error(`No tag field ${key}.`);
  return found;
}

// The record's fields that a track's own field sits under: an album artist edited with "apply to tracks"
// also becomes each track's artist.
export const ALBUM_TO_TRACK: readonly [string, string][] = [
  ['AlbumArtist', 'Artist'],
  ['AlbumArtistSort', 'ArtistSort'],
];

// ── the soloists: one tag, read as two lists ──

const ENTRY_BREAK = /\s*;\s*|\r?\n|(?<=\))\s*,\s*/;
const VOICE_TYPES = new Set(['soprano', 'mezzo-soprano', 'mezzo', 'alto', 'contralto', 'countertenor', 'tenor', 'baritone', 'bass-baritone', 'treble', 'boy soprano']);

export const soloistEntries = (soloists: string | null | undefined): string[] =>
  soloists?.trim() ? soloists.split(ENTRY_BREAK).map((entry) => entry.trim()).filter(Boolean) : [];

// "Name (soprano)" or "Name (vocals)" is a singer. The role goes in brackets, as MusicBrainz writes it.
export function isVocalist(entry: string): boolean {
  const open = entry.indexOf('(');
  const close = entry.lastIndexOf(')');
  if (open < 0 || close <= open) return false;
  return entry
    .slice(open + 1, close)
    .split(',')
    .map((role) => role.trim().toLowerCase())
    .some((role) => role.includes('vocal') || role.includes('voice') || role.includes('singer') || VOICE_TYPES.has(role));
}

export const performersOf = (soloists: string | null | undefined): string[] => soloistEntries(soloists).filter((entry) => !isVocalist(entry));
export const vocalistsOf = (soloists: string | null | undefined): string[] => soloistEntries(soloists).filter(isVocalist);

export function joinSoloists(performers: readonly string[], vocalists: readonly string[]): string {
  const clean = (list: readonly string[]) => list.map((entry) => entry.trim()).filter(Boolean);
  const entries = [...clean(performers), ...clean(vocalists).map((entry) => (isVocalist(entry) ? entry : `${entry} (vocals)`))];
  return [...new Set(entries)].join('; ');
}

// ── reading and writing a field as the text in its box ──

const ADVISORY_NUMBERS: Record<string, number> = { '': 0, explicit: 1, clean: 2 };

const isBlank = (value: unknown) => value === null || value === undefined || value === '' || value === 0;

// What a field's box shows for this set of tags. A number that is not known shows as an empty box.
export function readField(tags: TagSet, key: string): string {
  if (key === 'Performers') return performersOf(tags.Soloists as string).join('; ');
  if (key === 'Vocalists') return vocalistsOf(tags.Soloists as string).join('; ');
  if (key === 'Advisory') return Object.keys(ADVISORY_NUMBERS).find((token) => ADVISORY_NUMBERS[token] === Number(tags.Advisory ?? 0)) ?? '';
  const value = tags[key];
  return isBlank(value) ? '' : String(value).trim();
}

// The tags with one field set from the text of its box. A blank box empties the field.
export function writeField(tags: TagSet, key: string, text: string): TagSet {
  const value = text.trim();
  if (key === 'Performers') return withValue(tags, 'Soloists', joinSoloists(soloistEntries(value), vocalistsOf(tags.Soloists as string)));
  if (key === 'Vocalists') return withValue(tags, 'Soloists', joinSoloists(performersOf(tags.Soloists as string), soloistEntries(value)));
  if (key === 'Advisory') return withValue(tags, 'Advisory', ADVISORY_NUMBERS[value.toLowerCase()] ?? 0);
  const known = BY_KEY.get(key);
  if (known?.numeric) {
    const number = Number.parseInt(value.replace(/\D/g, ''), 10);
    return withValue(tags, key, Number.isFinite(number) && number > 0 ? number : 0);
  }
  return withValue(tags, key, value);
}

function withValue(tags: TagSet, key: string, value: unknown): TagSet {
  const next = { ...tags };
  if (isBlank(value)) delete next[key];
  else next[key] = value;
  return next;
}

// ── what a box offers ──

const SHELVES: readonly string[] = subgenres.shelves;
const STYLES: readonly (readonly [string, string])[] = subgenres.styles as [string, string][];

export const genreSuggestions = (): readonly string[] => SHELVES;

// The styles under the genre the record has. A genre the app does not know offers none, and the box can still
// be typed into.
export function styleSuggestions(genre: string | null | undefined): string[] {
  const shelf = matchGenre(genre);
  return shelf ? STYLES.filter(([, parent]) => parent === shelf).map(([name]) => name) : [];
}

// ── several tracks at once ──

// What a set of tracks says for one field: one value they all share, or the different values they hold.
export interface FieldSummary {
  agreed: boolean;
  // The value most of them carry, with ties going to the first seen. Empty when most say nothing.
  common: string;
  // Every value they hold, blank ones left out, most common first.
  values: string[];
}

export function summarise(sets: readonly TagSet[], key: string): FieldSummary {
  const counts = new Map<string, number>();
  for (const tags of sets) {
    const value = readField(tags, key);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return {
    agreed: counts.size <= 1,
    common: ranked[0]?.[0] ?? '',
    values: ranked.map(([value]) => value).filter(Boolean),
  };
}
