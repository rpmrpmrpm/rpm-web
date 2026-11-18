// The community: everyone's feed, a person's page, posts and replies, friends, blocks and notifications. The
// same routes and shapes as the desktop's RpmCommunityClient and the phones' clients.
//
// Not found is an answer here, not a failure: no profile, no post, a feed the server does not have. Those come
// back as null. Every other failure throws, so a caller never takes "could not be read" for "there is nothing".

import { ApiError, type Api, type CallOptions } from './http';

// The longest post or reply the server takes, in characters.
export const LONGEST_POST = 2000;

// The largest pages the server gives.
export const LONGEST_FEED_PAGE = 30;
export const LONGEST_PERSON_FEED_PAGE = 20;

// A song attached to a post, or what a person plays now.
export interface Song {
  artist: string;
  title: string;
  album: string;
  albumId?: string | null;
}

// A post on a person's page. The author is always the page's owner.
export interface Post {
  ownerId: string;
  postId: string;
  authorName: string;
  hasAvatar: boolean;
  body: string;
  song: Song | null;
  createdAt: number;
  ups: number;
  downs: number;
  score: number;
  // 1, -1 or 0: how the signed-in reader voted.
  myVote: number;
  replyCount: number;
  // The account was deleted: the name is empty and "Deleted user" is drawn instead.
  authorDeleted: boolean;
  authorSupporter: boolean;
}

// A review as a feed carries it: the review's own fields and the album's, in one object.
export interface FeedReview {
  albumId: string;
  userId: string;
  authorName: string;
  hasAvatar: boolean;
  // Halves of a star, doubled: 1 to 10. Zero when the review has no rating.
  rating: number;
  body: string;
  createdAt: number;
  updatedAt: number;
  ups: number;
  downs: number;
  score: number;
  myVote: number;
  authorDeleted: boolean;
  albumArtist: string;
  albumTitle: string;
  albumYear: number;
  authorSupporter: boolean;
}

// The counts and the reader's vote, as a vote on a review answers them.
export interface VoteCounts {
  ups: number;
  downs: number;
  score: number;
  myVote: number;
}

// One entry of a feed: a post or a review. Only entries of a kind this build knows are kept (see readFeedPage).
export type FeedItem = { kind: 'post'; createdAt: number; post: Post } | { kind: 'review'; createdAt: number; review: FeedReview };

// A page of a feed, newest first. next is the "before" of the next page, null at the end. A page can be empty
// while next is set, when every entry on it was by a person the reader blocked.
export interface FeedPage {
  items: FeedItem[];
  next: number | null;
}

export interface Listening extends Song {
  // When it was sent, in Unix milliseconds.
  at: number;
}

export interface CollectionCounts {
  albums: number;
  tracks: number;
}

export type Friendship = 'self' | 'none' | 'requested' | 'incoming' | 'friends';

// A person's page, from profiles/{userId} (or profile for the reader's own).
export interface Person {
  userId: string;
  displayName: string;
  hasAvatar: boolean;
  avatarUpdatedAt: number;
  createdAt: number;
  supporter: boolean;
  hasBanner: boolean;
  bannerUpdatedAt: number;
  // Null when nothing plays, when it is old, or when the person turned sharing off.
  listening: Listening | null;
  counts: CollectionCounts | null;
  friendship: Friendship;
  blocked: boolean;
  // The banner shows the photo of the artist the person is playing, not an uploaded picture.
  bannerFollowsListening: boolean;
  badges: string[];
  // The badge shown under the name, by id, or empty.
  badge: string;
  // The badge's colour as #RRGGBB, or empty for the default.
  badgeColour: string;
  sharesListening: boolean;
  // What the page is drawn on, as the server stores it. See readGround.
  pageGround: string;
}

// A reply under a post or under another reply.
export interface Reply {
  postId: string;
  replyId: string;
  // The post id for a reply to the post itself, or the id of the reply it answers.
  parentId: string;
  userId: string;
  authorName: string;
  hasAvatar: boolean;
  body: string;
  createdAt: number;
  ups: number;
  downs: number;
  score: number;
  myVote: number;
  authorDeleted: boolean;
  // Deleted, but it has replies under it, so it keeps its place in the thread with no text.
  deleted: boolean;
  authorSupporter: boolean;
}

export const NOTICE_KINDS = ['reply', 'vote', 'friendRequest', 'friendAccepted', 'friendReview', 'badge'] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

export interface Notice {
  id: string;
  kind: NoticeKind;
  fromUserId: string;
  fromName: string;
  fromHasAvatar: boolean;
  ownerId: string | null;
  postId: string | null;
  albumTitle: string | null;
  // How many votes a vote entry stands for; 1 otherwise.
  count: number;
  createdAt: number;
  read: boolean;
  badgeId: string | null;
}

