import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Person, Reply, Song } from '../../src/api/community';
import type { CloudTrack } from '../../src/api/wire';
import type { CloudAlbum } from '../../src/library/albums';
import { BadgeReporter } from '../../src/social/badge-report';
import { badgeColour, unlockedBadges } from '../../src/social/badges';
import { Faces } from '../../src/social/faces';
import { FeedCovers, ownCopy } from '../../src/social/feed-covers';
import { groundWire, readGround } from '../../src/social/ground';
import { ListeningShare } from '../../src/social/listening';
import { drawnSize } from '../../src/social/pictures';
import { threadLines } from '../../src/social/thread';

afterEach(() => vi.useRealTimers());

const person = (over: Partial<Person> = {}): Person => ({
  userId: 'me',
  displayName: 'Me',
  hasAvatar: false,
  avatarUpdatedAt: 0,
  createdAt: 0,
  supporter: false,
  hasBanner: false,
  bannerUpdatedAt: 0,
  listening: null,
  counts: null,
  friendship: 'self',
  blocked: false,
  bannerFollowsListening: false,
  badges: [],
  badge: '',
  badgeColour: '',
  sharesListening: true,
  pageGround: '',
  ...over,
});

const album = (key: string, title: string, artist: string, genre = 'Rock', tracks = 1): CloudAlbum => ({
  key,
  album: title,
  artist,
  addedAt: 0,
  year: 0,
  tracks: Array.from({ length: tracks }, (_, index) => ({ rpmId: `${key}${index}`, title: 't', artist, album: title, tags: { genre } }) as unknown as CloudTrack),
});

describe('a page ground', () => {
  it('reads a colour and a background, and anything else as the standard ground', () => {
    expect(readGround('color:#0A0a0A')).toEqual({ kind: 'colour', rgb: 0x0a0a0a });
    expect(readGround('backdrop:vinyl')).toEqual({ kind: 'backdrop', id: 'vinyl' });
    expect(readGround('color:#12')).toEqual({ kind: 'standard' });
    expect(readGround('')).toEqual({ kind: 'standard' });
  });

  it('writes what it read', () => {
    for (const wire of ['color:#2A0A5E', 'backdrop:sheet-music', '']) expect(groundWire(readGround(wire))).toBe(wire);
  });
});

describe('badges', () => {
  it('unlocks the size badges by albums and the ten-thousand by tracks', () => {
    expect(unlockedBadges(0, 0, new Map())).toEqual([]);
    expect(unlockedBadges(250, 10_000, new Map())).toEqual(['first-spin', 'crate-digger', 'record-collector', 'ten-thousand']);
  });

  it('unlocks a genre with 25 albums that are a fifth of the collection, counting its shelves together', () => {
    expect(unlockedBadges(100, 0, new Map([['Rock', 20], ['Punk', 5]]))).toContain('rock');
    expect(unlockedBadges(200, 0, new Map([['Rock', 30]]))).not.toContain('rock');
    expect(unlockedBadges(100, 0, new Map([['Hip-Hop / Rap', 25]]))).toContain('hiphop');
  });

  it('counts ten genres with five albums each for the genre hopper, and not the music it cannot file', () => {
    const nine = new Map([...'ABCDEFGHI'].map((name) => [name, 5]));
    expect(unlockedBadges(100, 0, new Map([...nine, ['Other', 50]]))).not.toContain('genre-hopper');
    expect(unlockedBadges(100, 0, new Map([...nine, ['J', 5]]))).toContain('genre-hopper');
  });

  it('draws the default colour when none is stored', () => {
    expect(badgeColour('')).toEqual([0x7a, 0x1f, 0xd1]);
    expect(badgeColour('#2563EB')).toEqual([0x25, 0x63, 0xeb]);
  });

  it('sends the badges the server does not hold, once', async () => {
    const setBadges = vi.fn(async () => {});
    const ownPerson = vi.fn(async () => person({ badges: [], badge: 'x', badgeColour: '#2563EB' }));
    const reporter = new BadgeReporter({ ownPerson, setBadges }, () => true);
    const sent = vi.fn();
    reporter.onSent = sent;
    const albums = [album('a', 'A', 'X')];
    reporter.note(albums);
    await vi.waitFor(() => expect(sent).toHaveBeenCalled());
    expect(setBadges).toHaveBeenCalledWith(['first-spin'], 'x', '#2563EB');
    reporter.note(albums);
    reporter.note([...albums]);
    await Promise.resolve();
    expect(setBadges).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when the server holds them all', async () => {
    const setBadges = vi.fn(async () => {});
    const reporter = new BadgeReporter({ ownPerson: async () => person({ badges: ['first-spin'] }), setBadges }, () => true);
    reporter.note([album('a', 'A', 'X')]);
    await new Promise((done) => setTimeout(done, 0));
    expect(setBadges).not.toHaveBeenCalled();
  });
});

