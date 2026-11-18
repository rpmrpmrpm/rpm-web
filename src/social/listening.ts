// Sends what plays in this browser to the reader's profile, as "listening to", as the desktop and the phones do:
// when a song starts, at most once a minute (a song that changes faster waits, and only the newest is sent), and
// again every twenty minutes while it plays, because the server stops showing a song thirty minutes after it was
// sent.
//
// The newest song wins, on whichever device it plays. The server keeps one song for the person, the last one sent.
// Two rules keep this browser from overwriting a newer song from another device: the twenty-minute send goes only
// while the server still shows this browser's song, and stopping clears the song only while it is still this
// browser's. Both read the profile first.
//
// note is called on every change of the player, many times a second while a song plays, so a note that changes
// nothing costs one comparison. A send waiting for its minute is cancelled by the next song or by a stop.

import type { Person, Song } from '../api/community';

const SPACING_MS = 60_000;
const REFRESH_MS = 20 * 60_000;

// What plays: identity tells one song from the next, and paused stops the twenty-minute send.
export interface Playing {
  identity: string;
  song: Song;
  paused: boolean;
}

export interface ListeningCalls {
  setListening(song: Song): Promise<void>;
  clearListening(): Promise<void>;
  ownPerson(): Promise<Person | null>;
}

const same = (a: Song, b: Song) => a.artist.toLowerCase() === b.artist.toLowerCase() && a.title.toLowerCase() === b.title.toLowerCase();

async function quietly(send: () => Promise<void>) {
  try {
    await send();
  } catch {
    // Offline or signed out: the next song tries again.
  }
}

export class ListeningShare {
  private identity: string | null = null;
  private sent: Song | null = null;
  private sentAt = 0;
  private waiting: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly calls: ListeningCalls,
    private readonly signedIn: () => boolean,
    private readonly clock: () => number = Date.now,
  ) {}

  note(playing: Playing | null) {
    if (!this.signedIn()) return;
    const identity = playing?.identity ?? null;
    if (identity === this.identity) {
      if (this.sent && playing && !playing.paused && this.waiting === null && this.clock() - this.sentAt >= REFRESH_MS) {
        this.sentAt = this.clock();
        void this.refresh(this.sent);
      }
      return;
    }
    this.identity = identity;
    this.plan(playing?.song ?? null);
  }

  private plan(song: Song | null) {
    if (this.waiting !== null) clearTimeout(this.waiting);
    this.waiting = null;
    if (!song) {
      const gone = this.sent;
      if (gone) {
        this.sent = null;
        this.sentAt = 0;
        void this.clear(gone);
      }
      return;
    }
    if (this.sent && same(this.sent, song)) return;

    const wait = this.sentAt === 0 ? 0 : SPACING_MS - (this.clock() - this.sentAt);
    if (wait <= 0) {
      this.send(song);
      return;
    }
    this.waiting = setTimeout(() => {
      this.waiting = null;
      this.send(song);
    }, wait);
  }

  private send(song: Song) {
    this.sent = song;
    this.sentAt = this.clock();
    void quietly(() => this.calls.setListening(song));
  }

  private async shown(): Promise<Song | null> {
    try {
      return (await this.calls.ownPerson())?.listening ?? null;
    } catch {
      return null;
    }
  }

  // Sends the song again, while the server still shows it as this browser's.
  private async refresh(sent: Song) {
    const shown = await this.shown();
    if (shown === null || same(shown, sent)) await quietly(() => this.calls.setListening(sent));
  }

  // Clears the song, while the server still shows this browser's: a newer song from another device stays.
  private async clear(sent: Song) {
    const shown = await this.shown();
    if (shown && same(shown, sent)) await quietly(() => this.calls.clearListening());
  }
}
