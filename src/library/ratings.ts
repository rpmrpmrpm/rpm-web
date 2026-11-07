// The stars given to records, 1 to 5. Kept in this browser, by account and the record's first cover key, as
// the phone apps keep them: the cloud has no route for a rating.

import type { CloudAlbum } from './albums';
import { coverSpellings } from './art-key';

export const MOST_STARS = 5;

type Shelf = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export class AlbumRatings {
  constructor(private readonly shelf: () => Shelf) {}

  private async key(album: CloudAlbum, account: string): Promise<string> {
    const [cover] = await coverSpellings(album.tracks);
    return `rpm.albumRating.${account}|${cover ?? album.key}`;
  }

  async stars(album: CloudAlbum, account: string): Promise<number> {
    const key = await this.key(album, account);
    try {
      return Number(this.shelf().getItem(key)) || 0;
    } catch {
      return 0;
    }
  }

  // 0 clears the rating.
  async rate(album: CloudAlbum, stars: number, account: string) {
    const key = await this.key(album, account);
    try {
      if (stars <= 0) this.shelf().removeItem(key);
      else this.shelf().setItem(key, String(Math.min(stars, MOST_STARS)));
    } catch {
      // Storage that is blocked keeps no rating.
    }
  }
}
