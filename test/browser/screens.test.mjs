// Each screen against the desktop app. The numbers are what the desktop's own visual tree and markup say, measured
// at 1440 by 900, so a screen that drifts fails here rather than on somebody's phone. A full library stands behind
// the mock, because a short one hides what long titles do to a layout.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, test } from 'node:test';

import { chromium, devices, webkit } from 'playwright';

import { coverKeysOn, FILES, serve } from './fixture.mjs';

const port = 8131;
const site = `http://localhost:${port}`;
const root = new URL('../..', import.meta.url).pathname;
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore', detached: true });
await new Promise((done) => setTimeout(done, 2500));
after(() => process.kill(-server.pid));

const browser = await chromium.launch();
after(() => browser.close());
const safari = await webkit.launch();
after(() => safari.close());

async function open(options = { viewport: { width: 1440, height: 900 } }, engine = browser) {
  const context = await engine.newContext(options);
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error)));
  await serve(page, site);
  await page.goto(site);
  await page.waitForSelector('.rail, .tabs');
  await coverKeysOn(page);
  await page.reload();
  await page.waitForSelector('.rail, .tabs');
  await page.waitForTimeout(600);
  // WebKit reports what the reload cancelled, which says nothing about the page.
  problems.length = 0;
  return { page, problems, close: () => context.close() };
}

const rail = (page, name) => page.click(`.rail button:has-text("${name}")`);

const style = (page, selector, ...names) =>
  page.$eval(
    selector,
    (element, names) => {
      const found = getComputedStyle(element);
      return Object.fromEntries(names.map((name) => [name, found[name]]));
    },
    names,
  );

const box = (page, selector) => page.$eval(selector, (element) => JSON.parse(JSON.stringify(element.getBoundingClientRect())));

test('the opening plays first, and the interface fades in behind it', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await serve(page, site);
  const started = Date.now();
  await page.goto(site, { waitUntil: 'commit' });

  // It is in the page itself, so it stands before any script or style sheet has arrived.
  await page.waitForSelector('#opening .opening-band');
  assert.equal(await page.$eval('#app', (app) => getComputedStyle(app).opacity), '0');

  await page.waitForFunction(() => document.documentElement.classList.contains('opened'));
  assert.ok(Date.now() - started >= 1900, 'the band crossed twice');
  await page.waitForSelector('#opening', { state: 'detached' });
  await page.waitForFunction(() => getComputedStyle(document.getElementById('app')).opacity === '1');
  assert.ok(await page.$('.rail'), 'the interface was there to fade into');
  await context.close();
});

test('the opening goes, even when the library never answers', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await serve(page, site);
  await page.route(`${site}/api/cloud/list*`, () => {});
  await page.goto(site);
  await page.waitForSelector('#opening', { state: 'detached', timeout: 11_000 });
  await context.close();
});

test('the shell stands where the desktop stands', async () => {
  const { page, problems, close } = await open();

  const rails = await box(page, '.rail');
  assert.equal(rails.width, 82);
  assert.equal((await box(page, '.rail button')).height, 71);
  assert.equal((await style(page, '.rail button', 'fontSize')).fontSize, '10px');
  assert.equal((await style(page, '.heading', 'fontSize')).fontSize, '72px');
  assert.equal((await box(page, '.deck')).height, 76);

  // On a computer the window opens with Track info out, at the desktop's widest.
  assert.equal((await box(page, '.pane.left')).width, 520);
  assert.deepEqual(problems, []);
  await close();
});