export interface NoticePage {
  // Only the kinds this build knows.
  items: Notice[];
  // The id of the newest entry on the page, of any kind: what "mark read" names.
  newest: string | null;
  unread: number;
  next: string | null;
}

type Row = Record<string, unknown>;

const row = (raw: unknown): Row => (typeof raw === 'object' && raw !== null ? (raw as Row) : {});
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const yes = (value: unknown): boolean => value === true;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function readSong(raw: unknown): Song | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const song = row(raw);
  return { artist: str(song.artist), title: str(song.title), album: str(song.album), albumId: typeof song.albumId === 'string' ? song.albumId : null };
}

const readVotes = (r: Row) => ({ ups: num(r.ups), downs: num(r.downs), score: num(r.score), myVote: num(r.myVote) });

export function readPost(raw: unknown): Post {
  const r = row(raw);
  if (!str(r.postId)) throw new ApiError(200, 'A post has no id.');
  return {
    ownerId: str(r.ownerId),
    postId: str(r.postId),
    authorName: str(r.authorName),
    hasAvatar: yes(r.hasAvatar),
    body: str(r.body),
    song: readSong(r.song),
    createdAt: num(r.createdAt),
    ...readVotes(r),
    replyCount: num(r.replyCount),
    authorDeleted: yes(r.authorDeleted),
    authorSupporter: yes(r.authorSupporter),
  };
}

function readFeedReview(raw: unknown): FeedReview {
  const r = row(raw);
  return {
    albumId: str(r.albumId),
    userId: str(r.userId),
    authorName: str(r.authorName),
    hasAvatar: yes(r.hasAvatar),
    rating: num(r.rating),
    body: str(r.body),
    createdAt: num(r.createdAt),
    updatedAt: num(r.updatedAt),
    ...readVotes(r),
    authorDeleted: yes(r.authorDeleted),
    albumArtist: str(r.albumArtist),
    albumTitle: str(r.albumTitle),
    albumYear: num(r.albumYear),
    authorSupporter: yes(r.authorSupporter),
  };
}

// The entries this build can draw, in order: a post with its post and a review with its review. An entry of a
// kind a newer server sends is left out rather than drawn wrongly.
export function readFeedPage(raw: unknown): FeedPage {
  const page = row(raw);
  const items: FeedItem[] = [];
  for (const entry of list(page.items)) {
    const r = row(entry);
    const kind = str(r.kind).toLowerCase();
    if (kind === 'post' && typeof r.post === 'object' && r.post !== null) items.push({ kind: 'post', createdAt: num(r.createdAt), post: readPost(r.post) });
    else if (kind === 'review' && typeof r.review === 'object' && r.review !== null) items.push({ kind: 'review', createdAt: num(r.createdAt), review: readFeedReview(r.review) });
  }
  return { items, next: typeof page.next === 'number' ? page.next : null };
}

const FRIENDSHIPS: readonly Friendship[] = ['self', 'none', 'requested', 'incoming', 'friends'];

export function readPerson(raw: unknown): Person {
  const r = row(raw);
  if (!str(r.userId)) throw new ApiError(200, 'A profile has no id.');
  const listening = readSong(r.listening);
  const counts = typeof r.counts === 'object' && r.counts !== null ? row(r.counts) : null;
  const friendship = FRIENDSHIPS.find((known) => known === r.friendship) ?? 'none';
  return {
    userId: str(r.userId),
    displayName: str(r.displayName),
    hasAvatar: yes(r.hasAvatar),
    avatarUpdatedAt: num(r.avatarUpdatedAt),
    createdAt: num(r.createdAt),
    supporter: yes(r.supporter),
    hasBanner: yes(r.hasBanner),
    bannerUpdatedAt: num(r.bannerUpdatedAt),
    listening: listening ? { ...listening, at: num(row(r.listening).at) } : null,
    counts: counts ? { albums: num(counts.albums), tracks: num(counts.tracks) } : null,
    friendship,
    blocked: yes(r.blocked),
    bannerFollowsListening: str(r.bannerSource).toLowerCase() === 'listening',
    badges: list(r.badges).filter((id): id is string => typeof id === 'string'),
    badge: str(r.badge),
    badgeColour: str(r.badgeColour),
    // Missing means on: a server older than the switch shares, as the phones read it.
    sharesListening: r.sharesListening !== false,
    pageGround: str(r.pageGround),
  };
}

export function readReply(raw: unknown): Reply {
  const r = row(raw);
  if (!str(r.replyId)) throw new ApiError(200, 'A reply has no id.');
  return {
    postId: str(r.postId),
    replyId: str(r.replyId),
    parentId: str(r.parentId),
    userId: str(r.userId),
    authorName: str(r.authorName),
    hasAvatar: yes(r.hasAvatar),
    body: str(r.body),
    createdAt: num(r.createdAt),
    ...readVotes(r),
    authorDeleted: yes(r.authorDeleted),
    deleted: yes(r.deleted),
    authorSupporter: yes(r.authorSupporter),
  };
}

