// The Feed: everyone's posts and reviews, a person's page, a thread, the notifications and the edit page, against a
// mock of the community routes.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, test } from 'node:test';

import { chromium } from 'playwright';

import { serve } from './fixture.mjs';

const port = 8141;
const site = `http://localhost:${port}`;
const root = new URL('../..', import.meta.url).pathname;
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore', detached: true });
await new Promise((done) => setTimeout(done, 2500));
after(() => process.kill(-server.pid));

const browser = await chromium.launch();
after(() => browser.close());

// Where the screenshots go, for a person to look at. Not checked.
const shots = process.env.FEED_SHOTS;

const now = Date.now();
const json = (route, status, body = {}) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const picture = (colour) => `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="${colour}"/></svg>`;

const post = (over) => ({
  ownerId: 'ann',
  postId: 'p1',
  authorName: 'Ann Listener',
  hasAvatar: true,
  body: 'Found my old copy of this one in the attic. Still sounds great.',
  song: { artist: 'Radiohead', title: 'Everything in Its Right Place', album: 'Kid A' },
  createdAt: now - 5 * 60_000,
  ups: 3,
  downs: 0,
  score: 3,
  myVote: 0,
  replyCount: 2,
  authorSupporter: true,
  ...over,
});

const LONG_REVIEW =
  'A record that rewards patience. The first side drifts and the second side pulls everything together, and by the last track you understand why the opening was so quiet. '.repeat(4);

const review = (over) => ({
  albumId: 'kid-a',
  userId: 'bob',
  authorName: 'Bob',
  hasAvatar: false,
  rating: 9,
  body: LONG_REVIEW,
  createdAt: now - 3 * 3600_000,
  updatedAt: now,
  ups: 1,
  downs: 1,
  score: 0,
  myVote: 0,
  albumArtist: 'Radiohead',
  albumTitle: 'Kid A',
  albumYear: 2000,
  ...over,
});

const EVERYONE = [
  { kind: 'post', createdAt: now - 5 * 60_000, post: post() },
  { kind: 'review', createdAt: now - 3 * 3600_000, review: review() },
  { kind: 'review', createdAt: now - 2 * 86_400_000, review: review({ albumId: 'x', userId: 'cy', authorName: 'Cy', albumTitle: 'A Record Nobody Here Owns', albumArtist: 'Someone Else', albumYear: 1971, rating: 6, body: 'Short and good.' }) },
];

const REPLIES = [
  { postId: 'p1', replyId: 'r1', parentId: 'p1', userId: 'bob', authorName: 'Bob', hasAvatar: false, body: 'Which pressing?', createdAt: now - 4 * 60_000, ups: 0, downs: 0, score: 0, myVote: 0 },
  { postId: 'p1', replyId: 'r2', parentId: 'r1', userId: 'ann', authorName: 'Ann Listener', hasAvatar: true, body: 'The first one, 2000.', createdAt: now - 3 * 60_000, ups: 1, downs: 0, score: 1, myVote: 0, authorSupporter: true },
];

