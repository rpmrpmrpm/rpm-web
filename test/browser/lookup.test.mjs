// The windows of the workbench, with rpm's API answered here: looking up a release, filling the tracks
// from it, tags from tags, and a cover found by name or chosen from disk.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { chromium } from 'playwright';

const port = 8128;
const site = `http://localhost:${port}`;
const root = new URL('../..', import.meta.url).pathname;
const tracks = ['flac-1.flac', 'flac-2.flac'].map((name) => join(root, 'proof/tracks', name));
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore', detached: true });
await new Promise((done) => setTimeout(done, 2500));
after(() => process.kill(-server.pid));

const browser = await chromium.launch();
after(() => browser.close());

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const SEARCH = [{ releaseId: 'rel-1', title: 'Found Album', artist: 'Found Artist', year: 1998, country: 'NL', format: 'CD', trackCount: 2, label: 'Found Label', catalogNumber: 'FL 1', score: 100 }];
const RELEASE = {
  id: 'rel-1',
  title: 'Found Album',
  artist: 'Found Artist',
  year: 1998,
  label: 'Found Label',
  catalogNumber: 'FL 1',
  media: [{ position: 1, format: 'CD', tracks: [{ position: 1, title: 'First Song', artist: 'Found Artist', lengthSeconds: 25 }, { position: 2, title: 'Second Song', artist: 'Found Artist', lengthSeconds: 25 }] }],
};
const COVERS = {
  results: [{ source: 'Cover Art Archive', thumbUrl: 'https://coverartarchive.org/t.jpg', fullUrl: 'https://coverartarchive.org/f.jpg', width: 1000, height: 1000 }],
  sources: ['Cover Art Archive', 'Deezer'],
};

const held = (id, title) => ({ rpmId: id, sha256: id.repeat(64).slice(0, 64), relativePath: `Manu Chao/Clandestino/${title}.flac`, title, artist: 'Manu Chao', album: 'Clandestino', addedAt: 1, updatedAt: 1, originalSize: 1, tags: { albumArtist: 'Manu Chao', year: 1998, genre: 'Latin', discCount: 1 } });
const LIBRARY = [held('a', 'Clandestino'), held('b', 'Bongo Bong')];

async function open(viewport = { width: 1440, height: 900 }, library = []) {
  const page = await browser.newPage({ viewport });
  const asked = [];
  const sent = [];
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error)));
  const answer = (route, status, body = {}) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route(`${site}/accounts/**`, (route) => {
    const path = new URL(route.request().url()).pathname.replace('/accounts/', '');
    if (path === 'auth/refresh') return answer(route, 200, { accessToken: 'token', expiresIn: 3600 });
    if (path === 'auth/me') return answer(route, 200, { userId: 'user', email: 'a@b.c', displayName: 'A', grSupporter: true, grTester: true });
    return answer(route, 404);
  });
  await page.route(`${site}/signed/**`, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route(`${site}/api/**`, (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/', '');
    asked.push(path + url.search);
    if (path === 'metadata/search') return answer(route, 200, SEARCH);
    if (path === 'metadata/release/rel-1') return answer(route, 200, RELEASE);
    if (path === 'metadata/release/rel-1/cover') return answer(route, 200, { url: 'http://coverartarchive.org/r.jpg' });
    if (path === 'discogs/search') return answer(route, 428, { error: 'No Discogs account is connected' });
    if (path === 'artwork/sources') return answer(route, 200, COVERS.sources);
    if (path === 'artwork/search') return answer(route, 200, COVERS);
    if (path === 'artwork/fetch') return answer(route, 200, { url: `${site}/signed/${encodeURIComponent(route.request().postDataJSON().url)}` });
    if (path === 'identify') {
      sent.push({ path, body: route.request().postDataJSON() });
      const first = sent.filter((call) => call.path === 'identify').length === 1;
      return answer(route, 200, first ? { status: 'matched', source: 'acoustid', track: { title: 'Heard Song', artist: 'Heard Artist', album: 'Heard Album', year: 2001, score: 0.97 } } : { status: 'unknown', source: null, track: null });
    }
    if (path === 'identify-clip') {
      sent.push({ path, body: route.request().postDataJSON() });
      return answer(route, 200, { status: 'matched', source: 'audd', track: { title: 'Clip Song', artist: 'Clip Artist', album: null, year: 0, score: 0.95 } });
    }
    if (path === 'cloud/list') return answer(route, 200, { files: library, nextCursor: null });
    if (path === 'cloud/art') return answer(route, 200, { albumKeys: ['d90d382db82e7ba38c335b59ae3eaf33'] });
    if (path.startsWith('cloud/art/')) return answer(route, 200, { url: `${site}/signed/sleeve.png` });
    return answer(route, 200, { files: [], nextCursor: null });
  });

  await page.goto(site);
  await page.waitForSelector('.rail');

  // An empty library opens on Import by itself.
  if (library.length) await page.click('.rail button:has-text("Import")');
  await page.waitForSelector('text=To rip your CDs and record your vinyl');
  await page.setInputFiles('input[type=file][multiple]', tracks);
  await page.waitForFunction(() => document.querySelectorAll('.row').length === 2 && ![...document.querySelectorAll('.row .state')].some((state) => state.classList.contains('reading')));
  return { page, asked, sent, problems };
}

