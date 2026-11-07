// Changing the tags of tracks already in the cloud, as the desktop does for a track whose file is not on the
// computer. Two places hold a track's tags, and an edit is written to both:
//
// - the catalogue row, which every list draws from. It holds the names and the fields the library is browsed
//   by. A blank there means "not known", so a field the user emptied is named in the push's clear list.
// - the sidecar, which holds every tag, the lyrics and the cover, and is what a restore writes into the file.
//
// An album's pictures and its mark are stored under keys made from its names, so they are carried across
// when a rename gives the record a new key.

import type { Api } from '../api/http';
import type { CloudTrack } from '../api/wire';
import { base64, normalizeMime, type Transfers } from '../import/importer';
import type { CloudAlbum } from './albums';
import { coverKeyForTrack, coverSpellings, discKeyForTrack } from './art-key';
import type { Covers } from './covers';
import type { Favorites, Mark } from './favorites';
import type { Sidecars } from './sidecars';
import { TAG_FIELDS, type TagSet } from './tag-fields';

const MOST_IN_ONE_PUSH = 200;
const SIDECARS_AT_ONCE = 4;

// The names, which the row keeps outside its tags. They cannot be emptied: every list draws them.
const NAME_FIELDS: readonly [string, 'title' | 'artist' | 'album'][] = [
  ['Title', 'title'],
  ['Artist', 'artist'],
  ['Album', 'album'],
];

// The sidecar's name for each field the row's tags carry, and the row's name for it.
const ROW_TAGS: readonly [string, string][] = [
  ['AlbumArtist', 'albumArtist'],
  ['Genre', 'genre'],
  ['Year', 'year'],
  ['TrackNumber', 'trackNumber'],
  ['TrackCount', 'trackCount'],
  ['DiscNumber', 'discNumber'],
  ['DiscCount', 'discCount'],
  ['Composers', 'composer'],
  ['Work', 'work'],
  ['MovementName', 'movementName'],
  ['MovementNumber', 'movementNumber'],
  ['Advisory', 'advisory'],
  ['CatalogNumber', 'catno'],
  ['Barcode', 'barcode'],
  ['MusicBrainzReleaseId', 'mbReleaseId'],
  ['ReleaseType', 'releaseType'],
];

// Every sidecar field an edit window can change. The two credit lists are one tag, the soloists.
export const EDITABLE_KEYS: readonly string[] = [...TAG_FIELDS.map((tag) => tag.key).filter((key) => key !== 'Performers' && key !== 'Vocalists'), 'Soloists', 'Lyrics'];

const blank = (value: unknown) => value === null || value === undefined || value === 0 || (typeof value === 'string' && value.trim() === '');
const same = (a: unknown, b: unknown) => (blank(a) && blank(b)) || (!blank(a) && !blank(b) && String(a).trim() === String(b).trim());

// The row as the sidecar would name it.
export function rowTags(track: CloudTrack): TagSet {
  const tags: TagSet = {};
  for (const [key, prop] of NAME_FIELDS) if (!blank(track[prop])) tags[key] = track[prop];
  const row = (track.tags ?? {}) as Record<string, unknown>;
  for (const [key, wire] of ROW_TAGS) if (!blank(row[wire])) tags[key] = row[wire];
  return tags;
}

// What a window shows for a track: the sidecar's whole set, with the row's values over it. The row is what
// every list draws, so where the two disagree the row is what the user knows the track by. The cover stays
// out: it is large, and the windows show the record's own picture.
export function tagsFor(track: CloudTrack, sidecar: TagSet | null): TagSet {
  const { Art: _art, ArtMime: _mime, ...rest } = sidecar ?? {};
  return { ...rest, ...rowTags(track) };
}

export interface PushItem {
  rpmId: string;
  title?: string;
  artist?: string;
  album?: string;
  tags?: Record<string, unknown>;
  clear?: string[];
}

