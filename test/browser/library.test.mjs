// The views of the collection, with rpm's API answered here: Home, Artists, Genres, the album list, the
// data table, search and playlists.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, test } from 'node:test';

import { chromium } from 'playwright';

const port = 8129;
const site = `http://localhost:${port}`;
const root = new URL('../..', import.meta.url).pathname;
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore', detached: true });
await new Promise((done) => setTimeout(done, 2500));
after(() => process.kill(-server.pid));

const browser = await chromium.launch();
after(() => browser.close());

const track = (id, title, artist, album, genre, year, number, albumArtist = artist) => ({
  rpmId: id,
  sha256: id,
  relativePath: `${albumArtist}/${album}/${number} ${title}.flac`,
  title,
  artist,
  album,
  addedAt: 1000 + number,
  tags: { genre, year, trackNumber: number, durationSeconds: 200, albumArtist },
});

const FILES = [
  track('a1', 'Alpha', 'Portishead', 'Dummy', 'Trip Hop', 1994, 1),
  track('a2', 'Beta', 'Portishead', 'Dummy', 'Trip Hop', 1994, 2),
  track('b1', 'Gamma', 'Radiohead', 'Kid A', 'Rock', 2000, 1),
  track('c1', 'Delta', 'Calvin Harris feat. Ellie Goulding', '18 Months', 'House', 2012, 1, 'Calvin Harris'),
  track('d1', 'Epsilon', 'Ellie Goulding', 'Halcyon', 'Pop', 2012, 1),
];

const PHOTO = 'data:image/gif;base64,R0lGODlhAQABAIAAAMyZZgAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==';
const LRC = ['[00:00.20]The first line', '[00:01.00]The second line', '[00:02.00]The third line', '[00:03.00]The fourth line', '[00:04.00]The fifth line', '[00:05.00]The sixth line'].join('\n');

const dossier = {
  artist: { name: 'Portishead', id: 'p', kind: 'Group', area: 'Bristol', began: '1991', members: [{ name: 'Beth Gibbons' }, { name: 'Geoff Barrow' }, { name: 'Adrian Utley' }], links: [{ url: 'https://portishead.co.uk/', relation: 'official homepage' }, { url: 'https://www.facebook.com/portishead' }, { url: 'https://www.instagram.com/portishead' }] },
  album: { title: 'Dummy', primaryType: 'Album', firstReleased: '1994-08-22', genres: ['Trip Hop', 'Electronic'], links: [{ url: 'https://www.discogs.com/master/4009' }] },
  artistArticle: { title: 'Portishead', text: 'Portishead are an English band.\nThey were formed in Bristol.', url: 'https://en.wikipedia.org/wiki/Portishead_(band)', language: 'en' },
  albumArticle: { title: 'Dummy (album)', text: 'Dummy is the debut album.', url: 'https://en.wikipedia.org/wiki/Dummy_(album)', language: 'en' },
};

