// How the album collection is laid out: the grid of covers, the list with tracklists, or the table of songs.
// Shared state, because the setup's layout step chooses it while the collection may already be on screen.

export type CollectionView = 'grid' | 'list' | 'table';

const KEY = 'rpm-library-view';

function stored(): CollectionView {
  try {
    const found = localStorage.getItem(KEY);
    return found === 'list' || found === 'table' ? found : 'grid';
  } catch {
    return 'grid';
  }
}

export const collection = $state({ view: stored() });

export function pickView(next: CollectionView) {
  collection.view = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // It holds for this visit.
  }
}
