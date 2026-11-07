// The import queue. It is what is proposed: nothing leaves the browser until Import is pressed, and the
// user's own files are never changed. These are the workbench's rules. The ticks are the selection, and
// arranging and numbering are two different acts.

import { cueAudioName, isAlbumFile } from './album-file';
import { parseFilename } from './filename-tags';
import type { ReleaseDetail, ReleaseTrack, TrackPlace } from './release';
import { matchTracks } from './release';
import { renderTemplate } from './tag-template';

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
  // A cover picked in the workbench. It goes in place of what the file or its folder has.
  cover: { bytes: Uint8Array; mime: string } | null;
  // The label of the disc, picked in the workbench. A file never carries one.
  disc: { bytes: Uint8Array; mime: string } | null;
  // Named from its file name: a guess, which Recognise is there to replace.
  guessed: boolean;
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

// What a past visit left of a row. The audio is not kept: see saved-queue.ts.
export interface SavedRow {
  path: string;
  size: number;
  tags: TrackTags;
  ticked: boolean;
  guessed: boolean;
  cover: ImportRow['cover'];
  disc: ImportRow['disc'];
}

// A row of an import that has not finished. The rest are done with, or cannot be imported at all.
const UNFINISHED = new Set<RowState>(['ready', 'waiting', 'working', 'failed']);

const keyOf = (path: string, size: number) => `${path}|${size}`;
const folderOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const stemOf = (name: string) => name.replace(/\.[^.]*$/, '');
const sameName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;

// A cue sheet picked with the files. Its text is read after it arrives, so what it names can come later.
interface CueSheet {
  stem: string;
  names: string | null;
}

export type ChipFilter = 'missing' | 'unreadable' | 'ticked' | 'duplicates';

// One line of a release laid against the files: what the file is now, and what it would become.
export interface FillLine {
  row: ImportRow;
  place: TrackPlace;
  track: ReleaseTrack | null;
  title: string;
  artist: string;
  selected: boolean;
}

const placeOf = (row: ImportRow): TrackPlace => ({ disc: row.tags.DiscNumber ?? 0, track: row.tags.TrackNumber ?? 0, title: row.tags.Title ?? null });

// What a tag's name in a pattern reads.
export function tokenValue(row: ImportRow, token: string): string | null {
  const tags = row.tags;
  const fields: Record<string, unknown> = {
    title: tags.Title,
    artist: tags.Artist,
    album: tags.Album,
    albumartist: tags.AlbumArtist,
    year: tags.Year,
    genre: tags.Genre,
    track: tags.TrackNumber,
    disc: tags.DiscNumber,
    composer: tags.Composers,
    publisher: tags.Publisher,
    file: row.file.name.replace(/\.[^.]*$/, ''),
  };
  const value = fields[token];
  return value === undefined || value === null || value === 0 ? null : String(value);
}

// "CD 2", "Disc2", "disk-3". Only a folder that says so gives a number.
export function discOfFolder(path: string): number {
  const folders = path.split('/').slice(0, -1);
  const last = folders[folders.length - 1] ?? '';
  const named = /^(?:cd|disc|disk|dis[ck]o|vol(?:ume)?)[\s._-]*(\d{1,2})\b/i.exec(last.trim());
  return named ? Number(named[1]) : 0;
}

export interface QueueGroup {
  key: string;
  album: string;
  artist: string;
  rows: ImportRow[];
}

const importable = (row: ImportRow) => row.state === 'ready' || row.state === 'failed';

export const tagsMissing = (row: ImportRow): boolean => !row.tags.Title || !row.tags.Artist || !row.tags.Album;

// Whether a row is the reason for a recognition run. It does not hold the row out of an import.
export const needsName = (row: ImportRow): boolean => !row.tags.Artist?.trim() || !row.tags.Title?.trim() || row.guessed;

export class ImportQueue {
  // Rows a past visit left, by path and size, until their files are added again.
  waiting = new Map<string, SavedRow>();

  private readonly cues = new Map<string, CueSheet[]>();

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

