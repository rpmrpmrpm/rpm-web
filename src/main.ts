import { mount } from 'svelte';

import App from './App.svelte';
import { api, session } from './app';
import './design/base.css';
import { captureCrashes, sendHeldCrashes } from './report/report';
import { chooseLanguage, loadStrings } from './strings/loc';

captureCrashes();

await loadStrings(chooseLanguage(navigator.languages));

mount(App, { target: document.getElementById('app')! });

// The address of the page that finishes a social sign-in carries the one-time code in its fragment.
// It is taken off the address straight away, so it does not stay in the history.
if (location.pathname === '/signed-in') {
  const fragment = location.hash.slice(1);
  history.replaceState(null, '', '/');
  await session.finishSocialSignIn(fragment);
}
if (session.state === 'restoring') await session.restore();
if (session.state === 'signed-in') void sendHeldCrashes(api);
