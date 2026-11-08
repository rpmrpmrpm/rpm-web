// The services of the app, made once.

import { CloudClient } from './api/cloud';
import { Api } from './api/http';
import { Profiles } from './api/profile';
import { Session } from './api/session';
import { HeadClips } from './audio/heads';
import { LOCK_SCREEN_ART, Player } from './audio/player';
import { browserTransfers, Importer } from './import/importer';
import { Articles } from './library/articles';
import { currentLanguage } from './strings/loc';
import { ArtistArt } from './library/artist-art';
import { Dossiers } from './library/dossier';
import { Lyrics } from './lyrics/lookup';
import { RadioDirectory } from './radio/directory';
import { RadioFavorites } from './radio/favorites';
import { RadioListens } from './radio/listens';
import { RadioRules } from './radio/rules';
import { Tuner } from './radio/tuner';
import { CatalogEdits } from './library/edit';
import { Readings } from './library/analysis';
import { Sidecars } from './library/sidecars';
import { Favorites } from './library/favorites';
import { AlbumRatings } from './library/ratings';
import { Recogniser } from './import/recognise';
import { browserQueue, QueueKeeper } from './import/saved-queue';
import { WorkerMedia } from './import/media';
import { ImportQueue } from './import/queue';
import { CoverSearch } from './import/cover-search';
import { ReleaseLookup } from './import/release';
import { Catalogue } from './library/catalogue';
import { Covers } from './library/covers';
import { Playlists } from './library/playlists';
import { PlayLog } from './library/plays';
import { browserPlays } from './library/plays-store';
import { installId } from './report/report';
import { browserStore } from './library/store';

export const session = new Session('/accounts/');
export const api = new Api('/api/', session);
export const cloud = new CloudClient(api);
export const covers = new Covers(api);
export const catalogue = new Catalogue(cloud, browserStore, Date.now, () => covers.reread());
export const playLog = new PlayLog(browserPlays);
catalogue.playsOf = (album) => {
  const plays = playLog.everythingPlayed();
  return album.tracks.reduce((sum, track) => sum + (plays.get(track.rpmId)?.plays ?? 0), 0);
};

export const headClips = new HeadClips(cloud);

const THROTTLE_SYNC_MS = 60_000;
let syncedAt = 0;

// Plays go out with the next pass. They are saved here first, so a closed tab loses none of them.
export function syncPlays() {
  if (Date.now() - syncedAt < THROTTLE_SYNC_MS) return;
  syncedAt = Date.now();
  void playLog.sync(cloud, `web-${installId()}`);
}

export const player = new Player(
  cloud,
  async (track) => {
    const album = catalogue.albums.find((a) => a.tracks.some((t) => t.rpmId === track.rpmId));
    return album ? covers.address(album, LOCK_SCREEN_ART) : null;
  },
  (rpmId) => {
    playLog.note(rpmId, Math.floor(Date.now() / 1000));
    syncPlays();
  },
  headClips,
);

export const playlists = new Playlists(api, browserTransfers);
export const favorites = new Favorites(api);
export const profiles = new Profiles(api);
export const sidecars = new Sidecars(api, browserTransfers);
export const readings = new Readings(api);
export const catalogEdits = new CatalogEdits(api, covers, browserTransfers, favorites, sidecars);
export const albumRatings = new AlbumRatings(() => localStorage);
export const releaseLookup = new ReleaseLookup(api);
export const coverSearch = new CoverSearch(api);
export const artistArt = new ArtistArt(api, (address) => coverSearch.shown(address));
const languages = () => [currentLanguage().split('-')[0], 'en'].join(',');
export const articles = new Articles(api, languages);
export const dossiers = new Dossiers(api, languages);
export const lyrics = new Lyrics(api);
export const importMedia = new WorkerMedia();
export const importQueue = new ImportQueue();
export const importer = new Importer(api, importMedia, browserTransfers, catalogue, importQueue);
export const recogniser = new Recogniser(api, importMedia, importQueue);
export const queueKeeper = new QueueKeeper(importQueue, browserQueue);

// During the closed beta the app opens for testers and supporters, and anyone else is asked for the
// code from their mail. The account itself can be made freely, so this is a gate on the page, and the
// real limit is the storage quota.
export const admitted = (): boolean => session.user?.supporter === true;

export const BETA_FORM = 'https://rpmrpmrpm.com/beta';
export const WEBSITE = 'https://rpmrpmrpm.com';
export const HELP = 'https://rpmrpmrpm.com/support';
export const CREDITS = 'https://rpmrpmrpm.com/credits';
export const BECOME_SUPPORTER = 'https://rpmrpmrpm.com/become-supporter';
export const FORGOT_PASSWORD = 'https://rpmrpmrpm.com/forgot-password';
export const TERMS = 'https://rpmrpmrpm.com/terms';
export const PRIVACY = 'https://rpmrpmrpm.com/privacy';

export const radioDirectory = new RadioDirectory(api);
export const radioRules = new RadioRules(api);
export const radioFavorites = new RadioFavorites(api);
const radioListens = new RadioListens(api, () => `web-${installId()}`);

export const tuner = new Tuner({
  starting: () => player.stop(),
  tuned: (station) => radioDirectory.reportPlayed(station.uuid),
  heard: (part) => void radioListens.note(part),
});

// Each stops the other. The keys on the lock screen go to whichever is playing.
player.onStarting = () => tuner.stop();
tuner.onChange(() => (player.remote = tuner.station ? tuner : null));
