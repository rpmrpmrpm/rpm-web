// What the library search looks through, as the app holds it when a search opens: the records, the artist and
// genre walls, and every list the playlists view offers by name. The bar over the window opens the search with
// these (openSearchBar).

import { playlists } from '../../app';
import { UNCLASSIFIED } from '../../library/genres';
import { artistWall, genreWall } from '../../library/walls';
import { library } from '../../state.svelte';
import { text } from '../../strings/loc';
import type { FoundList, Sources } from './library-search.svelte';

// The name a genre is shown under, which is what the search matches.
export const genreName = (name: string): string => (name === UNCLASSIFIED ? text('Queue_ChipNotIdentified') : name);

export const searchSources = (): Omit<Sources, 'lists'> => ({
  albums: library.albums,
  artists: artistWall(library.albums),
  genres: genreWall(library.albums),
  genreName,
});

// Every list the playlists view offers by name: the ones the listener made, each with the folder it is filed in,
// and the ones made for them.
export async function readLists(): Promise<FoundList[]> {
  const [held, made] = await Promise.all([playlists.list(), playlists.generated().catch(() => [])]);
  return [
    ...held.map((list): FoundList => ({ kind: 'list', list, name: list.name, line: list.folder.at(-1) ?? '' })),
    ...made.map((list): FoundList => ({ kind: 'generated', list, name: list.title ?? list.kind, line: '' })),
  ];
}