test('the main interface has no white buttons', async () => {
  const { page, close } = await open();

  const pill = await style(page, '.deck-pill:not(.on)', 'backgroundImage', 'borderTopColor', 'borderTopLeftRadius', 'color');
  assert.equal(pill.borderTopLeftRadius, '6px');
  assert.match(pill.borderTopColor, /rgba\(255, 255, 255, 0\.13/);
  assert.match(pill.backgroundImage, /rgba\(0, 0, 0, 0\)/, 'a deck key has no face');

  await page.click('.deck .deck-pill >> nth=2');
  await page.click('.menu button:has-text("Settings")');
  await page.waitForSelector('[role=dialog]');
  const ghost = await style(page, '[role=dialog] .glass-button', 'boxShadow', 'height');
  assert.equal(ghost.boxShadow, 'none', 'the desktop button has no lift');
  assert.equal(ghost.height, '32px');
  await close();
});

test('a popup has the desktop header', async () => {
  const { page, close } = await open();

  await page.click('.deck .deck-pill >> nth=2');
  await page.click('.menu button:has-text("Settings")');
  await page.waitForSelector('[role=dialog]');
  await page.waitForTimeout(300);

  const card = await box(page, '[role=dialog]');
  const band = await box(page, '[role=dialog] header');
  assert.equal(band.height, 112);

  // The word fills a box 92 high, as a Viewbox does: about 189 pixels of a small-bodied face.
  const title = await page.$eval('[role=dialog] h2', (element) => parseFloat(getComputedStyle(element).fontSize));
  assert.ok(title > 180, `the title is ${title}`);

  const heading = await box(page, '[role=dialog] h2');
  assert.equal(heading.left - card.left, 27, 'the band adds a hairline to the 26 inset');

  const mark = await box(page, '[role=dialog] .mark');
  assert.equal(mark.left - card.left, 19);
  assert.equal(mark.top - card.top, 17);
  assert.equal(mark.width, 80);

  assert.equal(await page.$('[role=dialog] header .key'), null, 'a window with a footer closes from the footer');
  await close();
});

test('every pane starts its content on one line', async () => {
  const { page, close } = await open();
  await page.click('.pane-pill');
  await page.waitForTimeout(500);

  for (const [name, selector] of [
    ['Albums', '.collection .tools ~ *, .scroller'],
    ['Artists', '.scroller'],
    ['Genres', '.wall'],
  ]) {
    await rail(page, name);
    await page.waitForSelector(selector);
    await page.waitForTimeout(450);
    const pane = await box(page, '.pane.right');
    const content = await box(page, selector);
    assert.ok(Math.abs(content.top - pane.top - 71) <= 2, `${name} starts ${content.top - pane.top} down`);
  }
  await close();
});

test('the album band holds a few small keys, and nothing runs over', async () => {
  const { page, problems, close } = await open();
  await page.click('.pane-pill');
  await page.waitForTimeout(500);
  await rail(page, 'Albums');
  await page.waitForSelector('.card');
  await page.click('.views .slot-key >> nth=0');
  await page.click('.card >> nth=0');
  await page.waitForSelector('.band .track');

  assert.equal((await page.$$('.band .mini-key')).length, 3);
  const key = await box(page, '.band .mini-key');
  assert.ok(key.height <= 22 && key.width <= 26, 'the keys are small');
  assert.equal(await page.$('.band .glass-button'), null, 'no row of big buttons');

  const clipped = await page.$$eval('.band button', (keys) => keys.filter((key) => key.scrollWidth > key.clientWidth + 1).map((key) => key.textContent));
  assert.deepEqual(clipped, []);
  assert.equal((await style(page, '.band h3', 'fontSize')).fontSize, '17px');
  assert.deepEqual(problems, []);
  await close();
});

test('a track title stands as it is tagged', async () => {
  const { page, close } = await open();
  await page.click('.quick button, section li button');
  await page.waitForSelector('header.band h2');
  const { textTransform, fontSize } = await style(page, 'header.band h2', 'textTransform', 'fontSize');
  assert.equal(textTransform, 'none');
  assert.equal(fontSize, '22px');
  await close();
});

test('the right click: a record, a song, a table row, the menu key', async () => {
  const { page, problems, close } = await open();
  await page.click('.pane-pill');
  await page.waitForTimeout(500);
  await rail(page, 'Albums');
  await page.waitForSelector('.card');
  await page.click('.views .slot-key >> nth=0');

  await page.click('.card >> nth=1', { button: 'right' });
  await page.waitForSelector('[role=menu]');
  const words = await page.$$eval('[role=menuitem] .label', (rows) => rows.map((row) => row.textContent));
  assert.deepEqual(words, ['Add to playlist', 'Play', 'Shuffle', 'Play next', 'Album page', 'Edit album', 'Favourite album', 'Delete from cloud']);

  const menu = await box(page, '[role=menu]');
  const row = await box(page, '[role=menuitem]');
  assert.ok(menu.width >= 175);
  assert.equal(row.height, 25.5);
  assert.equal((await style(page, '[role=menuitem]', 'fontSize')).fontSize, '12px');

  // The list of playlists is read when the sub menu opens.
  await page.hover('[role=menuitem]:has-text("Add to playlist")');
  await page.waitForFunction(() => document.querySelectorAll('[role=menu]').length === 2);
  assert.ok(await page.$('[role=menuitem]:has-text("Road trip")'));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[role=menu]'));

  await page.click('.card >> nth=0');
  await page.waitForSelector('.band .track');
  await page.click('.band .track >> nth=0', { button: 'right' });
  await page.waitForSelector('[role=menuitem]:has-text("Edit track")');
  await page.keyboard.press('Escape');

  await page.click('.band .mini-key >> nth=2');
  await page.waitForSelector('[role=menuitem]:has-text("Edit album")');
  await page.keyboard.press('Escape');

  await page.click('.views .slot-key >> nth=2');
  await page.waitForSelector('.table .row');
  await page.click('.table .row >> nth=0', { button: 'right' });
  await page.waitForSelector('[role=menuitem]:has-text("Add to Now playing")');
  await page.keyboard.press('Escape');

  await page.click('.views .slot-key >> nth=1');
  await page.waitForSelector('article');
  await page.click('article h3 >> nth=0', { button: 'right' });
  await page.waitForSelector('[role=menuitem]:has-text("Edit album")');
  await page.keyboard.press('Escape');
  assert.deepEqual(problems, []);
  await close();
});

test('a playlist has a menu, and its songs have one', async () => {
  const { page, problems, close } = await open();
  await page.click('.pane-pill');
  await page.waitForTimeout(500);
  await rail(page, 'Playlists');
  await page.waitForSelector('.tile:has-text("Road trip")');
  await page.click('.tile:has-text("Road trip")', { button: 'right' });
  await page.waitForSelector('[role=menuitem]:has-text("Rename")');
  assert.ok(await page.$('[role=menuitem]:has-text("Change cover")'));
  await page.keyboard.press('Escape');

  await page.click('.tile:has-text("Road trip")');
  await page.waitForSelector('.song');
  await page.click('.song >> nth=0', { button: 'right' });
  await page.waitForSelector('[role=menuitem]:has-text("Remove")');
  assert.deepEqual(problems, []);
  await close();
});

test('the workbench is the desktop bench', async () => {
  const { page, problems, close } = await open();
  await rail(page, 'Import');
  await page.waitForSelector('text=Nothing queued');

  const dir = `${root}proof/tracks`;
  await page.setInputFiles('input[type=file][multiple]', [`${dir}/flac-1.flac`, `${dir}/flac-2.flac`, `${dir}/flac-3.flac`]);
  await page.waitForSelector('.line .row');

  // It takes the window, as the desktop's does.
  assert.equal(await page.$('.pane.right'), null);
  assert.equal((await box(page, '.line')).height, 22);
  assert.equal((await box(page, '.grid .head')).height, 22);
  assert.equal((await box(page, '.tool-key')).height, 28);

  const heads = await page.$$eval('.grid .head span', (cells) => cells.map((cell) => cell.textContent));
  assert.deepEqual(heads.slice(1, 6), ['Name', 'Folder', 'Title', 'Artist', 'Album']);

  // The tree: an artist, a record under them, and the files under that.
  assert.ok(await page.$('.line .by'));
  assert.ok(await page.$('.line .album'));

  await page.click('.line .row >> nth=0', { button: 'right' });
  await page.waitForSelector('[role=menuitem]:has-text("Recognise")');
  await page.keyboard.press('Escape');

  await page.click('.grid .head span:has-text("Folder")', { button: 'right' });
  await page.waitForSelector('[role=menuitem]:has-text("Hide column")');
  await page.keyboard.press('Escape');

  assert.match(await page.textContent('footer .status'), /3 files/);
  assert.ok(await page.$('footer button:text-is("All")'));
  assert.deepEqual(problems, []);
  await close();
});

test('Home counts the collection in plain words, and opens a record on its own page', async () => {
  const { page, problems, close } = await open();
  await page.waitForSelector('p:text-is("30 albums")');
  await page.waitForSelector('h3:has-text("Recently added")');
  await page.waitForSelector('h3:has-text("Quick selection")');

  await page.click('.shelf .card, section .card');
  await page.waitForSelector('.sheet .track');
  assert.equal(await page.$('[role=dialog]'), null, 'a record opens in the pane, as on the desktop');
  await page.click('.back-key');
  await page.waitForSelector('h3:has-text("Quick selection")');
  assert.deepEqual(problems, []);
  await close();
});

test('a new account starts on Import, on a computer and on a phone', async () => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await serve(page, site, []);
    await page.goto(site);
    await page.waitForSelector('text=Nothing queued');
    await context.close();
  }
});

