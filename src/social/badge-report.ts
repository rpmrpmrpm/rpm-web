// Works out the badges the reader's collection unlocks and sends the ones the server does not hold yet. The server
// keeps every badge once sent and notifies the reader of each new one.
//
// The work is a count over the albums already in memory. A collection whose badges were already sent sends nothing,
// so a library change costs the count alone. The count runs once per new album list, not on every change.

import type { Person } from '../api/community';
import type { CloudAlbum } from '../library/albums';
import { genreOfAlbum } from '../library/genres';
import { unlockedBadges } from './badges';

export interface BadgeCalls {
  ownPerson(): Promise<Person | null>;
  setBadges(unlocked: readonly string[], badge: string, badgeColour: string): Promise<void>;
}

export class BadgeReporter {
  // The badges this collection unlocks, for the edit page. Empty until the library is read.
  unlocked: string[] = [];

  private counted: readonly CloudAlbum[] | null = null;
  // The badge list last confirmed as held by the server, joined.
  private held = '';
  private sending = false;

  // The server took new badges. Each is a notification, so the Feed counts them again.
  onSent: () => void = () => {};

  constructor(
    private readonly calls: BadgeCalls,
    private readonly signedIn: () => boolean,
  ) {}

  note(albums: readonly CloudAlbum[]) {
    if (albums !== this.counted) {
      this.counted = albums;
      const genres = new Map<string, number>();
      let tracks = 0;
      for (const album of albums) {
        tracks += album.tracks.length;
        const genre = genreOfAlbum(album);
        genres.set(genre, (genres.get(genre) ?? 0) + 1);
      }
      this.unlocked = unlockedBadges(albums.length, tracks, genres);
    }
    const key = this.unlocked.join(',');
    if (key === this.held || this.unlocked.length === 0 || this.sending || !this.signedIn()) return;
    void this.send(key, this.unlocked);
  }

  private async send(key: string, unlocked: readonly string[]) {
    this.sending = true;
    try {
      const own = await this.calls.ownPerson();
      if (!own) return;
      if (unlocked.every((id) => own.badges.includes(id))) {
        this.held = key;
        return;
      }
      await this.calls.setBadges(unlocked, own.badge, own.badgeColour);
      this.held = key;
      this.onSent();
    } catch {
      // Tried again at the next library change.
    } finally {
      this.sending = false;
    }
  }
}
