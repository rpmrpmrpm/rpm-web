// The listener's public profile: the name and the picture shown beside their reviews and on shared shelves.
// The same profile the desktop's Settings edits.

import { ApiError, type Api } from './http';

export interface Profile {
  userId: string;
  displayName: string;
  hasAvatar: boolean;
  // Changes when the picture does, so a picture cached under the old stamp is not shown again.
  avatarUpdatedAt: number;
}

export type RenameOutcome = 'saved' | 'taken' | 'invalid' | 'failed';

// The store refuses a picture over 512 KB. A photo from a phone is far larger, so it is made smaller here.
const AVATAR_EDGE = 512;
const AVATAR_QUALITY = 0.86;

function readProfile(raw: unknown): Profile {
  const row = raw as Partial<Profile> | null;
  if (!row || typeof row.userId !== 'string') throw new ApiError(200, 'The profile has no id.');
  return { userId: row.userId, displayName: row.displayName ?? '', hasAvatar: row.hasAvatar === true, avatarUpdatedAt: row.avatarUpdatedAt ?? 0 };
}

// The picture as a square JPEG no larger than the store takes, cut from the middle of the one chosen.
export async function avatarBytes(file: Blob): Promise<Uint8Array> {
  const picture = await createImageBitmap(file);
  const side = Math.min(picture.width, picture.height);
  const edge = Math.min(AVATAR_EDGE, side);
  const canvas = new OffscreenCanvas(edge, edge);
  canvas.getContext('2d')!.drawImage(picture, (picture.width - side) / 2, (picture.height - side) / 2, side, side, 0, 0, edge, edge);
  picture.close();
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: AVATAR_QUALITY });
  return new Uint8Array(await blob.arrayBuffer());
}

export class Profiles {
  private readonly pictures = new Map<string, Promise<string | null>>();

  constructor(private readonly api: Pick<Api, 'json' | 'call'>) {}

  mine(): Promise<Profile> {
    return this.api.json('profile', readProfile);
  }

  async rename(name: string): Promise<RenameOutcome> {
    try {
      await this.api.call('profile', { method: 'PUT', body: { displayName: name.trim() } });
      return 'saved';
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) return 'taken';
      if (error instanceof ApiError && error.status === 400) return 'invalid';
      return 'failed';
    }
  }

  setAvatar(bytes: Uint8Array): Promise<Profile> {
    return this.api.json('profile/avatar', readProfile, { method: 'POST', raw: { bytes, type: 'image/jpeg' } });
  }

  clearAvatar(): Promise<Profile> {
    return this.api.json('profile/avatar', readProfile, { method: 'DELETE' });
  }

  // A blob address for the profile's picture, or null when it has none. Kept per stamp, so a new picture is
  // asked for once and an old one is never shown in its place.
  picture(profile: Profile): Promise<string | null> {
    if (!profile.hasAvatar) return Promise.resolve(null);
    const key = `${profile.userId}/${profile.avatarUpdatedAt}`;
    let held = this.pictures.get(key);
    if (!held) {
      held = this.api
        .call(`profiles/${encodeURIComponent(profile.userId)}/avatar?v=${profile.avatarUpdatedAt}`)
        .then(async (answer) => URL.createObjectURL(await answer.blob()))
        .catch(() => {
          this.pictures.delete(key);
          return null;
        });
      this.pictures.set(key, held);
    }
    return held;
  }
}
