// How the three edit windows lay their fields out: which tab, which column, which group, in which order. The
// fields come from the one catalogue (tag-fields.ts), and the layout is the desktop's, so a field is found in
// the same place in every window and on every computer.

import { icons } from '../../design/icons';
import { GROUPS, TAG_FIELDS, type TagField } from '../../library/tag-fields';

export interface Tab {
  id: string;
  label: string;
  glyph: string;
}

export const TABS = {
  basic: { id: 'basic', label: 'Details_TabBasic', glyph: icons.tag },
  credits: { id: 'credits', label: 'Details_TabCredits', glyph: icons.users },
  work: { id: 'work', label: 'Details_TabWork', glyph: icons.book },
  sound: { id: 'sound', label: 'Details_TabSound', glyph: icons.sliders },
  lyrics: { id: 'lyrics', label: 'Details_Lyrics', glyph: icons.alignLeft },
  artwork: { id: 'artwork', label: 'Details_Art', glyph: icons.image },
  settings: { id: 'settings', label: 'AlbumEdit_TabSettings', glyph: icons.settings },
} satisfies Record<string, Tab>;

// A group of rows under one heading. A row names its field, and a second field that shares the line, such as
// "Track [3] of [12]".
export interface Row {
  key: string;
  pair?: string;
}

export interface Group {
  heading: string;
  rows: Row[];
}

// The second number of a pair is drawn by the first, and has no row of its own.
export const PAIRS: Readonly<Record<string, string>> = {
  TrackNumber: 'TrackCount',
  DiscNumber: 'DiscCount',
  MovementNumber: 'MovementCount',
};

const PAIRED = new Set(Object.values(PAIRS));

const rows = (...keys: string[]): Row[] => keys.map((key) => (PAIRS[key] ? { key, pair: PAIRS[key] } : { key }));

// The per-file editor (TrackDetailsDialog).
export const TRACK_LAYOUT: Record<'basic' | 'credits' | 'work', [Group[], Group[]]> = {
  basic: [
    [{ heading: GROUPS.track, rows: rows('Title', 'Artist', 'TrackNumber', 'DiscNumber', 'Advisory', 'Isrc', 'Grouping', 'Comment') }],
    [{ heading: GROUPS.release, rows: rows('Album', 'AlbumArtist', 'Year', 'Genre', 'Subgenre', 'ReleaseType', 'DiscSubtitle') }],
  ],
  credits: [
    [
      { heading: GROUPS.classical, rows: rows('Composers', 'Conductor', 'Ensemble', 'Performers', 'Vocalists') },
      { heading: GROUPS.credits, rows: rows('Lyricist', 'Arranger', 'RemixedBy') },
    ],
    [{ heading: GROUPS.publishing, rows: rows('Publisher', 'Copyright') }],
  ],
  work: [
    [
      { heading: GROUPS.work, rows: rows('Work', 'MovementName', 'MovementNumber') },
      { heading: GROUPS.sorting, rows: rows('TitleSort', 'ArtistSort', 'AlbumArtistSort', 'ComposerSort') },
    ],
    [
      { heading: GROUPS.pressing, rows: rows('OriginalYear', 'Media', 'CatalogNumber', 'Barcode', 'ReleaseCountry') },
      { heading: GROUPS.identifiers, rows: rows('MusicBrainzRecordingId', 'MusicBrainzReleaseId', 'MusicBrainzReleaseGroupId', 'MusicBrainzArtistId', 'MusicBrainzReleaseArtistId') },
    ],
  ],
};

export const TRACK_SOUND: Group = { heading: GROUPS.measured, rows: rows('Bpm', 'MusicalKey') };

// The fields of one group in catalogue order, keeping only the ones a window offers.
function groupOf(heading: string, offered: (tag: TagField) => boolean): Group {
  const tags = TAG_FIELDS.filter((tag) => tag.group === heading && offered(tag));
  const keys = new Set(tags.map((tag) => tag.key));
  return {
    heading,
    rows: tags
      .filter((tag) => !(PAIRED.has(tag.key) && Object.entries(PAIRS).some(([first, second]) => second === tag.key && keys.has(first))))
      .map((tag) => (PAIRS[tag.key] && keys.has(PAIRS[tag.key]!) ? { key: tag.key, pair: PAIRS[tag.key] } : { key: tag.key })),
  };
}

const isRecord = (tag: TagField) => tag.scope === 'album';

// The album editor (AlbumEditDialog): the record's own fields. The disc fields are laid out apart, because
// a set of several discs has one row per disc.
export const ALBUM_LAYOUT: Record<'basic' | 'work', [Group[], Group[]]> = {
  basic: [[groupOf(GROUPS.release, isRecord)], [groupOf(GROUPS.publishing, isRecord)]],
  work: [[groupOf(GROUPS.pressing, isRecord)], [groupOf(GROUPS.sorting, isRecord), groupOf(GROUPS.identifiers, isRecord)]],
};

// Classical credits are a performance's, so they are per track. A classical record is played by one orchestra
// under one conductor, so the album editor offers them too.
export const ALBUM_CLASSICAL: Group = { heading: GROUPS.classical, rows: rows('Composers', 'Conductor', 'Ensemble', 'Performers', 'Vocalists') };

// Only the conductor settles a record whose tracks disagree. A recital's composers and an opera's singers differ
// from track to track on purpose.
export const ALBUM_SETTLES = new Set(['Conductor']);

// Fields that name one file. The mass edit never offers them: one value across a selection gives every track
// the same identity. The work is not here, because naming the work of four movements at once is what the
// window is for.
export const PER_FILE = new Set(['Title', 'TrackNumber', 'Lyrics', 'TitleSort', 'MovementNumber', 'MovementName', 'MusicalKey', 'MusicBrainzRecordingId']);

const massOffers = (tag: TagField) => !PER_FILE.has(tag.key);

// The mass edit (MassEditDialog).
export const MASS_LAYOUT: Record<'basic' | 'credits' | 'work', [Group[], Group[]]> = {
  basic: [[groupOf(GROUPS.release, massOffers)], [groupOf(GROUPS.track, massOffers), groupOf(GROUPS.measured, massOffers)]],
  credits: [[groupOf(GROUPS.classical, massOffers), groupOf(GROUPS.credits, massOffers)], [groupOf(GROUPS.publishing, massOffers)]],
  work: [[groupOf(GROUPS.work, massOffers), groupOf(GROUPS.pressing, massOffers)], [groupOf(GROUPS.sorting, massOffers), groupOf(GROUPS.identifiers, massOffers)]],
};

export const keysOf = (layout: Record<string, [Group[], Group[]]>): string[] =>
  Object.values(layout).flatMap((columns) => columns.flat().flatMap((group) => group.rows.flatMap((row) => (row.pair ? [row.key, row.pair] : [row.key]))));