  // Adds what was picked. A file already in the queue is not added twice. Returns the new rows. Rows a
  // past visit left take the order they had then.
  add(picked: readonly PickedFile[]): ImportRow[] {
    const known = new Set(this.rows.map((row) => keyOf(row.path, row.file.size)));
    const added: ImportRow[] = [];

    for (const { file, path } of picked) {
      const extension = extensionOf(file.name);
      const folder = folderOf(path);

      if (extension === '.cue') {
        const sheet: CueSheet = { stem: stemOf(file.name), names: null };
        this.cues.set(folder, [...(this.cues.get(folder) ?? []), sheet]);
        void file
          .text()
          .then((text) => {
            sheet.names = cueAudioName(text);
            this.changed();
          })
          .catch(() => {});
        continue;
      }

      if (/\.(jpe?g|png|webp)$/i.test(file.name)) {
        const bare = file.name.replace(/\.[^.]*$/, '').toLowerCase();
        if (COVER_NAMES.includes(bare)) this.covers.set(folder, file);
        continue;
      }
      if (!AUDIO_EXTENSIONS.has(extension) || file.name.startsWith('.')) continue;
      if (known.has(keyOf(path, file.size))) continue;

      const refused = CANNOT_STORE.has(extension);
      const row: ImportRow = {
        id: `row-${this.nextId++}`,
        file,
        path,
        extension,
        tags: {},
        hasArt: false,
        ticked: !refused,
        cover: null,
        disc: null,
        guessed: false,
        state: refused ? 'refused' : 'reading',
        note: refused ? 'Web_ImportCannotStore' : null,
      };
      added.push(row);
    }

    const places = [...this.waiting.keys()];
    const placeOfRow = (row: ImportRow) => {
      const place = places.indexOf(keyOf(row.path, row.file.size));
      return place < 0 ? places.length : place;
    };
    added.sort((a, b) => placeOfRow(a) - placeOfRow(b));
    this.rows.push(...added);
    this.changed();
    return added;
  }

  // The sheet that describes a file: one of the same name, or else the folder's only one if it names the file.
  private hasCue(row: ImportRow): boolean {
    const sheets = this.cues.get(folderOf(row.path)) ?? [];
    const stem = stemOf(row.file.name);
    if (sheets.some((sheet) => sameName(sheet.stem, stem))) return true;
    return sheets.length === 1 && sheets[0]!.names !== null && sameName(sheets[0]!.names, row.file.name);
  }

  // The rows that look like a whole album in one file, among those still to be imported.
  albumFiles(): Set<ImportRow> {
    const inFolder = new Map<string, number>();
    for (const row of this.rows) {
      const folder = folderOf(row.path);
      inFolder.set(folder, (inFolder.get(folder) ?? 0) + 1);
    }

    const found = new Set<ImportRow>();
    for (const row of this.rows) {
      if (!UNFINISHED.has(row.state)) continue;
      const looksLikeOne = isAlbumFile({
        stem: stemOf(row.file.name),
        seconds: row.tags.DurationSeconds ?? 0,
        trackNumber: row.tags.TrackNumber ?? 0,
        trackCount: row.tags.TrackCount ?? 0,
        folderFiles: inFolder.get(folderOf(row.path))!,
        hasCue: this.hasCue(row),
      });
      if (looksLikeOne) found.add(row);
    }
    return found;
  }

  // A row's file has been read. What a past visit did to it stands above what the file says.
  read(row: ImportRow, tags: TrackTags, hasArt: boolean) {
    const key = keyOf(row.path, row.file.size);
    const saved = this.waiting.get(key);
    row.tags = saved?.tags ?? tags;
    row.hasArt = hasArt;
    row.state = 'ready';
    if (saved) {
      row.ticked = saved.ticked;
      row.guessed = saved.guessed;
      row.cover = saved.cover;
      row.disc = saved.disc;
      this.waiting.delete(key);
    }
    this.changed();
  }

  restore(rows: readonly SavedRow[]) {
    this.waiting = new Map(rows.map((row) => [keyOf(row.path, row.size), row]));
    this.changed();
  }

  // What is worth keeping for a next visit, in the order it stands now.
  keepable(): SavedRow[] {
    const here = this.rows
      .filter((row) => UNFINISHED.has(row.state))
      .map((row) => ({ path: row.path, size: row.file.size, tags: row.tags, ticked: row.ticked, guessed: row.guessed, cover: row.cover, disc: row.disc }));
    return [...here, ...this.waiting.values()];
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
    for (const row of rows) {
      Object.assign(row.tags, fields);
      if ('Title' in fields || 'Artist' in fields) row.guessed = false;
    }
    this.changed();
  }