async function open(viewport = { width: 1440, height: 900 }, words = {}) {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(6000);
  const problems = [];
  const marks = [];
  const pushes = [];
  const sheets = [];
  const asked = [];
  page.on('pageerror', (error) => problems.push(String(error)));
  const playlists = [{ playlistId: 'p1', name: 'Road trip', trackIds: ['a1', 'gone'], folder: [], updatedAt: 5 }];
  const answer = (route, status, body = {}) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route(`${site}/accounts/**`, (route) => {
    const path = new URL(route.request().url()).pathname.replace('/accounts/', '');
    if (path === 'auth/refresh') return answer(route, 200, { accessToken: 'token', expiresIn: 3600 });
    if (path === 'auth/me') return answer(route, 200, { userId: `user-${Math.random()}`, email: 'a@b.c', displayName: 'A', grSupporter: true, grTester: true });
    return answer(route, 404);
  });
  await page.route(`${site}/api/**`, (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/', '');
    const method = route.request().method();
    if (path === 'cloud/list') return answer(route, 200, { files: FILES, nextCursor: null });
    if (path === 'cloud/playlists') return answer(route, 200, { playlists });
    if (path === 'cloud/moodlists') return answer(route, 404);
    if (path === 'cloud/track-plays') return answer(route, 200, { tracks: [] });
    if (path === 'cloud/album-marks') return answer(route, 200, { albums: [] });
    if (path === 'artwork') return answer(route, 200, { cover: null, backgrounds: ['https://pictures.test/photo.jpg'], thumbs: [], logo: null });
    if (path === 'artwork/fetch') return answer(route, 200, { url: PHOTO });
    if (path === 'metadata/dossier') return answer(route, 200, dossier);
    if (path === 'metadata/lyrics') {
      asked.push(path);
      return answer(route, 200, { sheets: [LRC, `${LRC}\n[00:09.00]The other cut`] });
    }
    if (path.startsWith('cloud/lyric-sheet/') && method === 'GET' && words.chosen) return answer(route, 200, { lrc: words.chosen });
    if (path.startsWith('cloud/lyric-sheet/') && method === 'PUT') {
      sheets.push(route.request().postDataJSON().lrc);
      return answer(route, 200, {});
    }
    if (path.startsWith('cloud/lyric-sheet/')) return answer(route, 404);
    if (path === 'metadata/article') return answer(route, 200, { article: { title: `About ${url.searchParams.get('artist') ?? url.searchParams.get('genre')}`, text: 'First paragraph.\nSecond paragraph.', url: 'https://en.wikipedia.org/wiki/X', language: 'en' } });
    if (path.startsWith('cloud/stream/')) return answer(route, 200, { url: `${site}/proof/tracks/flac-1.flac`, kilobits: 0, live: false, expiresInSeconds: 3600 });
    if (path === 'cloud/catalog/tags') {
      const { items } = route.request().postDataJSON();
      pushes.push(items);
      return answer(route, 200, { updated: items.length, rows: [] });
    }
    if (path.startsWith('cloud/track-mark/') || path.startsWith('cloud/album-mark/')) {
      marks.push({ path, ...route.request().postDataJSON() });
      return answer(route, 200, { updatedAt: 1 });
    }
    if (path.startsWith('cloud/playlist/') && method === 'PUT') {
      const body = route.request().postDataJSON();
      const id = path.split('/').pop();
      const held = playlists.find((row) => row.playlistId === id);
      if (held) Object.assign(held, body, { updatedAt: held.updatedAt + 1 });
      else playlists.push({ playlistId: id, folder: [], updatedAt: 1, ...body });
      return answer(route, 200, {});
    }
    if (path.startsWith('cloud/playlist/') && method === 'DELETE') {
      playlists.splice(playlists.findIndex((row) => path.endsWith(row.playlistId)), 1);
      return route.fulfill({ status: 204 });
    }
    return answer(route, 200, {});
  });

  await page.goto(site);
  await page.waitForSelector('.rail');
  await page.waitForSelector('.card');
  return { page, playlists, problems, marks, pushes, sheets, asked };
}

const rail = (page, name) => page.click(`.rail button:has-text("${name}")`);

test('the page names its icons, and each of them is there', async () => {
  const { page } = await open();
  const addresses = await page.$$eval('link[rel~=icon], link[rel=apple-touch-icon], link[rel=manifest]', (rows) => rows.map((row) => row.href));
  assert.equal(addresses.length, 4);
  for (const address of addresses) {
    const answer = await page.request.get(address);
    assert.equal(answer.status(), 200, address);
    assert.ok(!(await answer.text()).startsWith('<!doctype'), `${address} is the app's own page, not an icon`);
  }
  const manifest = await (await page.request.get(`${site}/manifest.webmanifest`)).json();
  for (const icon of manifest.icons) assert.equal((await page.request.get(`${site}${icon.src}`)).status(), 200);
  await page.close();
});

test('Artists files each act once, a guest included, and opens a page', async () => {
  const { page, problems } = await open();

  await rail(page, 'Artists');
  await page.waitForSelector('.tile strong');
  const names = await page.$$eval('.tile strong', (rows) => rows.map((row) => row.textContent));
  assert.deepEqual(names, ['Calvin Harris', 'Ellie Goulding', 'Portishead', 'Radiohead']);

  await page.click('strong:text-is("Ellie Goulding")');
  await page.waitForSelector('h3:has-text("Appears on")');
  await page.waitForSelector('strong:text-is("About Ellie Goulding")');
  await page.waitForSelector('.song:has-text("Delta")');
  await page.waitForSelector('.song:has-text("Epsilon")');

  await page.click('button[aria-label="Back to artists"]');
  await page.fill('input[type=search]', 'radio');
  await page.waitForFunction(() => document.querySelectorAll('.tile strong').length === 1);
  assert.deepEqual(problems, []);
  await page.close();
});

