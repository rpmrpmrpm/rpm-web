// The page open inside each view of the library: an artist, a genre, a playlist. Held here and not in the views,
// so that a press on a view's own key, on either rail or on the deck, can close the page and show the view itself,
// as the desktop's rails do. A view that is taken down and put back up (under the import pane, or when the window
// changes width) also keeps the page it had.

import type { GeneratedList } from '../../library/playlists';
import { asked } from './record-menu.svelte';

export type LibraryMode = 'home' | 'albums' | 'artists' | 'genres' | 'playlists';

export type PlaylistOpened = { kind: 'list'; id: string } | { kind: 'generated'; list: GeneratedList } | { kind: 'queue' };

class Pages {
  artist = $state<string | null>(null);
  genre = $state<string | null>(null);
  playlist = $state.raw<PlaylistOpened | null>(null);
}

export const pages = new Pages();

// A press on Home or on one of the library's keys asks for that view, not for a page open in it. A record's page
// stands over every view, so it closes for any of them. The other views keep their pages: their own key asks
// for them again.
export function toWall(mode: LibraryMode) {
  asked.opening = null;
  if (mode === 'artists') pages.artist = null;
  else if (mode === 'genres') pages.genre = null;
  else if (mode === 'playlists') pages.playlist = null;
}
