// Opens the library search over the window (SearchOverlay): from Cmd+F or Ctrl+F, the deck's search key and the
// phone's Search tab. The bar is the one library search: it opens from 'window', and a search open anywhere else
// goes away first.

import { librarySearch } from './library-search.svelte';
import { readLists, searchSources } from './sources';

export const SEARCH_BAR = 'window';

export function openSearchBar() {
  if (librarySearch.from === SEARCH_BAR) return;
  librarySearch.close();
  librarySearch.open(SEARCH_BAR, searchSources, readLists);
}