test('a release is found, laid against the files, and written to them', async () => {
  const { page, asked, problems } = await open();

  await page.click('button:has-text("Tags from release")');
  await page.waitForSelector('text=Search releases');
  await page.fill('[role=dialog] form input >> nth=0', 'Found Album');
  await page.click('[role=dialog] form button[type=submit]');
  await page.waitForSelector('.results >> text=Found Album');
  await page.waitForSelector('text=Discogs: not connected');
  assert.ok(asked.some((path) => path.startsWith('metadata/search?')), 'the rpm database was asked');
  assert.ok(asked.some((path) => path.startsWith('discogs/search?')), 'Discogs was asked');

  assert.ok(await page.isDisabled('[role=dialog] .primary'), 'nothing is chosen yet');
  await page.click('.results li button >> nth=0');
  await page.click('button:text-is("Next")');
  await page.waitForSelector('text=2 of 2 tracks matched');
  await page.click('button:text-is("Apply")');
  await page.waitForFunction(() => document.querySelector('.album')?.textContent === 'Found Album');

  assert.deepEqual(await page.$$eval('.row .title', (rows) => rows.map((row) => row.textContent)), ['First Song', 'Second Song']);
  assert.deepEqual(problems, []);
  await page.close();
});

test('a tag is written from a pattern, with the result shown first', async () => {
  const { page, problems } = await open();

  await page.click('button:text-is("More")');
  await page.click('.menu button:has-text("Tags from tags")');
  await page.selectOption('[role=dialog] select', 'Album');
  await page.fill('[role=dialog] input[list]', 'Pattern {artist}');
  await page.waitForSelector('[role=dialog] td:has-text("Pattern")');
  await page.click('[role=dialog] button:text-is("Apply")');
  await page.waitForFunction(() => document.querySelector('.album')?.textContent.startsWith('Pattern'));
  assert.deepEqual(problems, []);
  await page.close();
});

test('a cover is chosen from disk, and found by name through the API', async () => {
  const { page, asked, problems } = await open();

  await page.click('button.tool:text-is("Tags")');
  await page.setInputFiles('.cover input[type=file]', { name: 'mine.png', mimeType: 'image/png', buffer: PNG });
  await page.waitForSelector('.cover .art img');
  await page.waitForSelector('button:has-text("Remove picture")');

  await page.click('button:has-text("Find cover art")');
  await page.fill('[role=dialog] form input >> nth=1', 'Found Album');
  await page.click('[role=dialog] form button[type=submit]');
  await page.waitForSelector('.covers .cover img');
  await page.click('.covers .cover');
  await page.waitForSelector('[role=dialog]', { state: 'detached' });
  assert.ok(asked.some((path) => path === 'artwork/fetch'), 'the picture came through the API');
  assert.deepEqual(problems, []);
  await page.close();
});

