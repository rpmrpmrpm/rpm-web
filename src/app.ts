// The services of the app, made once.

import { CloudClient } from './api/cloud';
import { Api } from './api/http';
import { Session } from './api/session';
import { Player } from './audio/player';
import { browserTransfers, Importer } from './import/importer';
import { WorkerMedia } from './import/media';
import { ImportQueue } from './import/queue';
import { Catalogue } from './library/catalogue';
import { Covers } from './library/covers';
import { browserStore } from './library/store';

export const session = new Session('/accounts/');
export const api = new Api('/api/', session);
export const cloud = new CloudClient(api);
export const covers = new Covers(api);
export const catalogue = new Catalogue(cloud, browserStore, Date.now, () => covers.reread());
export const player = new Player(cloud);

export const importMedia = new WorkerMedia();
export const importQueue = new ImportQueue();
export const importer = new Importer(api, importMedia, browserTransfers, catalogue, importQueue);

// During the closed beta the app opens for testers and supporters, and anyone else is asked for the
// code from their mail. The account itself can be made freely, so this is a gate on the page, and the
// real limit is the storage quota.
export const admitted = (): boolean => session.user?.supporter === true;

export const BETA_FORM = 'https://rpmrpmrpm.com/beta';
export const FORGOT_PASSWORD = 'https://rpmrpmrpm.com/forgot-password';
export const TERMS = 'https://rpmrpmrpm.com/terms';
export const PRIVACY = 'https://rpmrpmrpm.com/privacy';
