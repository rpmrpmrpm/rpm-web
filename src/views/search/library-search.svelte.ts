// The library search: one box for the whole collection, in the heading of Albums, Artists, Genres and Playlists.
// What is typed is answered in a panel under the heading, each kind under its own heading: artists, albums,
// tracks, playlists and genres. The rules are the phones' and the desktop's (LibrarySearchView): songs and
// records match their title, artist, record or record artist, ignoring case; artists, genres and playlists match
// their name folded (searchKey), so "beyonce" finds Beyoncé and "acdc" finds AC/DC. A record is found by its own
// name or who made it, never by one of its songs: the songs answer that.
//
// It does not narrow the views behind it. A search answers in its own list and the views stay whole, as on the
// phones. A record found is opened, a song is played.

import type { CloudPlaylist } from '../../library/playlists';
import type { GeneratedList } from '../../library/playlists';
import type { CloudAlbum } from '../../library/albums';
import { searchKey, type ArtistWallItem } from '../../library/artists';
import type { GenreWallItem } from '../../library/genres';
import { searchRecords, searchSongs, type SongHit } from '../../library/search';
import { SearchHistory, SETTLED_MS } from './search-history.svelte';

// How many answers a group shows before View more.
export const FIRST_SHOWN = 5;

// How long the typing must pause before the words are searched.
const TYPING_MS = 180;

export type FoundList = { kind: 'list'; list: CloudPlaylist; name: string; line: string } | { kind: 'generated'; list: GeneratedList; name: string; line: string };

export interface Found {
  artists: ArtistWallItem[];
  records: CloudAlbum[];
  songs: SongHit[];
  lists: FoundList[];
  genres: GenreWallItem[];
}

export interface Sources {
  albums: readonly CloudAlbum[];
  artists: readonly ArtistWallItem[];
  genres: readonly GenreWallItem[];
  lists: readonly FoundList[];
  // The name a genre is shown under, which is what the search matches.
  genreName: (name: string) => string;
}

export const nothingFound = (found: Found): boolean =>
  !found.artists.length && !found.records.length && !found.songs.length && !found.lists.length && !found.genres.length;

export function findAll(sources: Sources, asked: string): Found {
  const words = asked.trim();
  const folded = searchKey(words);
  const named = (name: string) => folded.length > 0 && searchKey(name).includes(folded);
  return {
    artists: sources.artists.filter((artist) => named(artist.name)),
    records: searchRecords(sources.albums, words),
    songs: searchSongs(sources.albums, words),
    lists: sources.lists.filter((list) => named(list.name)),
    genres: sources.genres.filter((genre) => named(sources.genreName(genre.name))),
  };
}

// What the search holds while it is up: whose box it is open under, the words, and what they found. One for the
// whole app, because only one heading's box is open at a time.
//
// Out of order: the typing timer and the settle timer are stopped by every keystroke and by closing, so a search
// never runs for words that are gone. The playlists are read when the search opens; their answer is dropped when
// the search was closed or opened again since (opened).
class LibrarySearch {
  // The heading's box the search is open under; null while it is put away.
  from = $state<string | null>(null);
  asked = $state('');
  found = $state.raw<Found | null>(null);
  // The words found was found for. "Nothing found" is said only once the search has caught up with the typing.
  foundFor = $state('');
  unfolded = $state.raw<ReadonlySet<string>>(new Set());
  lists = $state.raw<FoundList[]>([]);

  readonly history = new SearchHistory(() => {
    try {
      return localStorage;
    } catch {
      return null;
    }
  });

  private typing: ReturnType<typeof setTimeout> | undefined;
  private settling: ReturnType<typeof setTimeout> | undefined;
  private opened = 0;
  private sources: () => Omit<Sources, 'lists'> = () => ({ albums: [], artists: [], genres: [], genreName: (name) => name });

  // Puts the search up under a heading's box. A search already up under another box moves to this one, with what
  // was typed.
  open(from: string, sources: () => Omit<Sources, 'lists'>, readLists: () => Promise<FoundList[]>) {
    this.sources = sources;
    if (this.from === from) return;
    const fresh = this.from === null;
    this.from = from;
    if (!fresh) return;
    this.asked = '';
    this.found = null;
    this.foundFor = '';
    this.unfolded = new Set();
    const opened = ++this.opened;
    void readLists().then(
      (lists) => {
        if (opened !== this.opened || this.from === null) return;
        this.lists = lists;
        if (this.asked.trim()) this.run();
      },
      () => {},
    );
  }

  // The words in the box changed.
  ask(text: string) {
    this.asked = text;
    clearTimeout(this.typing);
    clearTimeout(this.settling);
    if (!text.trim()) {
      this.found = null;
      this.foundFor = '';
      return;
    }
    this.typing = setTimeout(() => this.run(), TYPING_MS);
    if (text.trim().length >= 2) this.settling = setTimeout(() => this.from !== null && this.history.remember(this.asked), SETTLED_MS);
  }

  private run() {
    const words = this.asked.trim();
    if (!words || this.from === null) return;
    const found = findAll({ ...this.sources(), lists: this.lists }, words);
    // A new search starts every group folded.
    if (this.foundFor.toLocaleLowerCase() !== words.toLocaleLowerCase()) this.unfolded = new Set();
    this.found = found;
    this.foundFor = words;
  }

  toggle(group: string) {
    const next = new Set(this.unfolded);
    if (!next.delete(group)) next.add(group);
    this.unfolded = next;
  }

  // An answer chosen: what was typed is remembered, and the search goes away.
  chosen() {
    this.history.remember(this.asked);
    this.close();
  }

  // Puts the search away. What was typed goes with it: opening it again starts a new search, as on the phones.
  close() {
    clearTimeout(this.typing);
    clearTimeout(this.settling);
    this.opened++;
    this.from = null;
    this.asked = '';
    this.found = null;
    this.foundFor = '';
  }
}

export const librarySearch = new LibrarySearch();