test('a picture that is no picture is refused', async () => {
  const { page } = await open();

  await page.click('button.tool:text-is("Tags")');
  await page.setInputFiles('.cover input[type=file]', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await page.waitForSelector('.cover [role=alert]');
  await page.close();
});

test('tracks are recognised from their audio, and only what the basic layers miss is sent as a clip', async () => {
  const { page, sent, problems } = await open();

  await page.click('button.tool:text-is("Recognise")');
  await page.waitForSelector('text=Identify 2 track(s) from the audio itself.');
  await page.waitForSelector('text=Advanced recognition');
  await page.click('[role=dialog] .primary:text-is("Recognise")');
  await page.waitForSelector('text=2 of 2 recognised', { timeout: 30000 });

  assert.deepEqual(sent.map((call) => call.path), ['identify', 'identify', 'identify-clip']);
  const { fingerprint, rawFingerprint, durationSeconds } = sent[0].body;
  assert.ok(fingerprint.length > 20, 'the compressed form was sent');
  assert.ok(rawFingerprint.length > 20 && rawFingerprint.every(Number.isInteger), 'the sub-fingerprints were sent');
  assert.ok(durationSeconds > 0);

  const clip = Buffer.from(sent[2].body.clipBase64, 'base64');
  assert.equal(clip.subarray(4, 8).toString(), 'ftyp', 'the clip is a real MP4 file');
  assert.ok(clip.length > 1000);

  await page.waitForSelector('[role=dialog] .source:has-text("AcoustID")');
  await page.waitForSelector('[role=dialog] .source:has-text("97% sure")');
  await page.waitForSelector('[role=dialog] .source:has-text("AudD")');
  await page.waitForSelector('text=AudD: 1 sent, 1 identified.');

  await page.click('button:text-is("Edit all 2")');
  await page.waitForSelector('[role=dialog]', { state: 'detached' });
  assert.deepEqual((await page.$$eval('.row .title', (rows) => rows.map((row) => row.textContent))).sort(), ['Clip Song', 'Heard Song']);
  await page.waitForSelector('.tool.on:text-is("Tags")');
  assert.deepEqual(problems, []);
  await page.close();
});

test('Recognise is one click from the same list again, and shows the new names', async () => {
  const { page } = await open();

  await page.click('button.tool:text-is("Recognise")');
  await page.click('[role=dialog] .primary:text-is("Recognise")');
  await page.waitForSelector('text=2 of 2 recognised', { timeout: 30000 });
  await page.click('[role=dialog] .primary:text-is("Recognise more")');
  await page.waitForSelector('[role=dialog] td:has-text("Heard Artist · Heard Song")');
  await page.close();
});

test('on a phone Recognise is a page of its own, and nothing runs off the side', async () => {
  const { page } = await open({ width: 1440, height: 900 });
  await page.setViewportSize({ width: 390, height: 844 });

  await page.click('button.tool:text-is("Recognise")');
  await page.click('[role=dialog] .primary:text-is("Recognise")');
  await page.waitForSelector('text=2 of 2 recognised', { timeout: 30000 });
  const sizes = await page.$eval('[role=dialog]', (element) => ({ width: element.getBoundingClientRect().width, scroll: element.querySelector('.body').scrollWidth, client: element.querySelector('.body').clientWidth }));
  assert.equal(sizes.width, 390);
  assert.ok(sizes.scroll <= sizes.client, 'the window scrolls sideways');
  await page.close();
});

test('what was done to the queue is still there on the next visit', async () => {
  const { page } = await open();

  await page.click('button.tool:text-is("Recognise")');
  await page.click('[role=dialog] .primary:text-is("Recognise")');
  await page.waitForSelector('text=2 of 2 recognised', { timeout: 30000 });
  await page.click('[role=dialog] button:text-is("Close")');
  await page.waitForTimeout(800);

  await page.reload();
  await page.waitForSelector('text=2 track(s) from your last visit are waiting.');
  await page.setInputFiles('input[type=file][multiple]', tracks);
  await page.waitForSelector('.row .title:text-is("Heard Song")');
  await page.waitForSelector('.row .title:text-is("Clip Song")');
  await page.waitForSelector('text=from your last visit', { state: 'detached' });
  await page.close();
});

test('files take their album and cover from a record in the collection', async () => {
  const { page, problems } = await open(undefined, LIBRARY);

  await page.click('button.tool:text-is("Tags")');
  await page.click('button:text-is("From an album in your collection…")');
  await page.fill('[role=dialog] input', 'clandest');
  await page.click('[role=dialog] button:has-text("Manu Chao")');
  await page.waitForFunction(() => document.querySelector('.album')?.textContent === 'Clandestino');
  await page.waitForSelector('.cover img');
  assert.equal(await page.inputValue('label:has-text("Year") input'), '1998');
  assert.deepEqual(problems, []);
  await page.close();
});

test('a disc label is found by name or chosen from disk, beside the cover', async () => {
  const { page, asked } = await open();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

  await page.click('button.tool:text-is("Tags")');
  await page.setInputFiles('.cover:has-text("Disc") input[type=file]', { name: 'disc.png', mimeType: 'image/png', buffer: png });
  await page.waitForSelector('.cover:has-text("Disc") img');
  await page.click('.cover:has-text("Disc") button:text-is("Remove picture")');
  await page.waitForSelector('.cover:has-text("Disc") img', { state: 'detached' });

  await page.click('button:text-is("Find disc art")');
  await page.fill('[role=dialog] form input >> nth=0', 'Found Artist');
  await page.click('[role=dialog] form button[type=submit]');
  await page.waitForSelector('[role=dialog] .cover');
  assert.ok(asked.includes('artwork/sources?kind=disc'));
  assert.ok(asked.some((path) => path.startsWith('artwork/search?') && path.includes('kind=disc')));
  await page.click('[role=dialog] .cover');
  await page.waitForSelector('.cover:has-text("Disc") img');
  await page.close();
});

test('a file that looks like a whole album says the desktop app can split it', async () => {
  const { page } = await open();
  const TIP = 'This looks like a whole album in one file. The desktop app can split it into tracks.';

  assert.equal(await page.locator('.split').count(), 0);
  await page.setInputFiles('input[type=file][multiple]', {
    name: 'album.cue',
    mimeType: 'application/x-cue',
    buffer: Buffer.from('FILE "flac-1.flac" WAVE'),
  });
  await page.waitForSelector('.split');
  assert.equal(await page.getAttribute('.split', 'title'), TIP);
  assert.equal(await page.locator('.split').count(), 1);

  await page.click('.split');
  await page.waitForSelector(`[role=status]:has-text("${TIP}")`);
  await page.close();
});

test('a queue can be let go of', async () => {
  const { page } = await open();
  await page.waitForTimeout(800);

  await page.reload();
  await page.click('button:text-is("Forget them")');
  await page.waitForSelector('text=from your last visit', { state: 'detached' });
  await page.waitForTimeout(800);
  await page.reload();
  await page.waitForSelector('.rail');
  await page.waitForTimeout(500);
  assert.equal(await page.locator('text=from your last visit').count(), 0);
  await page.close();
});

test('a folder is opened again with one press where the browser allows it', async () => {
  const { page } = await open();

  // A folder of the browser's own private storage stands in for one on disk: a real handle, and no dialog.
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const folder = await root.getDirectoryHandle('Album', { create: true });
    const file = await folder.getFileHandle('flac-3.flac', { create: true });
    const writer = await file.createWritable();
    await writer.write(await (await fetch('/proof/tracks/flac-3.flac')).blob());
    await writer.close();
  });
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('Album');
  });

  await page.click('button.tool:text-is("Remove from queue")');
  await page.waitForTimeout(800);
  await page.reload();
  await page.click('button:text-is("Add a folder")');
  await page.waitForFunction(() => document.querySelectorAll('.row').length === 1);
  await page.click('button.tool:text-is("Recognise")');
  await page.click('[role=dialog] .primary:text-is("Recognise")');
  await page.waitForSelector('[role=dialog] .primary:text-is("Recognise more")', { timeout: 30000 });
  await page.click('[role=dialog] button:text-is("Close")');
  await page.waitForTimeout(800);

  await page.reload();
  await page.click('button:text-is("Open the folder again")');
  await page.waitForFunction(() => document.querySelectorAll('.row').length === 1);
  await page.waitForSelector('text=from your last visit', { state: 'detached' });
  assert.ok((await page.$eval('.row .title', (title) => title.textContent)).length > 0);
  await page.close();
});

test('duplicates, columns and disc numbers are on the toolbar', async () => {
  const { page } = await open();

  await page.click('button:text-is("More")');
  await page.click('.menu button:text-is("Columns")');
  await page.check('.menu label:has-text("Genre")');
  await page.waitForSelector('.row .extra', { state: 'attached' });
  await page.click('button:text-is("More")');
  await page.click('.menu button:text-is("Number discs from folders")');
  await page.waitForSelector('text=No folder here says which disc it is');
  await page.close();
});

test('on a phone the lookup is a page of its own', async () => {
  const { page } = await open({ width: 1440, height: 900 });
  await page.setViewportSize({ width: 390, height: 844 });

  await page.click('button:has-text("Tags from release")');
  await page.waitForSelector('text=Search releases');
  const box = await page.$eval('[role=dialog]', (element) => element.getBoundingClientRect().toJSON());
  assert.equal(box.width, 390);
  await page.close();
});
