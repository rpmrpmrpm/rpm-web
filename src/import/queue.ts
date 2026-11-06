// The import queue. It is what is proposed: nothing leaves the browser until Import is pressed, and the
// user's own files are never changed. These are the workbench's rules. The ticks are the selection, and
// arranging and numbering are two different acts.

import { parseFilename } from './filename-tags';

// Every field the sidecar carries is read into this. The names are the sidecar's.
export interface TrackTags {
  Title?: string | null;
  Artist?: string | null;
  AlbumArtist?: string | null;
  Album?: string | null;
  Genre?: string | null;
  TrackNumber?: number;
  TrackCount?: number;
  DiscNumber?: number;
  DiscCount?: number;
  Year?: number;
  Composers?: string | null;
  Work?: string | null;
  MovementName?: string | null;
  MovementNumber?: number;
  DurationSeconds?: number;
  Channels?: number;
  SampleRate?: number;
  BitsPerSample?: number;
  BitrateKbps?: number;
  CodecDescription?: string | null;
  RpmId?: string | null;
  [field: string]: unknown;
}

export type RowState =
  | 'reading'
  | 'ready'
  | 'refused' // a format the store cannot hold
  | 'unreadable'
  | 'waiting' // ticked for import, its turn has not come
  | 'working'
  | 'done'
  | 'known' // the account already holds this audio
  | 'failed';

export interface ImportRow {
  id: string;
  file: File;
  path: string;
  extension: string;
  tags: TrackTags;
  hasArt: boolean;
  ticked: boolean;
  state: RowState;
  // A strings.json key: why it was refused or failed, or which stage it is in.
  note: string | null;
}

// ffmpeg has no muxer for these, so there is no canonical form of them to store.
export const CANNOT_STORE = new Set(['.alac', '.ape', '.mpc']);
export const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.flac', '.ogg', '.oga', '.opus', '.wav', '.aif', '.aiff', '.wma', '.alac', '.ape', '.wv', '.mpc']);
export const COVER_NAMES = ['cover', 'folder', 'front', 'album'];

export const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
};

export interface PickedFile {
  file: File;
  path: string;
}

export type ChipFilter = 'missing' | 'unreadable' | 'ticked';

export interface QueueGroup {
  key: string;
  album: string;
  artist: string;
  rows: ImportRow[];
}

const importable = (row: ImportRow) => row.state === 'ready' || row.state === 'failed';

export const tagsMissing = (row: ImportRow): boolean => !row.tags.Title || !row.tags.Artist || !row.tags.Album;

export class ImportQueue {
  rows: ImportRow[] = [];
  // Cover images that arrived with the audio, by folder.
  covers = new Map<string, File>();

  private nextId = 1;
  private readonly listeners = new Set<() => void>();

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  changed() {
    for (const listener of this.listeners) listener();
  }

  // Adds what was picked. A file already in the queue is not added twice. Returns the new rows.
  add(picked: readonly PickedFile[]): ImportRow[] {
    const known = new Set(this.rows.map((row) => `${row.path}|${row.file.size}`));
    const added: ImportRow[] = [];

    for (const { file, path } of picked) {
      const extension = extensionOf(file.name);
      const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';

      if (/\.(jpe?g|png|webp)$/i.test(file.name)) {
        const bare = file.name.replace(/\.[^.]*$/, '').toLowerCase();
        if (COVER_NAMES.includes(bare)) this.covers.set(folder, file);
        continue;
      }
      if (!AUDIO_EXTENSIONS.has(extension) || file.name.startsWith('.')) continue;
      if (known.has(`${path}|${file.size}`)) continue;

      const refused = CANNOT_STORE.has(extension);
      const row: ImportRow = {
        id: `row-${this.nextId++}`,
        file,
        path,
        extension,
        tags: {},
        hasArt: false,
        ticked: !refused,
        state: refused ? 'refused' : 'reading',
        note: refused ? 'Web_ImportCannotStore' : null,
      };
      this.rows.push(row);
      added.push(row);
    }
    this.changed();
    return added;
  }

  remove(rows: readonly ImportRow[]) {
    const gone = new Set(rows);
    this.rows = this.rows.filter((row) => !gone.has(row));
    this.changed();
  }

  // The rows an action works on: the ticked ones, or the row under the pointer when none are ticked.
  acting(fallback?: ImportRow): ImportRow[] {
    const ticked = this.rows.filter((row) => row.ticked);
    return ticked.length > 0 ? ticked : fallback ? [fallback] : [];
  }