test('a banner\'s photograph fills the card, with nothing faded down its left', async () => {
  const { page, close } = await open();
  await page.waitForSelector('.plate .photo:not(.soft).arrived');
  const face = await box(page, '.plate .face');
  const photo = await box(page, '.plate .photo:not(.soft)');
  assert.equal(photo.width, face.width);
  assert.equal(photo.left, face.left);
  const { backgroundImage } = await style(page, '.plate .scrim', 'backgroundImage');
  assert.ok(!backgroundImage.includes('90deg'), 'no fade runs across the card');
  await close();
});

test('a small collection is told how far it has to go', async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await serve(page, site, FILES.slice(0, 15));
  await page.goto(site);
  await page.waitForSelector('.rail');

  // It lands on the records, and Home says what it is waiting for.
  await page.waitForSelector('.collection');
  await page.click('.deck .home');
  await page.waitForSelector('text=albums to go');
  assert.ok(await page.$('button:has-text("Add music")'));
  assert.equal(await page.$('.strip'), null, 'no banner of the same three records');
  await context.close();
});

for (const [name, engine, device] of [
  ['Chromium', browser, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }],
  ['WebKit', safari, { viewport: { width: 390, height: 844 }, hasTouch: true }],
]) {
  test(`on a phone in ${name}, nothing is wider than the screen`, async () => {
    const { page, problems, close } = await open(device, engine);
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth);

    await page.waitForSelector('.tabs');
    for (const tab of ['Home', 'Albums', 'Radio', 'Import', 'Account']) {
      await page.click(`.tabs button:has-text("${tab}")`);
      await page.waitForTimeout(350);
      assert.equal(await fits(), 390, tab);
      const tabs = await box(page, '.tabs');
      assert.equal(tabs.width, 390, `the tab bar on ${tab}`);
      const last = await box(page, '.tabs button:last-child');
      assert.ok(last.right <= 390, `the last tab on ${tab}`);
    }
    assert.deepEqual(problems, []);
    await close();
  });
}

test('a long press is a phone\'s right click', async () => {
  const { page, close } = await open({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } });
  await page.click('.tabs button:has-text("Albums")');
  await page.waitForSelector('.card');
  const card = await box(page, '.card');
  await page.dispatchEvent('.card', 'pointerdown', { pointerType: 'touch', clientX: card.left + 40, clientY: card.top + 40, bubbles: true });
  await page.waitForSelector('[role=menu].sheet');
  const sheet = await box(page, '[role=menu]');
  assert.equal(sheet.width, 390);
  assert.equal(sheet.bottom, 844);
  await page.dispatchEvent('.card', 'pointerup', { pointerType: 'touch', bubbles: true });
  await close();
});
