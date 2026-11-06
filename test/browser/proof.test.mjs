// Plays the test album in three browser engines and checks that the stream runs through the track
// boundaries. The chain's joins are checked on samples in test/chain; this checks that a real browser
// accepts the stream and keeps playing it.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';

import { chromium, firefox, webkit } from 'playwright';

const port = 8124;
const server = spawn('node', ['proof/serve.mjs'], {
  cwd: new URL('../..', import.meta.url).pathname,
  env: { ...process.env, PORT: String(port) },
  stdio: 'ignore',
});
await new Promise((resolve) => setTimeout(resolve, 500));

async function state(page) {
  return page.evaluate(() => window.proof.state());
}

for (const [name, engine, options] of [
  ['Chromium', chromium, { args: ['--autoplay-policy=no-user-gesture-required'] }],
  ['Firefox', firefox, { firefoxUserPrefs: { 'media.autoplay.default': 0 } }],
  ['WebKit', webkit, {}],
]) {
  for (const set of ['flac', 'aac128']) {
    test(`${name} plays the ${set} album across a track boundary`, { timeout: 120_000 }, async () => {
      const browser = await engine.launch(options);
      const page = await browser.newPage();
      const problems = [];
      page.on('pageerror', (error) => problems.push(String(error)));
      page.on('console', (message) => { if (message.type() === 'error') problems.push(message.text()); });

      await page.goto(`http://localhost:${port}/proof/`);
      await page.selectOption('#set', set);
      await page.evaluate(() => { document.getElementById('audio').muted = true; });
      await page.click('#play');

      await page.waitForFunction(() => document.getElementById('audio').currentTime > 1, null, { timeout: 30_000 });

      // Skip to just before the first join by moving the playhead, which is quicker than listening.
      await page.evaluate(() => { document.getElementById('audio').currentTime = 23.5; });
      await page.waitForFunction(() => window.proof.state().crossings >= 1, null, { timeout: 60_000 });

      const seen = await state(page);
      console.log(name, set, 'crossed at', seen.currentTime.toFixed(2), 'buffered to', seen.bufferEnd.toFixed(1),
        'speed', (seen.speed.reduce((a, b) => a + b, 0) / seen.speed.length).toFixed(0), 'x real time');
      assert.equal(seen.error, null);
      assert.deepEqual(problems, []);
      assert.ok(seen.boundaries.length >= 2);
      await browser.close();
    });
  }
}

test.after(() => server.kill());
