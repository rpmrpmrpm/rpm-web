// What the views read: plain reactive copies of the player and the library. The services themselves
// know nothing about Svelte.

import type { CloudTrack } from './api/wire';
import { catalogue, player } from './app';
import type { Repeat } from './audio/player';
import type { CloudAlbum } from './library/albums';
import type { CatalogueState } from './library/catalogue';

export const now = $state({
  track: null as CloudTrack | null,
  index: -1,
  queue: [] as CloudTrack[],
  seconds: 0,
  duration: 0,
  wantsToPlay: false,
  loading: false,
  trouble: null as string | null,
  repeat: 'off' as Repeat,
  shuffled: false,
  volume: 1,
});

export const library = $state({
  albums: [] as CloudAlbum[],
  state: 'opening' as CatalogueState,
  stale: false,
  read: 0,
  songs: 0,
  seconds: 0,
});

player.onChange(() => {
  if (now.track !== player.current) now.track = player.current;
  now.index = player.index;
  now.queue = player.queue.map((row) => row.track);
  now.seconds = player.seconds;
  now.duration = player.duration;
  now.wantsToPlay = player.wantsToPlay;
  now.loading = player.starting;
  now.trouble = player.trouble;
  now.repeat = player.repeat;
  now.shuffled = player.isShuffled;
  now.volume = player.volume;
});

catalogue.onChange(() => {
  library.albums = catalogue.albums;
  library.state = catalogue.state;
  library.stale = catalogue.stale;
  library.read = catalogue.read;
  library.songs = catalogue.tracks.length;
  library.seconds = catalogue.tracks.reduce((sum, track) => sum + (track.tags?.durationSeconds ?? 0), 0);
});