export function readNoticePage(raw: unknown): NoticePage {
  const page = row(raw);
  const rows = list(page.items).map(row);
  const items: Notice[] = [];
  for (const r of rows) {
    const kind = NOTICE_KINDS.find((known) => known === r.kind);
    if (!kind || !str(r.id)) continue;
    items.push({
      id: str(r.id),
      kind,
      fromUserId: str(r.fromUserId),
      fromName: str(r.fromName),
      fromHasAvatar: yes(r.fromHasAvatar),
      ownerId: str(r.ownerId) || null,
      postId: str(r.postId) || null,
      albumTitle: str(r.albumTitle) || null,
      count: typeof r.count === 'number' ? r.count : 1,
      createdAt: num(r.createdAt),
      read: yes(r.read),
      badgeId: str(r.badgeId) || null,
    });
  }
  return { items, newest: str(rows[0]?.id) || null, unread: num(page.unread), next: str(page.next) || null };
}

// The replies of one post as a tree: every reply in reading order, each followed by the replies under it, with its
// depth (0 for a reply to the post). A reply whose parent is not in the list is shown at the top level, so no
// reply is lost. The same rules as the desktop's RpmReplyTree and the phones' ReplyTree.
export function replyTree(postId: string, replies: readonly Reply[]): { reply: Reply; depth: number }[] {
  const known = new Set(replies.map((reply) => reply.replyId));
  const children = new Map<string, Reply[]>();
  for (const reply of replies) {
    const parent = known.has(reply.parentId) ? reply.parentId : postId;
    const held = children.get(parent);
    if (held) held.push(reply);
    else children.set(parent, [reply]);
  }

  const lines: { reply: Reply; depth: number }[] = [];
  const seen = new Set<string>();
  // An explicit stack, not recursion: a thread can be deep.
  const stack = [...(children.get(postId) ?? [])].reverse().map((reply) => ({ reply, depth: 0 }));
  while (stack.length) {
    const line = stack.pop()!;
    if (seen.has(line.reply.replyId)) continue;
    seen.add(line.reply.replyId);
    lines.push(line);
    for (const child of [...(children.get(line.reply.replyId) ?? [])].reverse()) stack.push({ reply: child, depth: line.depth + 1 });
  }
  return lines;
}

// The server refused the write: a picture too large, a post too long, a person who blocked the reader.
export const refused = (error: unknown): boolean => error instanceof ApiError && (error.status === 400 || error.status === 403 || error.status === 413);

const at = (id: string) => encodeURIComponent(id);
const postPath = (ownerId: string, postId: string) => `profiles/${at(ownerId)}/posts/${at(postId)}`;

export class Community {
  constructor(private readonly api: Pick<Api, 'call' | 'json'>) {}