  // What Recognise found. An answer with no album or year leaves what the file has.
  applyRecognition(row: ImportRow, answer: { title: string; artist: string; album: string | null; year: number }) {
    row.tags.Title = answer.title;
    row.tags.Artist = answer.artist;
    if (answer.album?.trim()) row.tags.Album = answer.album;
    if (answer.year > 0) row.tags.Year = answer.year;
    row.guessed = false;
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

  setCover(rows: readonly ImportRow[], cover: ImportRow['cover']) {
    for (const row of rows) row.cover = cover;
    this.changed();
  }

  // Writes one tag from a pattern over the others. Returns how many rows changed.
  setDisc(rows: readonly ImportRow[], disc: ImportRow['disc']) {
    for (const row of rows) row.disc = disc;
    this.changed();
  }

  tagsFromTags(rows: readonly ImportRow[], pattern: string, target: keyof TrackTags & string): number {
    let written = 0;
    for (const row of rows) {
      const value = renderTemplate(pattern, (token) => tokenValue(row, token));
      if (!value || row.tags[target] === value) continue;
      row.tags = { ...row.tags, [target]: value };
      written++;
    }
    this.changed();
    return written;
  }

  // Gives a disc number from each file's folder. A folder that does not say leaves the row as it is.
  numberDiscs(rows: readonly ImportRow[]): number {
    let written = 0;
    for (const row of rows) {
      const disc = discOfFolder(row.path);
      if (!disc || row.tags.DiscNumber === disc) continue;
      row.tags = { ...row.tags, DiscNumber: disc };
      written++;
    }
    if (written) {
      const count = Math.max(...rows.map((row) => row.tags.DiscNumber ?? 0));
      for (const row of rows) row.tags = { ...row.tags, DiscCount: count };
    }
    this.changed();
    return written;
  }

  // The second and later copies of one song: the same size and the same words. A file that was only
  // renamed is a duplicate, and two takes with the same title are not.
  duplicates(): ImportRow[] {
    const seen = new Set<string>();
    return this.rows.filter((row) => {
      const key = [row.file.size, row.tags.Title, row.tags.Artist, row.tags.Album].join('|');
      if (seen.has(key)) return true;
      seen.add(key);
      return false;
    });
  }

  // A release laid against these files, in the record's own running order.
  fillFrom(rows: readonly ImportRow[], detail: ReleaseDetail): FillLine[] {
    const order = [...rows].sort(
      (a, b) => (a.tags.DiscNumber ?? 0) - (b.tags.DiscNumber ?? 0) || (a.tags.TrackNumber ?? 0) - (b.tags.TrackNumber ?? 0) || a.path.localeCompare(b.path),
    );
    const places = order.map(placeOf);
    const { matched, discNumbersIgnored } = matchTracks(places, detail.tracks);
    return order.map((row, index) => {
      const track = matched[index] ?? null;
      return {
        row,
        place: discNumbersIgnored ? { ...places[index]!, disc: 0 } : places[index]!,
        track,
        title: track?.title ?? '',
        artist: track?.artist ?? '',
        selected: track !== null,
      };
    });
  }

  // Returns how many rows took something from the release.
  applyFill(lines: readonly FillLine[], detail: ReleaseDetail, albumFields: boolean): number {
    let named = 0;
    for (const line of lines) {
      const fields: Partial<TrackTags> = {};
      const track = line.selected ? line.track : null;
      if (track) {
        Object.assign(fields, {
          Title: line.title,
          Artist: line.artist || null,
          TrackNumber: track.discPosition || track.position,
          ...(line.place.disc === 0 && track.disc ? { DiscNumber: track.disc } : {}),
          ...(track.discSubtitle ? { DiscSubtitle: track.discSubtitle } : {}),
          ...(track.artistSort ? { ArtistSort: track.artistSort } : {}),
          ...(track.recordingId ? { MusicBrainzRecordingId: track.recordingId } : {}),
          ...(track.artistId ? { MusicBrainzArtistId: track.artistId } : {}),
          ...(track.isrc ? { Isrc: track.isrc } : {}),
          ...(track.work ? { Work: track.work, MovementName: track.movementName, MovementNumber: track.movementNumber, MovementCount: track.movementCount } : {}),
          ...(track.composers ? { Composers: track.composers } : {}),
        });
        named++;
      }
      if (albumFields) {
        const disc = track?.disc ?? 0;
        Object.assign(fields, {
          Album: detail.title,
          ...(detail.artist ? { AlbumArtist: detail.artist } : {}),
          ...(detail.year ? { Year: detail.year } : {}),
          ...(detail.originalYear ? { OriginalYear: detail.originalYear } : {}),
          ...(detail.label ? { Publisher: detail.label } : {}),
          ...(detail.catalogNumber ? { CatalogNumber: detail.catalogNumber } : {}),
          ...(detail.barcode ? { Barcode: detail.barcode } : {}),
          ...(detail.country ? { ReleaseCountry: detail.country } : {}),
          ...(detail.genre ? { Genre: detail.genre } : {}),
          ...(detail.subgenre ? { Subgenre: detail.subgenre } : {}),
          ...(detail.discCount ? { DiscCount: detail.discCount } : {}),
          TrackCount: detail.tracks.filter((row) => row.disc === disc).length,
          ...(detail.provider === 'rpm' ? { MusicBrainzReleaseId: detail.id } : {}),
          ...(detail.releaseGroupId ? { MusicBrainzReleaseGroupId: detail.releaseGroupId } : {}),
          ...(detail.artistId ? { MusicBrainzReleaseArtistId: detail.artistId } : {}),
        });
      }
      if (Object.keys(fields).length) line.row.tags = { ...line.row.tags, ...fields };
    }
    this.changed();
    return named;
  }

  tagsFromFilename(rows: readonly ImportRow[], pattern: string): number {
    let changed = 0;
    for (const row of rows) {
      const found = parseFilename(row.path, pattern);
      if (!found) continue;
      changed++;
      if (found.title) row.tags.Title = found.title;
      if (found.artist) row.tags.Artist = found.artist;
      if (found.title || found.artist) row.guessed = true;
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