async function open(width = 1440) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error)));
  await serve(page, site);

  const sent = [];
  let friendship = 'none';
  let unread = 2;
  // Registered after the fixture, so these answer first, and anything else falls through to it.
  await page.route(`${site}/api/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/', '');
    const method = request.method();
    if (method !== 'GET') sent.push(`${method} ${path} ${request.postData() ?? ''}`);
    if (path === 'feed') return json(route, 200, { items: EVERYONE, next: null });
    if (path === 'profiles/ann') return json(route, 200, { userId: 'ann', displayName: 'Ann Listener', hasAvatar: true, avatarUpdatedAt: 3, createdAt: Date.UTC(2025, 2, 1), supporter: true, hasBanner: true, bannerUpdatedAt: 4, listening: { artist: 'Radiohead', title: 'Idioteque', album: 'Kid A', at: now }, counts: { albums: 1610, tracks: 23329 }, friendship, badge: 'rock', badgeColour: '#2563EB', pageGround: 'backdrop:vinyl' });
    if (path === 'profiles/screens' || (path === 'profile' && method === 'GET'))
      return json(route, 200, { userId: 'screens', displayName: 'A Listener', hasAvatar: true, avatarUpdatedAt: 7, createdAt: Date.UTC(2024, 9, 1), friendship: 'self', badges: ['first-spin'], badge: '', pageGround: 'color:#0B1E4A' });
    if (path === 'profiles/ann/feed') return json(route, 200, { items: [EVERYONE[0], { kind: 'review', createdAt: now, review: review({ userId: 'ann', authorName: 'Ann Listener' }) }], next: null });
    if (path === 'profiles/screens/feed') return json(route, 200, { items: [], next: null });
    if (path.endsWith('/avatar')) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: picture('#5a2a0c') });
    if (path.endsWith('/banner')) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: picture('#0e4b4f') });
    if (path === 'profiles/ann/posts/p1/vote') return json(route, 200, post({ ups: 4, score: 4, myVote: 1 }));
    if (path === 'profiles/ann/posts/p1/replies' && method === 'GET') return json(route, 200, { items: REPLIES });
    if (path === 'profiles/ann/posts/p1/replies') return json(route, 200, { postId: 'p1', replyId: 'r3', parentId: 'p1', userId: 'screens', authorName: 'A Listener', hasAvatar: true, body: JSON.parse(request.postData()).body, createdAt: now });
    if (path === 'friends/ann') {
      friendship = 'requested';
      return json(route, 200, {});
    }
    if (path === 'notifications/unread') return json(route, 200, { unread });
    if (path === 'notifications/read') {
      unread = 0;
      return json(route, 200, {});
    }
    if (path === 'notifications')
      return json(route, 200, {
        items: [
          { id: 'n2', kind: 'reply', fromUserId: 'bob', fromName: 'Bob', fromHasAvatar: false, ownerId: 'ann', postId: 'p1', createdAt: now - 60_000, read: false },
          { id: 'n1', kind: 'friendRequest', fromUserId: 'cy', fromName: 'Cy', fromHasAvatar: false, createdAt: now - 3600_000, read: true },
        ],
        unread,
        next: null,
      });
    if (path === 'artwork/search') return json(route, 200, { results: [{ thumbUrl: 'https://elsewhere.test/cover.jpg', fullUrl: '' }] });
    return route.fallback();
  });

  await page.goto(site);
  await page.waitForSelector('.rail, .tabs');
  await page.waitForSelector('#opening', { state: 'detached' });
  return { page, problems, sent, close: () => context.close() };
}

async function feedPane(page) {
  await page.click('.rail button:has-text("Feed")');
  await page.waitForSelector('.feed .card');
}

// After the pane's fade and the pictures have come.
async function shot(page, name) {
  if (!shots) return;
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${shots}/${name}.png` });
}

test('the Feed shows everyone posts and reviews, and a vote redraws the counts', async () => {
  const { page, problems, sent, close } = await open();
  await feedPane(page);
  assert.equal(await page.textContent('.feed .heading'), 'Feed');
  assert.match(await page.textContent('.feed .card >> nth=0'), /Found my old copy/);
  assert.match(await page.textContent('.feed .card >> nth=0'), /Everything in Its Right Place by Radiohead/);
  assert.match(await page.textContent('.feed .card >> nth=1'), /Kid A/);
  assert.match(await page.textContent('.feed .card >> nth=1'), /Radiohead, 2000/);
  // A record the reader does not own shows the cover the search found.
  await page.waitForSelector('.feed .card >> nth=2 >> .cover img');
  await page.waitForSelector('.round .dot');
  await shot(page, 'feed');

  await page.click('.feed .card >> nth=0 >> .votes button >> nth=0');
  await page.waitForSelector('.feed .card >> nth=0 >> button[aria-pressed="true"]');
  assert.match(await page.textContent('.feed .card >> nth=0 >> button[aria-pressed="true"]'), /4/);
  assert.ok(sent.some((line) => line.startsWith('POST profiles/ann/posts/p1/vote {"value":1}')));
  assert.deepEqual(problems, []);
  await close();
});