  // An answer, or null where the server says there is nothing there.
  private async maybe<T>(path: string, read: (raw: unknown) => T, options?: CallOptions): Promise<T | null> {
    try {
      return await this.api.json(path, read, options);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }

  private async send(path: string, options: CallOptions): Promise<void> {
    await this.api.call(path, options);
  }

  // Everyone's posts and album reviews, newest first. A signed-in reader gets their own votes filled in, and
  // people they blocked left out. Null when the server has no feed.
  feed(before: number | null, limit: number): Promise<FeedPage | null> {
    const size = Math.min(Math.max(limit, 1), LONGEST_FEED_PAGE);
    return this.maybe(`feed?limit=${size}${before === null ? '' : `&before=${before}`}`, readFeedPage);
  }

  // A person's own posts and album reviews, newest first.
  personFeed(userId: string, before: number | null, limit: number): Promise<FeedPage | null> {
    const size = Math.min(Math.max(limit, 1), LONGEST_PERSON_FEED_PAGE);
    return this.maybe(`profiles/${at(userId)}/feed?limit=${size}${before === null ? '' : `&before=${before}`}`, readFeedPage);
  }

  // A person's page. Null when the person has no profile.
  person(userId: string): Promise<Person | null> {
    return userId ? this.maybe(`profiles/${at(userId)}`, readPerson) : Promise.resolve(null);
  }

  // The reader's own page, with what only its owner sees (sharesListening).
  ownPerson(): Promise<Person | null> {
    return this.maybe('profile', readPerson);
  }

  createPost(body: string, song: Song | null): Promise<Post> {
    return this.api.json('profile/posts', readPost, { method: 'POST', body: { body, song } });
  }

  deletePost(postId: string): Promise<void> {
    return this.send(`profile/posts/${at(postId)}`, { method: 'DELETE' });
  }

  // 1 up, -1 down, 0 to withdraw. Not on the reader's own post.
  votePost(ownerId: string, postId: string, value: number): Promise<Post | null> {
    return this.maybe(`${postPath(ownerId, postId)}/vote`, readPost, { method: 'POST', body: { value } });
  }

  voteReview(albumId: string, authorId: string, value: number): Promise<VoteCounts | null> {
    return this.maybe(`albums/${at(albumId)}/reviews/${at(authorId)}/vote`, (raw) => readVotes(row(raw)), { method: 'POST', body: { value } });
  }

  // Every reply under a post, oldest first. See replyTree.
  async replies(ownerId: string, postId: string): Promise<Reply[]> {
    return (await this.maybe(`${postPath(ownerId, postId)}/replies`, (raw) => list(row(raw).items).map(readReply))) ?? [];
  }

  // parentId is the reply this answers, or null for a reply to the post itself.
  reply(ownerId: string, postId: string, parentId: string | null, body: string): Promise<Reply> {
    return this.api.json(`${postPath(ownerId, postId)}/replies`, readReply, { method: 'POST', body: { body, parentId } });
  }

  deleteReply(ownerId: string, postId: string, replyId: string): Promise<void> {
    return this.send(`${postPath(ownerId, postId)}/replies/${at(replyId)}`, { method: 'DELETE' });
  }

  voteReply(ownerId: string, postId: string, replyId: string, value: number): Promise<Reply | null> {
    return this.maybe(`${postPath(ownerId, postId)}/replies/${at(replyId)}/vote`, readReply, { method: 'POST', body: { value } });
  }

  // Reports a post (replyId null) or a reply on someone's page.
  reportPost(ownerId: string, postId: string, replyId: string | null, note: string | null): Promise<void> {
    return this.send('reports', {
      method: 'POST',
      body: { targetType: replyId === null ? 'post' : 'reply', ownerId, postId, targetId: replyId ?? postId, reason: null, note },
    });
  }

  // Asks to be friends. If that person already asked the reader, this accepts instead.
  requestFriend(userId: string): Promise<void> {
    return this.send(`friends/${at(userId)}`, { method: 'POST' });
  }

  acceptFriend(userId: string): Promise<void> {
    return this.send(`friends/${at(userId)}/accept`, { method: 'POST' });
  }

  // Cancels the reader's request, declines theirs, or ends a friendship.
  removeFriend(userId: string): Promise<void> {
    return this.send(`friends/${at(userId)}`, { method: 'DELETE' });
  }

  // Blocks a person. It also ends a friendship or a request between the two.
  block(userId: string): Promise<void> {
    return this.send(`blocks/${at(userId)}`, { method: 'POST' });
  }

  unblock(userId: string): Promise<void> {
    return this.send(`blocks/${at(userId)}`, { method: 'DELETE' });
  }

  // A page of the reader's notifications, newest first.
  notices(before: string | null): Promise<NoticePage> {
    return this.api.json(`notifications${before === null ? '' : `?before=${at(before)}`}`, readNoticePage);
  }

  async unread(): Promise<number> {
    return num(row(await this.api.json('notifications/unread', (raw) => raw)).unread);
  }

  // Marks this notification and every older one as read.
  markRead(upTo: string): Promise<void> {
    return this.send('notifications/read', { method: 'POST', body: { upTo } });
  }

  // JPEG, PNG or WebP, at most 2 MB.
  async setBanner(bytes: Uint8Array): Promise<void> {
    await this.api.call('profile/banner', { method: 'POST', raw: { bytes, type: 'image/jpeg' } });
  }

  clearBanner(): Promise<void> {
    return this.send('profile/banner', { method: 'DELETE' });
  }

  // Where the banner comes from: the playing artist's photo, or the uploaded picture.
  setBannerSource(listening: boolean): Promise<void> {
    return this.send('profile/banner-source', { method: 'PUT', body: { source: listening ? 'listening' : 'photo' } });
  }

  // The badges this device worked out and the one shown. The server adds the unlocked ones to what it holds, never
  // removes one, and notifies the reader of each one it did not hold yet.
  setBadges(unlocked: readonly string[], badge: string, badgeColour: string): Promise<void> {
    return this.send('profile/badges', { method: 'PUT', body: { unlocked, badge, badgeColour } });
  }

  setPageGround(wire: string): Promise<void> {
    return this.send('profile/ground', { method: 'PUT', body: { ground: wire } });
  }

  // What the reader plays now. The server ignores it while sharing is off.
  setListening(song: Song): Promise<void> {
    return this.send('profile/listening', { method: 'PUT', body: song });
  }

  clearListening(): Promise<void> {
    return this.send('profile/listening', { method: 'DELETE' });
  }
}
