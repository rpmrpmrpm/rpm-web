// A page for testing the player on a real device or in a test browser. It runs on the dev server, plays
// the albums proof/make-tracks.mjs writes, and logs what happens, because a locked phone cannot be
// watched.

import { readTrack, type CloudTrack } from '../src/api/wire';
import { Player, type Signer } from '../src/audio/player';

const LOG_KEY = 'rpm-proof-log';
const element = (id: string) => document.getElementById(id)!;

let lines: string[] = [];
try {
  lines = JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]');
} catch {
  lines = [];
}

function log(text: string) {
  lines = [...lines, `${new Date().toLocaleTimeString()}${document.hidden ? ' [hidden]' : ''} ${text}`].slice(-200);
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(lines));
  } catch {
    // The log still shows on the page.
  }
  element('log').textContent = [...lines].reverse().join('\n');
}

function album(set: string, tracks = 14): CloudTrack[] {
  const extension = set === 'flac' ? 'flac' : set === 'mp3' ? 'mp3' : 'm4a';
  return Array.from({ length: tracks }, (_, index) =>
    readTrack({
      rpmId: `${set}-${(index % 7) + 1}`,
      relativePath: `test/album/${set}-${(index % 7) + 1}.${extension}`,
      title: `${set} ${index + 1}`,
      artist: 'rpm test',
      album: 'Playback test',
      tags: { durationSeconds: 25 },
    }));
}

// Signs by file name. A track whose id starts with missing has an address that answers 404.
const signer: Signer = {
  async stream(rpmId) {
    const extension = rpmId.startsWith('flac') ? 'flac' : rpmId.startsWith('mp3') ? 'mp3' : 'm4a';
    const signs = (window as unknown as { signs: string[] }).signs;
    signs.push(rpmId);
    return { url: new URL(`/proof/tracks/${rpmId}.${extension}`, location.href).href, kilobits: 0, live: false };
  },
  async requestRendition() {},
};
(window as unknown as { signs: string[] }).signs = [];

const player = new Player(signer);
let shown: CloudTrack | null = null;
player.onChange(() => {
  if (player.current !== shown) {
    shown = player.current;
    log(`now ${shown?.title}`);
    element('title').textContent = shown?.title ?? '';
  }
  element('where').textContent = `${player.seconds.toFixed(1)} of ${player.duration.toFixed(0)} s`;
});

document.addEventListener('visibilitychange', () => log(`page ${document.hidden ? 'hidden' : 'visible'}`));
element('play').addEventListener('click', () => player.play(album((element('set') as HTMLSelectElement).value), 0));
element('toggle').addEventListener('click', () => player.toggle());
element('next').addEventListener('click', () => player.next());

Object.assign(window, { player, album, readTrack });