test('Genres files records on the shelves the other apps use', async () => {
  const { page, problems } = await open();

  await rail(page, 'Genres');
  await page.waitForSelector('.card svg[aria-label="Rock"]');
  await page.waitForSelector('.card svg[aria-label="House"]');
  await page.click('.card:has(svg[aria-label="Rock"])');
  await page.waitForSelector('h3:has-text("2000")');
  await page.waitForSelector('strong:text-is("About Rock")');
  assert.deepEqual(problems, []);
  await page.close();
});

test('The album list and the data table show the same collection', async () => {
  const { page, problems } = await open();

  await rail(page, 'Albums');
  await page.click('button[aria-label="Album list"]');
  await page.waitForSelector('article:has-text("Kid A")');

  await page.click('button[aria-label="Data table"]');
  await page.waitForSelector('.row:has-text("Gamma")');
  assert.equal((await page.$$('.table .row')).length, FILES.length);

  await page.click('.head button:text-is("Year")');
  await page.waitForFunction(() => document.querySelector('.table .row .title')?.textContent === 'Alpha');
  await page.click('.head button:text-is("Year")');
  await page.waitForFunction(() => ['Delta', 'Epsilon'].includes(document.querySelector('.table .row .title')?.textContent));

  await page.fill('input[type=search]', 'gamm');
  await page.waitForFunction(() => document.querySelectorAll('.table .row').length === 1);
  assert.deepEqual(problems, []);
  await page.close();
});

test('Playlists says what is in the desktop app, and can be made and filled here', async () => {
  const { page, playlists, problems } = await open();

  await rail(page, 'Playlists');
  await page.waitForSelector('text=Auto playlists, mood lists and smart playlists');
  await page.waitForSelector('strong:text-is("Road trip")');

  await page.click('button:text-is("New playlist")');
  await page.fill('[role=dialog] form input', 'Fresh');
  await page.click('[role=dialog] button[type=submit]');
  await page.waitForSelector('strong:text-is("Fresh")');
  assert.equal(playlists.length, 2);

  await page.click('strong:text-is("Road trip")');
  await page.waitForSelector('text=1 track isn');
  await page.waitForSelector('.song:has-text("Alpha")');
  await page.click('button[aria-label="Remove from playlist"]');
  await page.waitForFunction(() => document.querySelectorAll('.song').length === 0);
  assert.deepEqual(playlists[0].trackIds, ['gone']);

  await page.click('button[aria-label="Delete"]');
  await page.waitForSelector('strong:text-is("Fresh")');
  assert.equal(playlists.length, 1);

  await rail(page, 'Albums');
  await page.waitForSelector('.card');
  await page.click('.views .slot-key >> nth=0');
  await page.click('.card >> nth=0', { button: 'right' });
  await page.hover('[role=menuitem]:has-text("Add to playlist")');
  await page.click('[role=menuitem]:has-text("Fresh")');
  await page.waitForFunction(() => !document.querySelector('[role=menu]'));
  await page.waitForFunction((lists) => lists, playlists.length);
  await page.waitForTimeout(200);
  assert.ok(playlists[0].trackIds.length > 0);
  assert.deepEqual(problems, []);
  await page.close();
});

test('a playlist is reordered by dragging, and a song added elsewhere stays', async () => {
  const { page, playlists, problems } = await open();
  playlists[0].trackIds = ['a1', 'a2', 'b1'];

  await rail(page, 'Playlists');
  await page.click('strong:text-is("Road trip")');
  await page.waitForFunction(() => document.querySelectorAll('.song').length === 3);

  playlists[0].trackIds = ['a1', 'a2', 'b1', 'c1'];
  playlists[0].updatedAt += 1;

  const first = await (await page.$('li:has(.song:has-text("Alpha"))')).boundingBox();
  const last = await (await page.$('li:has(.song:has-text("Gamma"))')).boundingBox();
  await page.mouse.move(first.x + 200, first.y + 20);
  await page.mouse.down();
  await page.mouse.move(first.x + 200, first.y + 40, { steps: 3 });
  await page.waitForSelector('li.lifted');
  await page.mouse.move(last.x + 200, last.y + last.height - 4, { steps: 5 });
  await page.mouse.up();

  await page.waitForFunction(() => !document.querySelector('li.lifted'));
  await page.waitForFunction(() => document.querySelector('.song .title')?.textContent === 'Alpha' || document.querySelector('.song .title')?.textContent === 'Beta');
  await page.waitForTimeout(300);
  assert.deepEqual(playlists[0].trackIds, ['a1', 'a2', 'b1', 'c1'], 'the store moved on, so its order stands, and the song added there stays');
  assert.deepEqual(problems, []);
  await page.close();
});