const line = (replyId: string, parentId: string): Reply => ({ replyId, parentId, postId: 'p' }) as Reply;

describe('a thread laid out', () => {
  // A chain seven deep under the post: the seventh reply waits behind its parent on the sixth level.
  const chain = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6'].map((id, index) => line(id, index === 0 ? 'p' : `r${index - 1}`));

  it('shows six levels and counts what waits under the sixth', () => {
    const lines = threadLines('p', chain, new Set());
    expect(lines.map((shown) => shown.reply.replyId)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5']);
    expect(lines.at(-1)?.hidden).toBe(1);
  });

  it('shows the branch once it is opened', () => {
    const lines = threadLines('p', chain, new Set(['r5']));
    expect(lines.map((shown) => shown.reply.replyId)).toContain('r6');
    expect(lines.every((shown) => shown.hidden === 0)).toBe(true);
  });
});

describe('a picture for the profile', () => {
  it('is cut to the shape asked for, and smaller as a whole when the picture is smaller', () => {
    expect(drawnSize(4000, 3000, 1500, 500)).toEqual({ wide: 1500, high: 500 });
    expect(drawnSize(300, 300, 512, 512)).toEqual({ wide: 300, high: 300 });
    expect(drawnSize(1000, 200, 1500, 500)).toEqual({ wide: 600, high: 200 });
  });
});

describe('review covers', () => {
  const store = () => {
    const held = new Map<string, string>();
    return { getItem: (key: string) => held.get(key) ?? null, setItem: (key: string, value: string) => void held.set(key, value) };
  };

  it('finds the reader own copy by title and artist, whatever the case', () => {
    const albums = [album('1', 'Blue', 'Joni Mitchell'), album('2', 'Blue', 'Weezer')];
    expect(ownCopy(albums, 'blue', 'WEEZER')?.key).toBe('2');
    expect(ownCopy(albums, 'Blue', '')?.key).toBe('1');
    expect(ownCopy(albums, 'Red', 'Weezer')).toBeNull();
  });

  it('searches a record once, and keeps a cover for a month and none for a week', async () => {
    let now = 0;
    const json = vi.fn(async (path: string) => ({ results: path.includes('Found') ? [{ thumbUrl: 'https://x/thumb', fullUrl: 'https://x/full' }] : [] }));
    const covers = new FeedCovers({ json } as never, store, () => now);
    expect(await covers.found('A', 'Found')).toBe('https://x/thumb');
    expect(await covers.found('A', 'None')).toBeNull();
    now += 8 * 24 * 60 * 60_000;
    expect(await covers.found('a', 'found')).toBe('https://x/thumb');
    expect(json).toHaveBeenCalledTimes(2);
    expect(await covers.found('A', 'None')).toBeNull();
    expect(json).toHaveBeenCalledTimes(3);
  });

  it('keeps no answer from a failed search, and rests for a minute after it', async () => {
    let now = 0;
    const json = vi.fn().mockRejectedValueOnce(new Error('429')).mockResolvedValue({ results: [{ thumbUrl: 'https://x/t' }] });
    const covers = new FeedCovers({ json } as never, store, () => now);
    expect(await covers.found('A', 'B')).toBeNull();
    expect(await covers.found('A', 'B')).toBeNull();
    expect(json).toHaveBeenCalledTimes(1);
    now += 61_000;
    expect(await covers.found('A', 'B')).toBe('https://x/t');
  });

  it('runs one search at a time', async () => {
    let running = 0;
    let most = 0;
    const json = vi.fn(async () => {
      most = Math.max(most, ++running);
      await new Promise((done) => setTimeout(done, 1));
      running--;
      return { results: [] };
    });
    const covers = new FeedCovers({ json } as never, store);
    await Promise.all(['a', 'b', 'c'].map((title) => covers.found('X', title)));
    expect(most).toBe(1);
  });
});

describe('faces', () => {
  const picture = () => new Response(new Blob(['x']));

  it('keeps a stamped picture, and asks again for an unstamped one after a minute', async () => {
    let now = 0;
    const call = vi.fn(async (_path: string) => picture());
    let made = 0;
    const faces = new Faces({ call } as never, () => now, () => `blob:${++made}`);
    expect(await faces.avatar('u', 7)).toBe('blob:1');
    expect(await faces.avatar('u', 7)).toBe('blob:1');
    expect(await faces.avatar('u', 0)).toBe('blob:2');
    now += 30_000;
    expect(await faces.avatar('u', 0)).toBe('blob:2');
    now += 31_000;
    expect(await faces.avatar('u', 0)).toBe('blob:3');
    expect(call.mock.calls.map(([path]) => path)).toEqual(['profiles/u/avatar?v=7', 'profiles/u/avatar', 'profiles/u/avatar']);
  });

  it('asks again for a picture that could not be read', async () => {
    const call = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(picture());
    const faces = new Faces({ call } as never, Date.now, () => 'blob:x');
    expect(await faces.banner('u', 3)).toBeNull();
    expect(await faces.banner('u', 3)).toBe('blob:x');
  });
});

describe('what this browser plays, on the profile', () => {
  const song = (title: string): Song => ({ artist: 'A', title, album: 'L' });
  const playing = (title: string, paused = false) => ({ identity: title, song: song(title), paused });

  function share(shown: () => Song | null = () => null) {
    let now = 1_000_000;
    const setListening = vi.fn(async () => {});
    const clearListening = vi.fn(async () => {});
    const ownPerson = vi.fn(async () => person({ listening: shown() ? { ...shown()!, at: 0 } : null }));
    const listening = new ListeningShare({ setListening, clearListening, ownPerson }, () => true, () => now);
    return { listening, setListening, clearListening, ownPerson, advance: (ms: number) => ((now += ms), vi.advanceTimersByTime(ms)) };
  }

  it('sends a song when it starts, and the newest of songs that change faster than once a minute', () => {
    vi.useFakeTimers();
    const { listening, setListening, advance } = share();
    listening.note(playing('one'));
    listening.note(playing('one'));
    expect(setListening).toHaveBeenCalledTimes(1);
    listening.note(playing('two'));
    listening.note(playing('three'));
    expect(setListening).toHaveBeenCalledTimes(1);
    advance(60_000);
    expect(setListening).toHaveBeenCalledTimes(2);
    expect(setListening).toHaveBeenLastCalledWith(song('three'));
  });

  it('sends the song again every twenty minutes while it plays, not while it is paused', async () => {
    vi.useFakeTimers();
    const { listening, setListening, advance } = share(() => song('one'));
    listening.note(playing('one'));
    advance(20 * 60_000);
    listening.note(playing('one', true));
    expect(setListening).toHaveBeenCalledTimes(1);
    listening.note(playing('one'));
    await vi.waitFor(() => expect(setListening).toHaveBeenCalledTimes(2));
  });

  it('clears the song on a stop only while the profile still shows it', async () => {
    const mine = share(() => song('one'));
    mine.listening.note(playing('one'));
    mine.listening.note(null);
    await vi.waitFor(() => expect(mine.clearListening).toHaveBeenCalled());

    const another = share(() => song('from the phone'));
    another.listening.note(playing('one'));
    another.listening.note(null);
    await vi.waitFor(() => expect(another.ownPerson).toHaveBeenCalled());
    await Promise.resolve();
    expect(another.clearListening).not.toHaveBeenCalled();
  });
});
