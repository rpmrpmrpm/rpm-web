import { describe, expect, it, vi } from 'vitest';

import { Community, readFeedPage, readNoticePage, readPerson, replyTree, type Reply } from '../../src/api/community';
import { Api, ApiError, type TokenSource } from '../../src/api/http';

const tokens: TokenSource = { accessToken: async () => 'token' };
const answer = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const noWait = async () => {};

function client(...answers: Response[]) {
  const fetcher = vi.fn();
  for (const one of answers) fetcher.mockResolvedValueOnce(one);
  const community = new Community(new Api('/api/', tokens, fetcher as typeof fetch, noWait));
  const sent = (index = 0) => {
    const [url, init] = fetcher.mock.calls[index] as [string, RequestInit];
    return { url, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined };
  };
  return { community, fetcher, sent };
}

const reply = (replyId: string, parentId: string): Reply => ({
  postId: 'p',
  replyId,
  parentId,
  userId: 'u',
  authorName: 'U',
  hasAvatar: false,
  body: replyId,
  createdAt: 0,
  ups: 0,
  downs: 0,
  score: 0,
  myVote: 0,
  authorDeleted: false,
  deleted: false,
  authorSupporter: false,
});

describe('a feed page', () => {
  it('keeps the posts and reviews it can draw, in order, and leaves out a kind it does not know', () => {
    const page = readFeedPage({
      items: [
        { kind: 'post', createdAt: 3, post: { postId: 'a', ownerId: 'o', body: 'Hello', ups: 2, replyCount: 1, song: { artist: 'X', title: 'Y', album: 'Z' } } },
        { kind: 'poll', createdAt: 2, poll: {} },
        { kind: 'review', createdAt: 1, review: { albumId: 'al', userId: 'u', rating: 7, albumTitle: 'T', albumArtist: 'A', albumYear: 1999 } },
        { kind: 'post', createdAt: 0 },
      ],
      next: 42,
    });
    expect(page.items.map((item) => item.kind)).toEqual(['post', 'review']);
    expect(page.next).toBe(42);
    const [post, review] = page.items;
    expect(post?.kind === 'post' && post.post.song?.title).toBe('Y');
    expect(post?.kind === 'post' && post.post.myVote).toBe(0);
    expect(review?.kind === 'review' && review.review.albumYear).toBe(1999);
  });

  it('ends when next is missing', () => {
    expect(readFeedPage({ items: [] }).next).toBeNull();
  });
});

describe('a person', () => {
  it('reads what a server leaves out as nothing, and sharing as on', () => {
    const person = readPerson({ userId: 'u', displayName: 'Ann' });
    expect(person).toMatchObject({ supporter: false, hasBanner: false, listening: null, counts: null, friendship: 'none', blocked: false, badges: [], sharesListening: true, pageGround: '' });
  });

  it('reads the banner source, the friendship and what plays', () => {
    const person = readPerson({ userId: 'u', bannerSource: 'Listening', friendship: 'incoming', listening: { artist: 'A', title: 'T', album: 'L', at: 5 }, counts: { albums: 2, tracks: 9 } });
    expect(person.bannerFollowsListening).toBe(true);
    expect(person.friendship).toBe('incoming');
    expect(person.listening).toMatchObject({ artist: 'A', title: 'T', at: 5 });
    expect(person.counts).toEqual({ albums: 2, tracks: 9 });
  });

  it('is not found, not an error, when there is no profile', async () => {
    const { community } = client(answer(404));
    expect(await community.person('nobody')).toBeNull();
  });

  it('is an error when the server fails', async () => {
    const { community } = client(answer(500), answer(500), answer(500));
    await expect(community.person('u')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('a thread', () => {
  it('lays replies out under their parents, in reading order', () => {
    const lines = replyTree('p', [reply('a', 'p'), reply('b', 'p'), reply('a1', 'a'), reply('a1x', 'a1')]);
    expect(lines.map((line) => `${line.reply.replyId}:${line.depth}`)).toEqual(['a:0', 'a1:1', 'a1x:2', 'b:0']);
  });

  it('shows a reply whose parent is missing at the top level, so none is lost', () => {
    const lines = replyTree('p', [reply('a', 'gone')]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.depth).toBe(0);
  });
});

describe('notifications', () => {
  it('keeps the kinds it knows, and names the newest of any kind for marking read', () => {
    const page = readNoticePage({
      items: [
        { id: 'n3', kind: 'somethingNew', fromUserId: 'x' },
        { id: 'n2', kind: 'vote', fromUserId: 'x', count: 4 },
        { id: 'n1', kind: 'friendRequest', fromUserId: 'y' },
      ],
      unread: 2,
      next: 'n1',
    });
    expect(page.items.map((notice) => notice.id)).toEqual(['n2', 'n1']);
    expect(page.newest).toBe('n3');
    expect(page.items[0]?.count).toBe(4);
    expect(page.items[1]?.count).toBe(1);
    expect(page.unread).toBe(2);
    expect(page.next).toBe('n1');
  });
});

describe('the calls', () => {
  it('asks for at most the largest feed page, before the last one', async () => {
    const { community, sent } = client(answer(200, { items: [] }));
    await community.feed(1234, 500);
    expect(sent().url).toBe('/api/feed?limit=30&before=1234');
  });

  it('sends a post with its song, and a reply with its parent', async () => {
    const song = { artist: 'A', title: 'T', album: 'L' };
    const { community, sent } = client(answer(200, { postId: 'p', ownerId: 'me' }), answer(200, { replyId: 'r', postId: 'p' }));
    await community.createPost('Hi', song);
    await community.reply('owner', 'p', 'r0', 'Yes');
    expect(sent(0)).toMatchObject({ url: '/api/profile/posts', method: 'POST', body: { body: 'Hi', song } });
    expect(sent(1)).toMatchObject({ url: '/api/profiles/owner/posts/p/replies', method: 'POST', body: { body: 'Yes', parentId: 'r0' } });
  });

  it('reports a post by its id, and a reply by its own', async () => {
    const { community, sent } = client(answer(200), answer(200));
    await community.reportPost('o', 'p', null, null);
    await community.reportPost('o', 'p', 'r', 'spam');
    expect(sent(0).body).toEqual({ targetType: 'post', ownerId: 'o', postId: 'p', targetId: 'p', reason: null, note: null });
    expect(sent(1).body).toEqual({ targetType: 'reply', ownerId: 'o', postId: 'p', targetId: 'r', reason: null, note: 'spam' });
  });

  it('reads the counts a vote on a review answers', async () => {
    const { community, sent } = client(answer(200, { ups: 3, downs: 1, score: 2, myVote: 1, body: 'x' }));
    expect(await community.voteReview('al', 'au', 1)).toEqual({ ups: 3, downs: 1, score: 2, myVote: 1 });
    expect(sent()).toMatchObject({ url: '/api/albums/al/reviews/au/vote', method: 'POST', body: { value: 1 } });
  });

  it('sends the badges with the one shown, and the ground as stored', async () => {
    const { community, sent } = client(answer(200), answer(200));
    await community.setBadges(['first-spin', 'rock'], 'rock', '#2563EB');
    await community.setPageGround('backdrop:vinyl');
    expect(sent(0)).toMatchObject({ url: '/api/profile/badges', method: 'PUT', body: { unlocked: ['first-spin', 'rock'], badge: 'rock', badgeColour: '#2563EB' } });
    expect(sent(1)).toMatchObject({ url: '/api/profile/ground', method: 'PUT', body: { ground: 'backdrop:vinyl' } });
  });
});