// What changes on the row, or null when nothing does. A row's tags always carry the favourite mark (the store
// writes it with every set of tags), so the mark as it stands is sent with them, or the edit would take it off.
export function pushFor(track: CloudTrack, tags: TagSet, mark: Mark): PushItem | null {
  const item: PushItem = { rpmId: track.rpmId };
  for (const [key, prop] of NAME_FIELDS) {
    const value = tags[key];
    if (!blank(value) && !same(value, track[prop])) item[prop] = String(value).trim();
  }

  const row = (track.tags ?? {}) as Record<string, unknown>;
  const set: Record<string, unknown> = {};
  const clear: string[] = [];
  for (const [key, wire] of ROW_TAGS) {
    const value = tags[key];
    if (same(value, row[wire])) continue;
    if (blank(value)) clear.push(wire);
    else set[wire] = typeof value === 'string' ? value.trim() : value;
  }
  if (Object.keys(set).length) item.tags = { ...set, favorite: mark.on, favoritedAt: mark.on ? mark.at : 0 };
  if (clear.length) item.clear = clear;

  return Object.keys(item).length > 1 ? item : null;
}

export interface Picture {
  bytes: Uint8Array;
  mime: string;
}

// What happens to one of a record's pictures: a new one, taken off, or left alone (undefined).
export type PictureChange = Picture | 'remove' | undefined;

// The sidecar as it is now, with what the window changed written over it, emptied fields included. A field the
// window did not change keeps what the sidecar holds now, so a window that showed an older reading, or never
// read the field at all, cannot undo a change made somewhere else since. What is not a tag stays: the path,
// the id, what the audio is, the favourite mark.
export function mergeSidecar(sidecar: TagSet, before: TagSet, after: TagSet, cover: PictureChange): TagSet {
  const merged: TagSet = { ...sidecar };
  for (const key of EDITABLE_KEYS) {
    if (same(before[key], after[key])) continue;
    if (blank(after[key])) delete merged[key];
    else merged[key] = typeof after[key] === 'string' ? (after[key] as string).trim() : after[key];
  }
  if (cover === 'remove') {
    delete merged.Art;
    delete merged.ArtMime;
  } else if (cover) {
    merged.Art = base64(cover.bytes);
    merged.ArtMime = normalizeMime(cover.mime);
  }
  return merged;
}

// Whether the edit changes anything the sidecar holds.
export const changesSidecar = (before: TagSet, after: TagSet): boolean => EDITABLE_KEYS.some((key) => !same(before[key], after[key]));

export interface TrackEdit {
  track: CloudTrack;
  // As the window read it, and as it is to be.
  before: TagSet;
  after: TagSet;
}

export interface RecordPictures {
  cover?: PictureChange;
  disc?: PictureChange;
}

// A record's names, as its cover key is made from them.
interface RecordNames {
  albumArtist: string | null;
  artist: string | null;
  album: string | null;
}

const namesOf = (tags: TagSet): RecordNames => ({
  albumArtist: (tags.AlbumArtist as string) ?? null,
  artist: (tags.Artist as string) ?? null,
  album: (tags.Album as string) ?? null,
});

async function inTurn<T>(items: readonly T[], run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) await run(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(SIDECARS_AT_ONCE, items.length) }, lane));
}

export class CatalogEdits {
  constructor(
    private readonly api: Pick<Api, 'json' | 'call'>,
    private readonly covers: Pick<Covers, 'pictureAt' | 'reread'>,
    private readonly transfers: Transfers,
    private readonly favorites: Pick<Favorites, 'isAlbumMarked' | 'markAlbum'> & { marks: Pick<Favorites['marks'], 'markOf'> },
    private readonly sidecars: Pick<Sidecars, 'read' | 'write'>,
  ) {}

  // The whole set of tags of each track, for a window to show. A sidecar that cannot be read fails the read:
  // a window that showed the row alone would empty every other field when saved.
  async read(tracks: readonly CloudTrack[]): Promise<TagSet[]> {
    const sets: TagSet[] = new Array(tracks.length);
    await inTurn(
      tracks.map((track, index) => ({ track, index })),
      async ({ track, index }) => {
        sets[index] = tagsFor(track, await this.sidecars.read(track.rpmId));
      },
    );
    return sets;
  }

