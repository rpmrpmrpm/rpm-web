// The player in three browser engines. The joins are checked on samples in test/chain. This checks
// the arrivals that only a real browser has: appends, seeks and key presses that overlap.
//
// Needs proof/tracks, which node proof/make-tracks.mjs writes.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';

import { chromium, firefox, webkit } from 'playwright';

const port = 8124;
const root = new URL('../..', import.meta.url).pathname;
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore', detached: true });
await new Promise((done) => setTimeout(done, 2500));

const read = (page) => page.evaluate(() => ({
  title: window.player.current?.title,
  seconds: window.player.seconds,
  index: window.player.index,
  loaded: window.player.loaded,
  wants: window.player.wantsToPlay,
  starting: window.player.starting,
  trouble: window.player.trouble,
  signs: window.signs,
}));

async function open(engine, options) {
  const browser = await engine.launch(options);
  const page = await browser.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/404/.test(message.text())) problems.push(message.text());
  });
  await page.goto(`http://localhost:${port}/proof/index.html`);
  await page.waitForFunction(() => window.player);
  await page.evaluate(() => { document.querySelector('audio')?.remove(); });
  return { browser, page, problems };
}

// Starts inside a click, as a person does. Muted, so a browser with no audio device does not hold it.
async function start(page, script) {
  await page.evaluate((body) => {
    const button = document.getElementById('play');
    button.replaceWith(button.cloneNode(true));
    document.getElementById('play').addEventListener('click', new Function(body));
  }, script);
  await page.click('#play');
}

const playing = (page, title, timeout = 30_000) =>
  page.waitForFunction((wanted) => window.player.current?.title === wanted && window.player.seconds > 0.2 && !window.player.starting, title, { timeout });

for (const [name, engine, options] of [
  ['Chromium', chromium, { args: ['--autoplay-policy=no-user-gesture-required'] }],
  ['Firefox', firefox, { firefoxUserPrefs: { 'media.autoplay.default': 0 } }],
  ['WebKit', webkit, {}],
]) {
  test(`${name}: the queue crosses into the next track by itself`, { timeout: 90_000 }, async () => {
    const { browser, page, problems } = await open(engine, options);
    await start(page, "window.player.setVolume(0.01); window.player.play(window.album('aac128'), 0);");
    await playing(page, 'aac128 1');
    await page.evaluate(() => window.player.seek(23));
    await playing(page, 'aac128 2', 40_000);
    const state = await read(page);
    assert.equal(state.index, 1);
    assert.ok(state.signs.includes('aac128-2'));
    assert.deepEqual(problems, []);
    await browser.close();
  });

  test(`${name}: Next pressed twice lands on the second press, with nothing of the others`, { timeout: 90_000 }, async () => {
    const { browser, page, problems } = await open(engine, options);
    await start(page, "window.player.setVolume(0.01); window.player.play(window.album('flac'), 0);");
    await playing(page, 'flac 1');
    await page.evaluate(() => { window.player.next(); window.player.next(); });
    assert.equal((await read(page)).title, 'flac 3');
    await playing(page, 'flac 3');
    const state = await read(page);
    assert.equal(state.index, 2);
    assert.ok(state.seconds < 10, `the position is ${state.seconds}`);
    assert.equal(state.wants, true);
    assert.deepEqual(problems, []);
    await browser.close();
  });

  test(`${name}: a seek past the buffer plays from there`, { timeout: 90_000 }, async () => {
    const { browser, page, problems } = await open(engine, options);
    await start(page, "window.player.setVolume(0.01); window.player.play(window.album('flac'), 0);");
    await playing(page, 'flac 1');
    await page.evaluate(() => window.player.seek(20));
    await page.waitForFunction(() => window.player.seconds >= 20 && window.player.seconds < 25 && !window.player.starting, null, { timeout: 30_000 });
    const state = await read(page);
    assert.equal(state.title, 'flac 1');
    assert.deepEqual(problems, []);
    await browser.close();
  });

  test(`${name}: pause pressed during loading holds, and play releases it`, { timeout: 60_000 }, async () => {
    const { browser, page, problems } = await open(engine, options);
    await start(page, "window.player.setVolume(0.01); window.player.play(window.album('flac'), 0); window.player.toggle();");
    await page.waitForFunction(() => window.player.loaded === 'paused' || window.player.wantsToPlay === false);
    await page.waitForTimeout(1500);
    const held = await read(page);
    assert.equal(held.wants, false);
    assert.ok(held.seconds < 0.5, `it played to ${held.seconds}`);
    await page.click('#toggle');
    await playing(page, 'flac 1');
    assert.deepEqual(problems, []);
    await browser.close();
  });

  test(`${name}: a first start is audible from the press, and only a change of track is silenced`, { timeout: 60_000 }, async () => {
    const { browser, page, problems } = await open(engine, options);
    await start(page, "window.player.setVolume(0.01); window.player.play(window.album('flac'), 0); window.mutedAtStart = window.player.audio.muted;");
    assert.equal(await page.evaluate(() => window.mutedAtStart), false);
    await playing(page, 'flac 1');

    assert.equal(await page.evaluate(() => { window.player.next(); return window.player.audio.muted; }), true);
    await playing(page, 'flac 2');
    assert.equal(await page.evaluate(() => window.player.audio.muted), false);
    assert.deepEqual(problems, []);
    await browser.close();
  });

  test(`${name}: a start the browser refuses arrives paused, and the key then starts it`, { timeout: 60_000 }, async () => {
    const { browser, page, problems } = await open(engine, options);
    await start(page, `
      window.player.audio.play = () => Promise.reject(new DOMException('refused', 'NotAllowedError'));
      window.player.setVolume(0.01);
      window.player.play(window.album('flac'), 0);
    `);
    await page.waitForFunction(() => window.player.loaded === 'paused', null, { timeout: 30_000 });
    assert.equal((await read(page)).wants, false);

    await page.evaluate(() => {
      delete window.player.audio.play;
      window.player.toggle();
    });
    await playing(page, 'flac 1');
    assert.deepEqual(problems, []);
    await browser.close();
  });

  test(`${name}: the lock screen gets the cover of the track that is playing`, { timeout: 60_000 }, async () => {
    const { browser, page } = await open(engine, options);
    await start(page, "window.player.setVolume(0.01); window.player.play(window.album('flac'), 0);");
    await playing(page, 'flac 1');
    const artwork = await page.evaluate(() => navigator.mediaSession?.metadata?.artwork?.[0]?.src ?? null);
    if (artwork !== null) assert.match(artwork, /\/art\/flac-1\.png$/);
    await browser.close();
  });

  test(`${name}: a track that cannot be read is tried again, then the queue moves on`, { timeout: 90_000 }, async () => {
    const { browser, page } = await open(engine, options);
    await start(page, `
      window.player.setVolume(0.01);
      const tracks = window.album('flac', 3);
      tracks[1] = window.readTrack({ rpmId: 'flac-missing', relativePath: 'test/album/flac-missing.flac', title: 'missing', tags: { durationSeconds: 25 } });
      window.player.play(tracks, 0);
    `);
    await playing(page, 'flac 1');
    await page.evaluate(() => window.player.seek(23));
    await playing(page, 'flac 3', 60_000);
    const state = await read(page);
    assert.equal(state.signs.filter((id) => id === 'flac-missing').length >= 3, true, 'it was not tried again');
    assert.equal(state.index, 2);
    await browser.close();
  });
}

test.after(() => {
  try {
    process.kill(-server.pid);
  } catch {
    // Already gone.
  }
});
