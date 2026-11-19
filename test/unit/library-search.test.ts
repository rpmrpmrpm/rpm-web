import { describe, expect, it } from 'vitest';

import type { CloudTrack } from '../../src/api/wire';
import { groupAlbums } from '../../src/library/albums';
import { artistWall, genreWall } from '../../src/library/walls';
import { findAll, LibrarySearch, nothingFound, type FoundList } from '../../src/views/search/library-search.svelte';
import { forget, MOST, remember, SearchHistory } from '../../src/views/search/search-history.svelte';

describe('recent searches', () => {
  it('puts a search at the top, and one that grew from the newest replaces it', () => {
    expect(remember([], 'radi')).toEqual(['radi']);
    expect(remember(['radi'], 'radiohead')).toEqual(['radiohead']);
    expect(remember(['radiohead'], 'radio')).toEqual(['radio']);
    expect(remember(['abba', 'radiohead'], 'Radiohead')).toEqual(['Radiohead', 'abba']);
  });

  it('keeps no search shorter than two characters, and at most ten', () => {
    expect(remember(['abba'], ' x ')).toEqual(['abba']);
    const many = Array.from({ length: 12 }, (_, index) => `search ${String.fromCharCode(97 + index)}`);
    expect(many.reduce((kept, asked) => remember(kept, asked), [] as string[])).toHaveLength(MOST);
  });

  it('forgets one search, and is kept in the browser', () => {
    expect(forget(['a1', 'b2'], 'a1')).toEqual(['b2']);
    const held = new Map<string, string>();
    const store = { getItem: (key: string) => held.get(key) ?? null, setItem: (key: string, value: string) => void held.set(key, value) };
    const history = new SearchHistory(() => store);
    history.remember('Kid A');
    expect(new SearchHistory(() => store).entries).toEqual(['Kid A']);
    history.clear();
    expect(new SearchHistory(() => store).entries).toEqual([]);
  });

  it('starts empty from a list it cannot read', () => {
    expect(new SearchHistory(() => ({ getItem: () => '{not json', setItem: () => {} })).entries).toEqual([]);
  });
});

const track = (id: string, title: string, artist: string, album: string, genre = 'Rock'): CloudTrack =>
  ({ rpmId: id, sha256: id, relativePath: `${artist}/${album}/${title}.flac`, originalSize: 1, title, artist, album, addedAt: 0, updatedAt: 0, tags: { genre, albumArtist: artist } }) as CloudTrack;

const albums = groupAlbums([
  track('1', 'Idioteque', 'Radiohead', 'Kid A', 'Electronic'),
  track('2', 'Everything in Its Right Place', 'Radiohead', 'Kid A', 'Electronic'),
  track('3', 'Crazy in Love', 'Beyoncé', 'Dangerously in Love', 'R&B'),
  track('4', 'Thunderstruck', 'AC/DC', 'The Razors Edge'),
]);

const lists: FoundList[] = [{ kind: 'list', list: { playlistId: 'p', name: 'Kid stuff' } as never, name: 'Kid stuff', line: '' }];

const sources = { albums, artists: artistWall(albums), genres: genreWall(albums), lists, genreName: (name: string) => name };

describe('the library search', () => {
  it('finds artists by their folded name', () => {
    expect(findAll(sources, 'beyonce').artists.map((artist) => artist.name)).toEqual(['Beyoncé']);
    expect(findAll(sources, 'acdc').artists.map((artist) => artist.name)).toEqual(['AC/DC']);
  });

  it('finds a record by its name or who made it, never by one of its songs', () => {
    expect(findAll(sources, 'kid').records.map((album) => album.album)).toEqual(['Kid A']);
    expect(findAll(sources, 'idioteque').records).toEqual([]);
    expect(findAll(sources, 'idioteque').songs.map((hit) => hit.track.title)).toEqual(['Idioteque']);
  });

  it('finds the songs of a record named by the words', () => {
    expect(findAll(sources, 'kid a').songs).toHaveLength(2);
  });

  it('finds playlists and genres by name', () => {
    expect(findAll(sources, 'kid').lists.map((list) => list.name)).toEqual(['Kid stuff']);
    expect(findAll(sources, 'electro').genres.length).toBeGreaterThan(0);
  });

  it('says when nothing was found', () => {
    expect(nothingFound(findAll(sources, 'zzzz'))).toBe(true);
    expect(nothingFound(findAll(sources, 'love'))).toBe(false);
  });
});

describe('the search as it is open', () => {
  const opened = () => {
    const search = new LibrarySearch();
    search.open('window', () => ({ albums, artists: artistWall(albums), genres: genreWall(albums), genreName: (name: string) => name }), () => new Promise(() => {}));
    return search;
  };

  it('shows the recent searches until the first answer, and is caught up once the answer is for the words', () => {
    const search = opened();
    search.ask('kid');
    expect(search.showsRecent).toBe(true);
    expect(search.caughtUp).toBe(false);
    search.now();
    expect(search.showsRecent).toBe(false);
    expect(search.caughtUp).toBe(true);
    expect(search.found?.records.map((album) => album.album)).toEqual(['Kid A']);
    search.close();
  });

  // Enter in the bar before the typing paused: the answer is for the words now in the box, not the ones before.
  it('answers the words in the box at once, without waiting for the typing to pause', () => {
    const search = opened();
    search.ask('kid');
    search.now();
    search.ask('thunder');
    expect(search.caughtUp).toBe(false);
    search.now();
    expect(search.caughtUp).toBe(true);
    expect(search.found?.songs.map((hit) => hit.track.title)).toEqual(['Thunderstruck']);
    search.close();
  });

  it('says nothing was found only once the answer is for the words', () => {
    const search = opened();
    search.ask('kid');
    search.now();
    search.ask('kidzz');
    expect(search.showsAnything).toBe(true);
    search.now();
    expect(nothingFound(search.found!)).toBe(true);
    expect(search.showsAnything).toBe(true);
    search.close();
    expect(search.showsAnything).toBe(false);
  });
});

