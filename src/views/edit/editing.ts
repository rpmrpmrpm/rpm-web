// What the three edit windows share: the record a track is on, what the other tracks of it say, and how a
// picture is shown.

import type { CloudTrack } from '../../api/wire';
import { catalogue } from '../../app';
import type { CloudAlbum } from '../../library/albums';
import type { Picture } from '../../library/edit';
import { readField, type TagSet } from '../../library/tag-fields';
import { text } from '../../strings/loc';

export const albumOf = (track: CloudTrack): CloudAlbum | null => catalogue.albums.find((album) => album.tracks.some((row) => row.rpmId === track.rpmId)) ?? null;

// What the other tracks say for a field, when they do not all hold this value: the desktop's marker text.
export function disagreement(key: string, mine: string, others: readonly TagSet[]): string | null {
  const values = others.map((tags) => readField(tags, key).trim()).filter((value) => value !== mine.trim());
  if (!values.length) return null;
  const distinct = [...new Set(values)];
  return distinct.length === 1 ? text('Edit_AlbumDisagrees', values.length, distinct[0]!) : text('Edit_AlbumDisagreesMany');
}

export const addressOf = (picture: Picture): string => URL.createObjectURL(new Blob([picture.bytes as BlobPart], { type: picture.mime }));

// Which disc a track is on. Zero is a record that does not say.
export const discOf = (tags: TagSet): number => Number(tags.DiscNumber ?? 0) || 0;
