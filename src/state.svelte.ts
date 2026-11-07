// What the views read: plain reactive copies of the player and the library. The services themselves
// know nothing about Svelte.

import type { CloudTrack } from './api/wire';
import { catalogue, favorites, player, playLog, tuner } from './app';
import type { Repeat } from './audio/player';
import type { CloudAlbum } from './library/albums';
import type { CatalogueState } from './library/catalogue';
import type { RadioStation } from './radio/station';
import type { Air } from './radio/tuner';

export const now = $state({
  track: null as CloudTrack | null,
  index: -1,
  queue: [] as CloudTrack[],
  seconds: 0,
  duration: 0,
  wantsToPlay: false,
  stopped: false,
  loading: false,
  trouble: null as string | null,
  repeat: 'off' as Repeat,
  shuffled: false,
  volume: 1,
});

export const onAir = $state({
  station: null as RadioStation | null,
  air: 'off' as Air,
  wantsToPlay: false,
});

tuner.onChange(() => {
  onAir.station = tuner.station;
  onAir.air = tuner.air;
  onAir.wantsToPlay = tuner.wantsToPlay;
});

export const library = $state({
  albums: [] as CloudAlbum[],
  state: 'opening' as CatalogueState,
  stale: false,
  read: 0,
  songs: 0,
  seconds: 0,
  // Raised when a play is counted. The counts themselves stay in the log.
  playsVersion: 0,
  // Raised when a favourite changes. The marks themselves stay in Favorites.
  marksVersion: 0,
});

playLog.onChange(() => library.playsVersion++);
favorites.onChange(() => library.marksVersion++);

player.onChange(() => {
  if (now.track !== player.current) now.track = player.current;
  now.index = player.index;
  now.queue = player.queue.map((row) => row.track);
  now.seconds = player.seconds;
  now.duration = player.duration;
  now.wantsToPlay = player.wantsToPlay;
  now.stopped = player.stopped;
  now.loading = player.starting;
  now.trouble = player.trouble;
  now.repeat = player.repeat;
  now.shuffled = player.isShuffled;
  now.volume = player.volume;
});

catalogue.onChange(() => {
  favorites.readTracks(catalogue.tracks);
  library.albums = catalogue.albums;
  library.state = catalogue.state;
  library.stale = catalogue.stale;
  library.read = catalogue.read;
  library.songs = catalogue.tracks.length;
  library.seconds = catalogue.tracks.reduce((sum, track) => sum + (track.tags?.durationSeconds ?? 0), 0);
});
