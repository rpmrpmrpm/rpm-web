// The services of the app, made once.

import { CloudClient } from './api/cloud';
import { Api } from './api/http';
import { Session } from './api/session';
import { LOCK_SCREEN_ART, Player } from './audio/player';
import { browserTransfers, Importer } from './import/importer';
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
);

export const playlists = new Playlists(api);
export const releaseLookup = new ReleaseLookup(api);
export const coverSearch = new CoverSearch(api);
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
export const BECOME_SUPPORTER = 'https://rpmrpmrpm.com/become-supporter';
export const FORGOT_PASSWORD = 'https://rpmrpmrpm.com/forgot-password';
export const TERMS = 'https://rpmrpmrpm.com/terms';
export const PRIVACY = 'https://rpmrpmrpm.com/privacy';