  setAllTicks(ticked: boolean) {
    for (const row of this.rows) if (row.state !== 'refused') row.ticked = ticked;
    this.changed();
  }

  setTick(row: ImportRow, ticked: boolean) {
    row.ticked = ticked && row.state !== 'refused';
    this.changed();
  }

  // The records in the queue, in the order they first appear. A row's album comes from its tags, or its
  // folder before the tags are read.
  groups(): QueueGroup[] {
    const byKey = new Map<string, QueueGroup>();
    for (const row of this.rows) {
      const folder = row.path.includes('/') ? row.path.slice(0, row.path.lastIndexOf('/')) : '';
      const album = row.tags.Album ?? folder.split('/').pop() ?? '';
      const artist = row.tags.AlbumArtist || row.tags.Artist || '';
      const key = `${artist.toLowerCase()}|${album.toLowerCase()}`;
      if (!byKey.has(key)) byKey.set(key, { key, album, artist, rows: [] });
      byKey.get(key)!.rows.push(row);
    }
    return [...byKey.values()];
  }

  // Applies fields to rows. An empty string clears a text field.
  applyTags(rows: readonly ImportRow[], fields: Partial<TrackTags>) {
    for (const row of rows) Object.assign(row.tags, fields);
    this.changed();
  }

  // Writes 1, 2, 3 in the order the rows stand, per disc. Dragging never does this.
  numberTracks(rows: readonly ImportRow[]) {
    const order = this.rows.filter((row) => rows.includes(row));
    const next = new Map<string, number>();
    for (const row of order) {
      const key = `${row.tags.Album ?? ''}|${row.tags.DiscNumber ?? 0}`;
      const number = (next.get(key) ?? 0) + 1;
      next.set(key, number);
      row.tags.TrackNumber = number;
    }
    for (const row of order) {
      row.tags.TrackCount = next.get(`${row.tags.Album ?? ''}|${row.tags.DiscNumber ?? 0}`);
    }
    this.changed();
  }

  tagsFromFilename(rows: readonly ImportRow[], pattern: string): number {
    let changed = 0;
    for (const row of rows) {
      const found = parseFilename(row.path, pattern);
      if (!found) continue;
      changed++;
      if (found.title) row.tags.Title = found.title;
      if (found.artist) row.tags.Artist = found.artist;
      if (found.album) row.tags.Album = found.album;
      if (found.track) row.tags.TrackNumber = Number(found.track);
      if (found.disc) row.tags.DiscNumber = Number(found.disc);
      if (found.year) row.tags.Year = Number(found.year);
      if (found.genre) row.tags.Genre = found.genre;
    }
    this.changed();
    return changed;
  }

  // Moves rows to stand before another row. Arranging only: the track numbers stay as they are. Dropped
  // on another record, a row takes that record's identity and keeps its own title, artist and number.
  move(rows: readonly ImportRow[], before: ImportRow | null, into?: QueueGroup) {
    const moving = this.rows.filter((row) => rows.includes(row));
    if (moving.length === 0 || (before && moving.includes(before))) return;

    const rest = this.rows.filter((row) => !moving.includes(row));
    const at = before ? rest.indexOf(before) : rest.length;
    rest.splice(at, 0, ...moving);
    this.rows = rest;

    const model = into?.rows.find((row) => !moving.includes(row));
    if (model) {
      for (const row of moving) {
        row.tags.Album = model.tags.Album;
        row.tags.AlbumArtist = model.tags.AlbumArtist;
        row.tags.Year = model.tags.Year;
        row.tags.Genre = model.tags.Genre;
        row.tags.DiscNumber = model.tags.DiscNumber;
      }
    }
    this.changed();
  }

  importableRows(): ImportRow[] {
    return this.rows.filter((row) => row.ticked && importable(row));
  }

  // Counts are of the whole queue, never of what the chips already hid.
  counts() {
    return {
      total: this.rows.length,
      bytes: this.rows.reduce((sum, row) => sum + row.file.size, 0),
      seconds: this.rows.reduce((sum, row) => sum + (row.tags.DurationSeconds ?? 0), 0),
      missing: this.rows.filter(tagsMissing).length,
      unreadable: this.rows.filter((row) => row.state === 'unreadable' || row.state === 'refused').length,
      ticked: this.rows.filter((row) => row.ticked).length,
      done: this.rows.filter((row) => row.state === 'done' || row.state === 'known').length,
    };
  }
}