test('a reorder on a list nobody else changed is kept, and no song starts', async () => {
  const { page, playlists, problems } = await open();
  playlists[0].trackIds = ['a1', 'a2', 'b1'];

  await rail(page, 'Playlists');
  await page.click('strong:text-is("Road trip")');
  await page.waitForFunction(() => document.querySelectorAll('.song').length === 3);

  const first = await (await page.$('li:has(.song:has-text("Alpha"))')).boundingBox();
  const last = await (await page.$('li:has(.song:has-text("Gamma"))')).boundingBox();
  await page.mouse.move(first.x + 200, first.y + 20);
  await page.mouse.down();
  await page.mouse.move(last.x + 200, last.y + last.height - 4, { steps: 8 });
  await page.mouse.up();

  await page.waitForFunction(() => document.querySelector('.song .title')?.textContent === 'Beta');
  await page.waitForTimeout(300);
  assert.deepEqual(playlists[0].trackIds, ['a2', 'b1', 'a1']);
  assert.equal(await page.$('.band.open'), null);
  assert.deepEqual(problems, []);
  await page.close();
});

test('a playlist is filed in a folder, and the wall goes in and back out of it', async () => {
  const { page, playlists, problems } = await open();

  await rail(page, 'Playlists');
  await page.click('strong:text-is("Road trip")');
  await page.click('button[aria-label="Folder"]');
  await page.fill('[role=dialog] form input', 'Moods / Slow');
  await page.click('[role=dialog] button[type=submit]');
  await page.waitForFunction(() => !document.querySelector('[role=dialog]'));
  await page.waitForTimeout(200);
  assert.deepEqual(playlists[0].folder, ['Moods', 'Slow']);

  await page.click('button[aria-label="Back"]');
  await page.click('.tile strong:text-is("Moods")');
  await page.click('.tile strong:text-is("Slow")');
  await page.waitForSelector('.tile strong:text-is("Road trip")');
  await page.click('.trail button:text-is("Playlists")');
  await page.waitForSelector('.tile strong:text-is("Now playing")');

  await page.click('button[aria-label="List view"]');
  assert.equal(await page.$('.tree button:has-text("Road trip")'), null);
  await page.click('.tree button:has-text("Moods")');
  await page.click('.tree button:has-text("Slow")');
  await page.waitForSelector('.tree button:has-text("Road trip")');
  assert.deepEqual(problems, []);
  await page.close();
});

test('On a phone the views are under one tab, with a picker', async () => {
  const { page, problems } = await open();
  await page.setViewportSize({ width: 390, height: 844 });

  await page.click('nav.tabs button:has-text("Albums")');
  await page.click('.picks button:has-text("Artists")');
  await page.waitForSelector('strong:text-is("Portishead")');
  await page.click('.picks button:has-text("Playlists")');
  await page.waitForSelector('strong:text-is("Road trip")');
  assert.deepEqual(problems, []);
  await page.close();
});

test('a song is marked a favourite, and is in the list of favourites', async () => {
  const { page, marks, problems } = await open();

  await page.click('.card >> nth=0');
  await page.waitForSelector('.drawer .track');
  await page.hover('.drawer .track >> nth=0');
  await page.click('.drawer .track .heart >> nth=0');
  await page.waitForSelector('.drawer .track .heart.on');
  assert.equal(marks[0].favorite, true);
  assert.ok(marks[0].path.startsWith('cloud/track-mark/'));
  assert.ok(marks[0].favoritedAt > 600_000_000_000_000_000, 'the stamp is in ticks');

  await page.click('.drawer .track .heart.on');
  await page.waitForFunction(() => !document.querySelector('.drawer .track .heart.on'));
  assert.deepEqual([marks[1].favorite, marks[1].favoritedAt], [false, 0]);

  await page.click('.drawer .track .heart >> nth=0');
  await rail(page, 'Playlists');
  await page.click('button:has-text("Favourite tracks")');
  await page.waitForSelector('.detail .title');
  assert.deepEqual(problems, []);
  await page.close();
});

