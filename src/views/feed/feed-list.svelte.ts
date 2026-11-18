// A list of feed cards, read a page at a time: everyone's feed, or one person's. It follows the pages as the
// column scrolls and sends votes.
//
// What arrives on its own schedule, and what keeps each pair safe. Every continuation runs on the one thread, so
// two of these never run at the same time; only their order varies.
// - A read and an older read: each read takes a ticket (newest). An answer whose ticket is not the newest is
//   dropped.
// - A further page and a read: the page keeps the ticket it started under and is dropped if a read started
//   since. Two further pages never run together (readingMore).
// - A vote answer and a read: the answer is applied by key to whatever entry holds that key now. A fresh read
//   that brought the same entry back is given the server's newer counts, which is correct.
// - Two votes on one entry: only the answer to the latest vote sent for that key is applied (votesSent), so a
//   slow first answer cannot overwrite the second.
// - A review read in full and a vote: the reader page shows the same entry, so a vote from either redraws both.

import type { Community, FeedItem, FeedPage, Post } from '../../api/community';

// How many empty pages in a row are read before stopping. A page is empty when everything on it was by a person
// the reader blocked; the server still gives the next page.
const EMPTY_PAGES_IN_A_ROW = 5;

// A post by its id; a review by its author and album, because two people's reviews of one record stand side by side.
export const keyOf = (item: FeedItem): string => (item.kind === 'post' ? `post:${item.post.postId}` : `review:${item.review.userId}:${item.review.albumId}`);

export class FeedEntry {
  item = $state.raw<FeedItem>(null!);

  constructor(
    readonly key: string,
    item: FeedItem,
  ) {
    this.item = item;
  }
}

export class FeedList {
  entries = $state.raw<FeedEntry[]>([]);
  // The string key of the line that says the list is empty or could not be read; null for none.
  quiet = $state<string | null>(null);
  // When the first page was last asked for. 0 asks again the next time the list is shown.
  readAt = 0;

  private newest = 0;
  private readingMore = false;
  private next: number | null = null;
  private readonly votesSent = new Map<string, number>();

  constructor(
    private readonly read: (before: number | null) => Promise<FeedPage | null>,
    // Everyone's feed: reviews carry their author's line, and names open the person's page. On a person's own page
    // every entry is theirs, so neither is drawn.
    readonly everyone: boolean,
    private readonly emptyKey: string,
    // Give every post the key in its corner that opens its menu (delete or report), as a person's page does.
    readonly postMenus: boolean,
    private readonly votes: Pick<Community, 'votePost' | 'voteReview'>,
  ) {}

  get hasMore(): boolean {
    return this.next !== null;
  }

  async readFirst() {
    const ticket = ++this.newest;
    this.readAt = Date.now();
    let page: FeedPage | null;
    try {
      page = await this.read(null);
    } catch {
      page = null;
    }
    if (ticket !== this.newest) return;

    if (!page) {
      // Read again on the next show: there is nothing on screen to keep.
      this.readAt = 0;
      if (this.entries.length === 0) this.quiet = 'Rpm_Profile_Offline';
      return;
    }

    this.votesSent.clear();
    this.next = page.next;
    this.entries = page.items.map((item) => new FeedEntry(keyOf(item), item));
    this.quiet = this.entries.length === 0 && this.next === null ? this.emptyKey : null;
    if (this.entries.length === 0 && this.next !== null) await this.more();
  }

  // Reads the next page, and the ones after it while they come back empty.
  async more() {
    if (this.readingMore || this.next === null) return;
    this.readingMore = true;
    try {
      const ticket = this.newest;
      for (let empty = 0; this.next !== null && empty < EMPTY_PAGES_IN_A_ROW; empty++) {
        let page: FeedPage | null;
        try {
          page = await this.read(this.next);
        } catch {
          return;
        }
        if (ticket !== this.newest || !page) return;

        this.next = page.next;
        const known = new Set(this.entries.map((entry) => entry.key));
        const added = page.items.filter((item) => !known.has(keyOf(item))).map((item) => new FeedEntry(keyOf(item), item));
        this.entries = [...this.entries, ...added];
        if (added.length) break;
      }
      if (this.entries.length === 0 && this.next === null) this.quiet = this.emptyKey;
    } finally {
      this.readingMore = false;
    }
  }

  // A post changed somewhere else (its thread): its card is drawn again in its place.
  update(post: Post) {
    const entry = this.entries.find((held) => held.item.kind === 'post' && held.item.post.postId === post.postId);
    if (entry) entry.item = { kind: 'post', createdAt: entry.item.createdAt, post };
  }

  // A post just written, at the top of the list.
  prepend(post: Post) {
    const item: FeedItem = { kind: 'post', createdAt: post.createdAt, post };
    this.entries = [new FeedEntry(keyOf(item), item), ...this.entries];
    this.quiet = null;
  }

  // A post deleted here leaves the list.
  remove(entry: FeedEntry) {
    this.entries = this.entries.filter((held) => held !== entry);
    if (this.entries.length === 0 && this.next === null) this.quiet = this.emptyKey;
  }

  // 1 up, -1 down, 0 to take the vote back. A failure leaves the counts as they were, as on the phones.
  async vote(key: string, value: number) {
    const entry = this.entries.find((held) => held.key === key);
    if (!entry) return;
    const sent = (this.votesSent.get(key) ?? 0) + 1;
    this.votesSent.set(key, sent);

    let changed: FeedItem | null = null;
    try {
      const item = entry.item;
      if (item.kind === 'post') {
        const answer = await this.votes.votePost(item.post.ownerId, item.post.postId, value);
        if (answer) changed = { ...item, post: answer };
      } else {
        const answer = await this.votes.voteReview(item.review.albumId, item.review.userId, value);
        if (answer) changed = { ...item, review: { ...item.review, ...answer } };
      }
    } catch {
      return;
    }

    if (!changed || this.votesSent.get(key) !== sent) return;
    const now = this.entries.find((held) => held.key === key);
    if (now) now.item = changed;
  }
}
