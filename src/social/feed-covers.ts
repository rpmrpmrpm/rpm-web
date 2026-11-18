// The covers on the Feed's review cards. A record in the reader's collection shows its own cover. Any other record
// shows the first cover the cover search finds, or the record glyph.
//
// The cover search (artwork/search) counts against a daily allowance per account, because it pays for a web search
// behind it. So each answer is kept in this browser, a month for a cover and a week for none, and a record is
// searched once, not on every visit. One search runs at a time, because a feed page asks for a cover for every
// review at once and the server answers a burst with 429. After a refusal or a failure no search is sent for a
// minute. A failure is never kept as "no cover".

import type { Api } from '../api/http';
import type { CloudAlbum } from '../library/albums';

const DAY = 24 * 60 * 60_000;
const FOUND_MS = 30 * DAY;
const NONE_MS = 7 * DAY;
const REST_MS = 60_000;
const KEY = 'rpm-feed-covers';

export interface KeptStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type Kept = Record<string, { at: number; address: string | null }>;

const fold = (value: string) => value.trim().toLocaleLowerCase();

// The reader's own copy of a reviewed record: the album with that title, by that artist where the review names
// one. Null when the collection does not hold it.
export function ownCopy(albums: readonly CloudAlbum[], title: string, artist: string): CloudAlbum | null {
  const wanted = fold(title);
  if (!wanted) return null;
  const by = fold(artist);
  return albums.find((album) => fold(album.album) === wanted && (!by || fold(album.artist) === by)) ?? null;
}

export class FeedCovers {
  private kept: Kept | null = null;
  private readonly asked = new Map<string, Promise<string | null>>();
  private queue: Promise<unknown> = Promise.resolve();
  private restUntil = 0;

  constructor(
    private readonly api: Pick<Api, 'json'>,
    private readonly store: () => KeptStore | null,
    private readonly clock: () => number = Date.now,
  ) {}

  private read(): Kept {
    if (this.kept) return this.kept;
    try {
      this.kept = JSON.parse(this.store()?.getItem(KEY) ?? '{}') as Kept;
    } catch {
      this.kept = {};
    }
    return this.kept;
  }

  private keep(key: string, address: string | null) {
    const kept = this.read();
    const now = this.clock();
    kept[key] = { at: now, address };
    for (const [at, entry] of Object.entries(kept)) if (now - entry.at > (entry.address ? FOUND_MS : NONE_MS)) delete kept[at];
    try {
      this.store()?.setItem(KEY, JSON.stringify(kept));
    } catch {
      // Without storage the answer holds for this visit.
    }
  }

  // The address of the cover the search found for a record, on its own host, or null for none.
  found(artist: string, title: string): Promise<string | null> {
    if (!title.trim()) return Promise.resolve(null);
    const key = `${fold(artist)}\u001f${fold(title)}`;
    const kept = this.read()[key];
    if (kept && this.clock() - kept.at < (kept.address ? FOUND_MS : NONE_MS)) return Promise.resolve(kept.address);

    // A record asked for twice while its search runs waits for that one search.
    let asking = this.asked.get(key);
    if (!asking) {
      asking = this.next(() => this.search(key, artist, title)).finally(() => this.asked.delete(key));
      this.asked.set(key, asking);
    }
    return asking;
  }

  private next<T>(run: () => Promise<T>): Promise<T> {
    const turn = this.queue.then(run, run);
    this.queue = turn.catch(() => {});
    return turn;
  }

  private async search(key: string, artist: string, title: string): Promise<string | null> {
    if (this.clock() < this.restUntil) return null;
    const words = new URLSearchParams({ limit: '1', artist: artist.trim(), album: title.trim() });
    try {
      const answer = await this.api.json(`artwork/search?${words}`, (raw) => raw as { results?: { thumbUrl?: string; fullUrl?: string }[] });
      const first = answer.results?.[0];
      const address = first ? first.thumbUrl || first.fullUrl || null : null;
      this.keep(key, address);
      return address;
    } catch {
      this.restUntil = this.clock() + REST_MS;
      return null;
    }
  }
}