test('a record is marked a favourite, and the wall can show only those', async () => {
  const { page, marks } = await open();

  await rail(page, 'Albums');
  await page.waitForSelector('.card');
  const all = await page.locator('.card').count();
  await page.click('.card >> nth=0');
  await page.click('.drawer .album-heart');
  await page.waitForSelector('.drawer .album-heart.on');
  assert.ok(marks[0].path.startsWith('cloud/album-mark/'));

  await page.click('button[aria-label="Favourite albums only"]');
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 1);
  await page.click('button[aria-label="Favourite albums only"]');
  await page.waitForFunction((count) => document.querySelectorAll('.card').length === count, all);
  await page.close();
});

test('a record gets stars, kept in this browser, and pressing them again takes them off', async () => {
  const { page } = await open();

  await page.click('.card >> nth=0', { button: 'right' });
  await page.click('[role=menuitem]:has-text("Album page")');
  await page.click('[aria-label="4 stars"]');
  await page.waitForSelector('[aria-label="4 stars"][aria-pressed=true]');
  assert.equal(await page.locator('.stars button.on').count(), 4);
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('rpm.albumRating.')).length), 1);

  await page.click('[aria-label="4 stars"]');
  await page.waitForFunction(() => !document.querySelector('.stars button.on'));
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('rpm.albumRating.')).length), 0);
  await page.close();
});

test('the tags of a track in the cloud are changed, and only what changed is sent', async () => {
  const { page, pushes, problems } = await open();

  await page.click('.card >> nth=0');
  await page.waitForSelector('.drawer .track');
  await page.click('.drawer .track >> nth=0', { button: 'right' });
  await page.click('[role=menuitem]:has-text("Edit track")');
  const title = page.locator('label:has-text("Title") input');
  await title.fill('Renamed');
  await page.click('button:text-is("Save")');
  await page.waitForFunction(() => !document.querySelector('form .field'));
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].length, 1);
  assert.equal(pushes[0][0].title, 'Renamed');
  assert.equal(pushes[0][0].artist, undefined);
  assert.deepEqual(problems, []);
  await page.close();
});

test('a record is edited as a whole, for every track on it', async () => {
  const { page, pushes } = await open();

  await rail(page, 'Albums');
  await page.locator('.card', { hasText: 'Dummy' }).click();
  await page.click('.drawer .mini-key >> nth=2');
  await page.click('[role=menuitem]:has-text("Edit album")');
  await page.locator('label:has-text("Genre") input').fill('Bristol');
  await page.click('button:text-is("Save")');
  await page.waitForFunction(() => !document.querySelector('form .field'));
  assert.deepEqual(pushes[0].map((item) => item.tags?.genre), ['Bristol', 'Bristol']);
  await page.close();
});

test('the Home key is on the deck beside the pane key, and not on the rail', async () => {
  const { page } = await open();

  assert.equal(await page.locator('.rail button:has-text("Home")').count(), 0);

  // A small collection lands on the records.
  assert.equal(await page.getAttribute('.deck button[aria-label="Home"]', 'aria-pressed'), 'false');
  await page.click('.deck button[aria-label="Home"]');
  await page.waitForFunction(() => document.querySelector('.deck button[aria-label="Home"]').getAttribute('aria-pressed') === 'true');
  await page.waitForSelector('text=albums to go');
  await page.close();
});

