// Changing the tags of tracks already in the cloud. The store merges: a blank field means "not being
// changed", so a tag can be replaced here and not cleared. An album's pictures and its mark are stored under
// keys made from its names, so they are carried across when a rename gives it a new key.

import type { Api } from '../api/http';
import type { CloudTrack } from '../api/wire';
import { normalizeMime, type Transfers } from '../import/importer';
import type { CloudAlbum } from './albums';
import { coverKeyForTrack, discKeyForTrack } from './art-key';
import type { Covers } from './covers';
import type { Favorites } from './favorites';

export interface TagEdit {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  genre?: string;
  year?: number;
  trackNumber?: number;
  discNumber?: number;
  composer?: string;
  work?: string;
}

const MOST_IN_ONE_PUSH = 200;

interface PushItem {
  rpmId: string;
  title?: string;
  artist?: string;
  album?: string;
  tags?: Partial<Record<'albumArtist' | 'genre' | 'composer' | 'work', string> & Record<'year' | 'trackNumber' | 'discNumber', number>>;
}

const given = (value: string | undefined) => (value?.trim() ? value.trim() : undefined);

// What changes on this track, or null when nothing does.
export function pushFor(track: CloudTrack, edit: TagEdit): PushItem | null {
  const item: PushItem = { rpmId: track.rpmId };
  const title = given(edit.title);
  const artist = given(edit.artist);
  const album = given(edit.album);
  if (title && title !== track.title) item.title = title;
  if (artist && artist !== track.artist) item.artist = artist;
  if (album && album !== track.album) item.album = album;

  const tags: NonNullable<PushItem['tags']> = {};
  const was = track.tags;
  for (const key of ['albumArtist', 'genre', 'composer', 'work'] as const) {
    const value = given(edit[key]);
    if (value && value !== was?.[key]) tags[key] = value;
  }
  for (const key of ['year', 'trackNumber', 'discNumber'] as const) {
    const value = edit[key];
    if (value && value > 0 && value !== was?.[key]) tags[key] = value;
  }
  if (Object.keys(tags).length) item.tags = tags;

  return Object.keys(item).length > 1 ? item : null;
}

export class CatalogEdits {
  constructor(
    private readonly api: Pick<Api, 'json' | 'call'>,
    private readonly covers: Pick<Covers, 'pictureAt' | 'reread'>,
    private readonly transfers: Transfers,
    private readonly favorites: Pick<Favorites, 'isAlbumMarked' | 'markAlbum'>,
  ) {}

  private async sendPicture(key: string, picture: { bytes: Uint8Array; mime: string }) {
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
  private async carryAlbum(album: CloudAlbum, edit: TagEdit) {
    const [first] = album.tracks;
    if (!first) return;
    const artist = first.artist;
    const albumArtist = first.tags?.albumArtist;
    const newAlbumArtist = given(edit.albumArtist) ?? albumArtist;
    const newAlbum = given(edit.album) ?? first.album;
    try {
      await this.carry(await coverKeyForTrack(albumArtist, artist, first.album), await coverKeyForTrack(newAlbumArtist, artist, newAlbum));
      await this.carry(await discKeyForTrack(albumArtist, artist, first.album), await discKeyForTrack(newAlbumArtist, artist, newAlbum));
      if (await this.favorites.isAlbumMarked(album)) {
        const renamed = album.tracks.map((track) => ({ ...track, album: newAlbum, tags: { ...track.tags, albumArtist: newAlbumArtist } }));
        await this.favorites.markAlbum({ ...album, tracks: renamed }, true);
      }
      this.covers.reread();
    } catch {
      // Best effort.
    }
  }

  // Returns how many tracks changed. A refusal throws, and what was already saved stays saved.
  async apply(tracks: readonly CloudTrack[], edit: TagEdit, album: CloudAlbum | null = null): Promise<number> {
    const items = tracks.flatMap((track) => pushFor(track, edit) ?? []);
    for (let at = 0; at < items.length; at += MOST_IN_ONE_PUSH) {
      await this.api.call('cloud/catalog/tags', { method: 'POST', body: { items: items.slice(at, at + MOST_IN_ONE_PUSH) } });
    }
    if (album && (given(edit.album) || given(edit.albumArtist))) await this.carryAlbum(album, edit);
    return items.length;
  }
}
