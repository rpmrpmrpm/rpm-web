import { describe, expect, it, vi } from 'vitest';

import type { FeedItem, FeedPage, Post } from '../../src/api/community';
import { FeedList } from '../../src/views/feed/feed-list.svelte';

const post = (postId: string, over: Partial<Post> = {}): Post => ({
  ownerId: 'o',
  postId,
  authorName: 'O',
  hasAvatar: false,
  body: postId,
  song: null,
  createdAt: 0,
  ups: 0,
  downs: 0,
  score: 0,
  myVote: 0,
  replyCount: 0,
  authorDeleted: false,
  authorSupporter: false,
  ...over,
});

const item = (postId: string): FeedItem => ({ kind: 'post', createdAt: 0, post: post(postId) });
const page = (ids: string[], next: number | null = null): FeedPage => ({ items: ids.map(item), next });

function later<T>() {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((done) => (settle = done));
  return { promise, settle };
}

const noVotes = { votePost: vi.fn(), voteReview: vi.fn() };

describe('a feed list', () => {
  it('drops the answer to a read that a newer read overtook', async () => {
    const first = later<FeedPage | null>();
    const second = later<FeedPage | null>();
    const read = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const list = new FeedList(read, true, 'Rpm_Feed_Empty', false, noVotes);
    const one = list.readFirst();
    const two = list.readFirst();
    second.settle(page(['new']));
    await two;
    first.settle(page(['old']));
    await one;
    expect(list.entries.map((entry) => entry.key)).toEqual(['post:new']);
  });

  it('follows empty pages to the first one with something on it', async () => {
    const read = vi.fn().mockResolvedValueOnce(page([], 3)).mockResolvedValueOnce(page([], 2)).mockResolvedValueOnce(page(['a'], 1));
    const list = new FeedList(read, true, 'Rpm_Feed_Empty', false, noVotes);
    await list.readFirst();
    expect(list.entries.map((entry) => entry.key)).toEqual(['post:a']);
    expect(read.mock.calls.map(([before]) => before)).toEqual([null, 3, 2]);
    expect(list.quiet).toBeNull();
  });

  it('says it is empty only at the end, and that it could not be read when nothing came', async () => {
    const empty = new FeedList(async () => page([]), true, 'Rpm_Feed_Empty', false, noVotes);
    await empty.readFirst();
    expect(empty.quiet).toBe('Rpm_Feed_Empty');

    const offline = new FeedList(async () => Promise.reject(new Error('offline')), true, 'Rpm_Feed_Empty', false, noVotes);
    await offline.readFirst();
    expect(offline.quiet).toBe('Rpm_Profile_Offline');
    expect(offline.readAt).toBe(0);
  });

  it('adds a further page without the entries it already holds', async () => {
    const read = vi.fn().mockResolvedValueOnce(page(['a', 'b'], 5)).mockResolvedValueOnce(page(['b', 'c']));
    const list = new FeedList(read, true, 'Rpm_Feed_Empty', false, noVotes);
    await list.readFirst();
    await list.more();
    expect(list.entries.map((entry) => entry.key)).toEqual(['post:a', 'post:b', 'post:c']);
    expect(list.hasMore).toBe(false);
  });

  it('applies only the answer to the latest vote on an entry', async () => {
    const first = later<Post | null>();
    const second = later<Post | null>();
    const votes = { votePost: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise), voteReview: vi.fn() };
    const list = new FeedList(async () => page(['a']), true, 'Rpm_Feed_Empty', false, votes);
    await list.readFirst();
    const up = list.vote('post:a', 1);
    const back = list.vote('post:a', 0);
    second.settle(post('a', { ups: 0, myVote: 0 }));
    await back;
    first.settle(post('a', { ups: 1, myVote: 1 }));
    await up;
    const shown = list.entries[0]!.item;
    expect(shown.kind === 'post' && shown.post.myVote).toBe(0);
  });

  it('puts a new post at the top, and says it is empty when the last one is deleted', async () => {
    const list = new FeedList(async () => page([]), false, 'Rpm_Profile_FeedEmptyOwn', true, noVotes);
    await list.readFirst();
    list.prepend(post('mine'));
    expect(list.quiet).toBeNull();
    list.remove(list.entries[0]!);
    expect(list.quiet).toBe('Rpm_Profile_FeedEmptyOwn');
  });
});
