// The setup over an empty library, the keys that always show their view, and the one volume for the player and
// the radio.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, test } from 'node:test';

import { chromium } from 'playwright';

import { serve } from './fixture.mjs';

const port = 8135;
const site = `http://localhost:${port}`;
const root = new URL('../..', import.meta.url).pathname;
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore', detached: true });
await new Promise((done) => setTimeout(done, 2500));
after(() => process.kill(-server.pid));

const browser = await chromium.launch();
after(() => browser.close());

async function open({ files, viewport = { width: 1440, height: 900 } } = {}) {
  const context = await browser.newContext({ viewport });
  // Every audio element the page makes, so a test can read the level each one plays at.
  await context.addInitScript(() => {
    const Made = window.Audio;
    window.made = [];
    window.Audio = function (...args) {
      const element = new Made(...args);
      window.made.push(element);
      return element;
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error)));
  await serve(page, site, files);
  await page.goto(site);
  return { page, problems, close: () => context.close() };
}

const next = (page) => page.click('.setup footer .keys button:last-child');

test('an empty library opens on the setup, which ends at the Import pane with what was chosen', async () => {
  const { page, problems, close } = await open({ files: [] });
  await page.waitForSelector('.setup .hello');
  await page.click('.setup .hello button:has-text("Continue")');
  await page.waitForSelector('.setup h1:has-text("Country and language")');
  assert.equal(await page.textContent('.setup .kicker'), 'Step 1 of 5');
  await page.selectOption('#setup-country', 'NL');
  await next(page);
  assert.equal(await page.evaluate(() => localStorage.getItem('rpm.radioCountry')), 'NL');

  await page.waitForSelector('.setup h1:has-text("Import your music")');
  await page.click('.setup .tile:has-text("Try our tracks")');
  await page.waitForSelector('.setup .chosen:has-text("Three tracks from rpm")', { timeout: 20000 });
  await page.waitForSelector('.setup .chosen:has-text("3 tracks ticked for import")', { timeout: 20000 });

  // Change takes back what the choice put in the queue.
  await page.click('.setup .chosen button:has-text("Change")');
  await page.click('.setup .tile:has-text("Try our tracks")');
  await page.waitForSelector('.setup .chosen:has-text("3 tracks ticked for import")', { timeout: 20000 });
  await page.click('.setup footer button:has-text("Skip for now")');

  await page.waitForSelector('.setup h1:has-text("Make rpm your own")');
  await page.click('.setup .picture:has-text("Night")');
  assert.equal(await page.evaluate(() => localStorage.getItem('rpm-backdrop')), 'night');
  await next(page);

  await page.waitForSelector('.setup h1:has-text("How do you want to browse")');
  await page.click('.setup .layout:has-text("Data table")');
  assert.equal(await page.evaluate(() => localStorage.getItem('rpm-library-view')), 'table');
  await next(page);

  await page.waitForSelector('.setup h1:has-text("all set")');
  await page.click('.setup footer button:has-text("Open my collection")');
  await page.waitForSelector('.setup', { state: 'detached' });
  await page.waitForSelector('.pane.left .pane-head:has-text("3 tracks ticked for import")');

  // Once per account in this browser.
  await page.reload();
  await page.waitForSelector('.rail');
  await page.waitForTimeout(800);
  assert.equal(await page.$('.setup'), null);
  assert.deepEqual(problems, []);
  await close();
});

test('a new language reloads the page, and the setup goes on at the same step in it', async () => {
  const { page, close } = await open({ files: [] });
  await page.click('.setup .hello button:has-text("Continue")');
  await page.waitForSelector('#setup-language');
  await Promise.all([page.waitForEvent('load'), page.selectOption('#setup-language', 'fr')]);
  await page.waitForSelector('.setup .kicker');
  assert.equal(await page.$('.setup .hello'), null);
  assert.match(await page.textContent('.setup h1'), /langue/i);
  await close();
});

test('a library with music in it opens without the setup', async () => {
  const { page, close } = await open();
  await page.waitForSelector('.rail');
  await page.waitForTimeout(800);
  assert.equal(await page.$('.setup'), null);
  await close();
});

test('the library keys always show their view: over Import, and over a page open in the view', async () => {
  const { page, close } = await open();
  await page.waitForSelector('.rail');

  await page.click('.rail.right button:has-text("Artists")');
  await page.click('[data-artist] >> nth=0');
  await page.waitForSelector('.pane.right .back-key');
  await page.click('.rail.right button:has-text("Artists")');
  await page.waitForSelector('.pane.right h2:has-text("artists")');

  await page.click('.rail button:has-text("Import")');
  await page.waitForSelector('.pane.right', { state: 'detached' });
  await page.click('.deck button.home');
  await page.waitForSelector('.pane.right');
  assert.equal(await page.getAttribute('.deck button.home', 'aria-pressed'), 'true');
  await close();
});

test('the speaker mark mutes and puts the level back, and the radio plays at the same level', async () => {
  const { page, close } = await open();
  await page.waitForSelector('.deck .volume');
  await page.$eval('.deck .volume', (slider) => {
    slider.value = '0.4';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // The player and the radio each have an element, and both follow the one slider.
  const levels = () => page.evaluate(() => window.made.map((element) => Math.round(element.volume * 100)));
  assert.ok((await levels()).length >= 2);
  assert.ok((await levels()).every((level) => level === 40));

  await page.click('.deck button.mark');
  assert.equal(await page.getAttribute('.deck button.mark', 'aria-label'), 'Unmute');
  assert.ok((await levels()).every((level) => level === 0));
  assert.equal(await page.textContent('.deck .readout'), '0%');

  await page.click('.deck button.mark');
  assert.equal(await page.getAttribute('.deck button.mark', 'aria-label'), 'Mute');
  assert.ok((await levels()).every((level) => level === 40));
  await close();
});