test('the left pane glides open and closed, and its content arrives after the move', async () => {
  const { page } = await open();
  const width = () => page.$eval('.pane.left', (pane) => pane.getBoundingClientRect().width);

  // A computer opens with Track info out.
  assert.equal(await width(), 520);
  await page.click('.deck .pane-pill');
  await page.waitForFunction(() => !document.querySelector('.pane.left .view'));
  await page.waitForTimeout(120);
  const closed = await width();
  assert.equal(closed, 84);

  await page.click('.deck .pane-pill');
  await page.waitForTimeout(200);
  const moving = await width();
  assert.ok(moving > closed, 'the pane has started to move');
  await page.waitForFunction(() => document.querySelector('.pane.left .view.clear'));
  const open_ = await width();
  assert.ok(open_ > moving || open_ > 400, 'the pane is open');
  await page.close();
});

test('the band above the panes opens when a record starts, and closes when it stops', async () => {
  const { page } = await open();
  const height = () => page.$eval('.band', (band) => band.getBoundingClientRect().height);

  assert.equal(await height(), 78);
  await page.click('.card >> nth=0');
  await page.waitForSelector('.drawer .track');
  await page.click('.drawer .mini-key >> nth=0');
  await page.waitForFunction(() => document.querySelector('.band').classList.contains('open'));
  await page.waitForTimeout(600);
  assert.ok((await height()) > 150, 'the band has opened');
  await page.click('.deck button[title="Stop"]');
  await page.waitForFunction(() => !document.querySelector('.band').classList.contains('open'));
  await page.waitForTimeout(600);
  assert.equal(await height(), 78);
  await page.close();
});

test('Track info says the record, the words and what is known, and the words follow the singer', async () => {
  const { page, problems, asked } = await open();

  await page.waitForSelector('text=Nothing playing right now');
  assert.deepEqual(asked, []);

  await page.click('.card:has-text("Dummy")');
  await page.click('.drawer .mini-key >> nth=0');

  await page.waitForSelector('.sheet .title h3:has-text("Alpha")');
  await page.waitForSelector('.sheet strong:text-is("Portishead")');
  await page.waitForSelector('.sheet strong:text-is("Dummy")');
  await page.waitForSelector('.chips span:text-is("Trip Hop")');
  await page.waitForSelector('.elsewhere a:has-text("Discogs")');
  assert.equal(await page.$('.sheet .prose:has-text("Bristol")'), null);

  await page.click('button:has-text("Show more")');
  await page.waitForSelector('.sheet .prose:has-text("Bristol")');

  assert.deepEqual(await page.$$eval('.members small', (rows) => rows.map((row) => row.textContent)), ['Beth Gibbons', 'Geoff Barrow', 'Adrian Utley']);
  assert.deepEqual(await page.$$eval('.elsewhere b', (rows) => rows.map((row) => row.textContent)), ['Official site', 'Discogs', 'Facebook', 'Instagram']);

  await page.waitForSelector('.well p.sung');
  assert.ok(asked.includes('metadata/lyrics'));
  await page.waitForFunction(() => document.querySelector('.well p.sung')?.textContent !== 'The first line', undefined, { timeout: 5000 });
  assert.deepEqual(problems, []);
  await page.close();
});

test('the owner\'s chosen words come before LRCLIB, and another version can be tried', async () => {
  const { page, problems, asked, sheets } = await open(undefined, { chosen: '[00:00.10]Chosen on another device' });

  await page.click('.card:has-text("Dummy")');
  await page.click('.drawer .mini-key >> nth=0');

  await page.waitForSelector('.well p:has-text("Chosen on another device")');
  assert.deepEqual(asked, []);

  await page.click('button[aria-label="Try another version"]');
  await page.waitForSelector('.well p:has-text("The first line")');
  assert.equal(sheets.length, 1);
  assert.deepEqual(problems, []);
  await page.close();
});

test('on a phone the words stand in place of the sleeve, and Track info opens from the player', async () => {
  const { page, problems } = await open();
  await page.setViewportSize({ width: 390, height: 844 });

  await page.click('.card:has-text("Dummy")');
  await page.click('.page .mini-key >> nth=0');
  await page.click('.page .key >> nth=0');
  await page.click('.mini .open');
  await page.waitForSelector('.player');

  await page.waitForSelector('.extras button[aria-label="Lyrics"]:not([disabled])');
  await page.click('.extras button[aria-label="Lyrics"]');
  await page.waitForSelector('.lyrics .row.sung');
  await page.click('.extras button[aria-label="Track info"]');
  await page.waitForSelector('.info .title h3:has-text("Alpha")');
  assert.deepEqual(problems, []);
  await page.close();
});
