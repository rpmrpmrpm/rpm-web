import { mount } from 'svelte';

import App from './App.svelte';
import { keepCodeFromAddress } from './api/beta-code';
import { api, catalogue, covers, favorites, importQueue, playLog, queueKeeper, session, syncPlays } from './app';
import './design/base.css';
import { endOpening } from './opening';
import { captureCrashes, sendHeldCrashes } from './report/report';
import { chooseLanguage, loadStrings, pickedLanguage } from './strings/loc';

captureCrashes();
keepCodeFromAddress();

// The loopback return is always on 127.0.0.1. A sign-in started on localhost, which is another site to the browser
// with its own storage and cookies, is passed back there before anything else runs.
if (import.meta.env.DEV && location.pathname === '/auth' && location.hostname === '127.0.0.1' && !session.socialPending) {
  location.replace(`http://localhost:${location.port}/auth${location.search}`);
  await new Promise(() => {});
}

// Discogs sends the browser back here, to a tab of its own. The tab the person came from hears about it.
if (new URLSearchParams(location.search).has('discogs')) {
  new BroadcastChannel('rpm-discogs').postMessage('changed');
  history.replaceState(null, '', '/');
  window.close();
}

await loadStrings(pickedLanguage() ?? chooseLanguage(navigator.languages));

mount(App, { target: document.getElementById('app')! });

// The library belongs to the account: it opens on sign-in and is gone on sign-out.
let opened = '';
function accountChanged() {
  const userId = session.user?.userId ?? '';
  if (userId === opened) return;
  opened = userId;
  if (userId) {
    void catalogue.open(userId);
    void playLog.open(userId).then(syncPlays);
    void queueKeeper.open(userId);
    void favorites.readAlbums();
  } else {
    catalogue.close();
    playLog.close();
    covers.forget();
    favorites.forget();
    queueKeeper.close();
    importQueue.remove([...importQueue.rows]);
  }
}
session.onChange(accountChanged);

// The address of the page that finishes a social sign-in carries the one-time code in its fragment.
// It is taken off the address straight away, so it does not stay in the history.
if (location.pathname === '/signed-in') {
  const fragment = location.hash.slice(1);
  history.replaceState(null, '', '/');
  await session.finishSocialSignIn(fragment);
}

// On the dev server a social sign-in comes back to http://127.0.0.1:{port}/auth, with the one-time code in the
// query (see SocialReturn). The same steps finish it.
if (import.meta.env.DEV && location.pathname === '/auth') {
  const query = location.search.slice(1);
  history.replaceState(null, '', '/');
  await session.finishSocialSignIn(query);
}

if (session.state === 'restoring') await session.restore();
if (session.state === 'signed-in') void sendHeldCrashes(api);

// The interface fades in once it has something to show: the sign-in, or the records.
const libraryShown = () => session.state !== 'signed-in' || (catalogue.state !== 'opening' && catalogue.state !== 'reading');
if (libraryShown()) endOpening();
else {
  const stop = catalogue.onChange(() => {
    if (!libraryShown()) return;
    stop?.();
    endOpening();
  });
}

addEventListener('focus', () => {
  catalogue.focused();
  syncPlays();
});