test('a review opens in full, and Open album opens the record that is in the collection', async () => {
  const { page, problems, close } = await open();
  await feedPane(page);
  await page.click('.feed .card >> nth=1 >> text=Read full review');
  await page.waitForSelector('.feed .full');
  assert.match(await page.textContent('.feed .full'), /understand why the opening was so quiet/);
  await shot(page, 'review');
  await page.click('.feed button:has-text("Open album")');
  await page.waitForSelector('.feed .full', { state: 'detached' });
  await page.waitForSelector('.sheet');
  assert.deepEqual(problems, []);
  await close();
});

test('a name opens the person page with its banner, badge and ground, and Add friend asks', async () => {
  const { page, problems, sent, close } = await open();
  await feedPane(page);
  await page.click('.feed .card >> nth=0 >> button:has-text("Ann Listener")');
  await page.waitForSelector('.feed .top .name');
  assert.equal(await page.textContent('.feed .heading'), 'Profile');
  assert.match(await page.textContent('.feed .top'), /1,610 albums, 23,329 tracks/);
  assert.match(await page.textContent('.feed .top'), /Idioteque by Radiohead/);
  await page.waitForSelector('.feed .banner img');
  await page.waitForSelector('.feed .ground img');
  await shot(page, 'person');

  await page.click('.feed button:has-text("Add friend")');
  await page.waitForSelector('.feed button:has-text("Request sent")');
  assert.ok(sent.includes('POST friends/ann '));

  await page.click('.feed button[aria-label="Close"]');
  await page.waitForSelector('.feed .heading:has-text("Feed")');
  assert.deepEqual(problems, []);
  await close();
});

test('a post opens its thread, with the replies under their parents and a reply that can be sent', async () => {
  const { page, problems, sent, close } = await open();
  await feedPane(page);
  await page.click('.feed .card >> nth=0 >> .body');
  await page.waitForSelector('.feed .reply >> nth=1');
  const indents = await page.$$eval('.feed .reply', (rows) => rows.map((row) => getComputedStyle(row).marginLeft));
  assert.deepEqual(indents, ['0px', '16px']);
  await shot(page, 'thread');

  await page.fill('.feed .lines > .composer textarea', 'Mine too.');
  await page.click('.feed .lines > .composer button:has-text("Post")');
  await page.waitForSelector('.feed .reply:has-text("Mine too.")');
  assert.ok(sent.some((line) => line.startsWith('POST profiles/ann/posts/p1/replies {"body":"Mine too.","parentId":null}')));
  assert.deepEqual(problems, []);
  await close();
});

test('the profile key opens the reader page, and its menu the notifications and the edit page', async () => {
  const { page, problems, close } = await open();
  await feedPane(page);
  await page.click('.feed button[aria-label="2 unread notifications"]');
  await page.waitForSelector('.feed .composer');
  await page.waitForSelector('.feed .ground');

  await page.click('.feed button[aria-label="Menu"]');
  await page.click('[role=menu] button:has-text("Notifications")');
  await page.waitForSelector('.feed .notice >> nth=1');
  assert.match(await page.textContent('.feed .notice >> nth=0'), /Bob replied to you/);
  await page.waitForSelector('.feed .dot', { state: 'detached' });
  await shot(page, 'notices');

  await page.click('.feed button[aria-label="Close"]');
  await page.click('.feed button[aria-label="Menu"]');
  await page.click('[role=menu] button:has-text("Edit page")');
  await page.waitForSelector('.feed .save');
  await shot(page, 'edit');
  await page.fill('.feed input.field', 'A New Name');
  await page.click('.feed button[aria-label="Close"]');
  await page.waitForSelector('text=Apply your changes?');
  await page.click('button:has-text("Discard")');
  await page.waitForSelector('.feed .save', { state: 'detached' });
  assert.deepEqual(problems, []);
  await close();
});

test('on a phone the Feed is a tab', async () => {
  const { page, problems, close } = await open(390);
  await page.click('.tabs button:has-text("Feed")');
  await page.waitForSelector('.feed .card');
  await shot(page, 'phone');
  assert.deepEqual(problems, []);
  await close();
});