  private async sendPicture(key: string, picture: Picture) {
    const mime = normalizeMime(picture.mime);
    const slot = await this.api.json(`cloud/art/${key}?contentType=${encodeURIComponent(mime)}`, (raw) => raw as { url: string }, { method: 'POST' });
    await this.transfers.put(slot.url, picture.bytes, { contentType: mime });
  }

  private async carry(from: string, to: string) {
    if (from === to) return;
    const picture = await this.covers.pictureAt(from);
    if (picture) await this.sendPicture(to, picture);
  }

  // Best effort: the names are saved by now, and a sleeve that does not follow never undoes them.
  private async carryAlbum(album: CloudAlbum, before: RecordNames, after: RecordNames, pictures: RecordPictures) {
    try {
      if (pictures.cover === undefined) await this.carry(await coverKeyForTrack(before.albumArtist, before.artist, before.album), await coverKeyForTrack(after.albumArtist, after.artist, after.album));
      if (pictures.disc === undefined) await this.carry(await discKeyForTrack(before.albumArtist, before.artist, before.album), await discKeyForTrack(after.albumArtist, after.artist, after.album));
      if (await this.favorites.isAlbumMarked(album)) {
        const renamed = album.tracks.map((track) => ({ ...track, album: after.album, tags: { ...track.tags, albumArtist: after.albumArtist } }));
        await this.favorites.markAlbum({ ...album, tracks: renamed }, true);
      }
    } catch {
      // Best effort.
    }
  }

  // The record's pictures, under the keys its names give after the edit. A removed cover goes from every key
  // the record could have been stored under, or another spelling would bring it back.
  private async savePictures(tracks: readonly CloudTrack[], names: RecordNames, pictures: RecordPictures) {
    if (pictures.cover === 'remove') {
      for (const key of await coverSpellings(tracks)) await this.api.call(`cloud/art/${key}`, { method: 'DELETE' });
    } else if (pictures.cover) {
      await this.sendPicture(await coverKeyForTrack(names.albumArtist, names.artist, names.album), pictures.cover);
    }
    if (pictures.disc === 'remove') {
      await this.api.call(`cloud/art/${await discKeyForTrack(names.albumArtist, names.artist, names.album)}`, { method: 'DELETE' });
    } else if (pictures.disc) {
      await this.sendPicture(await discKeyForTrack(names.albumArtist, names.artist, names.album), pictures.disc);
    }
  }

  // Writes the edits. Returns how many tracks changed. A refusal throws, and what was already saved stays
  // saved, so saving again finishes the job.
  async save(edits: readonly TrackEdit[], album: CloudAlbum | null = null, pictures: RecordPictures = {}): Promise<number> {
    const items = edits.flatMap(({ track, after }) => pushFor(track, after, this.favorites.marks.markOf(track.rpmId)) ?? []);
    for (let at = 0; at < items.length; at += MOST_IN_ONE_PUSH) {
      await this.api.call('cloud/catalog/tags', { method: 'POST', body: { items: items.slice(at, at + MOST_IN_ONE_PUSH) } });
    }

    const written = edits.filter(({ before, after }) => changesSidecar(before, after) || pictures.cover !== undefined);
    await inTurn(written, async ({ track, before, after }) => {
      const sidecar = await this.sidecars.read(track.rpmId);
      if (sidecar) await this.sidecars.write(track.rpmId, mergeSidecar(sidecar, before, after, pictures.cover));
    });

    const [first] = edits;
    if (first) {
      const before = namesOf(first.before);
      const after = namesOf(first.after);
      if (pictures.cover !== undefined || pictures.disc !== undefined) await this.savePictures(album?.tracks ?? edits.map((edit) => edit.track), after, pictures);
      const renamed = !same(before.album, after.album) || !same(before.albumArtist, after.albumArtist) || (blank(after.albumArtist) && !same(before.artist, after.artist));
      if (album && renamed) await this.carryAlbum(album, before, after, pictures);
      if (renamed || pictures.cover !== undefined || pictures.disc !== undefined) this.covers.reread();
    }

    return new Set([...items.map((item) => item.rpmId), ...written.map((edit) => edit.track.rpmId)]).size;
  }
}
