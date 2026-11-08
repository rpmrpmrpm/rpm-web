// A new person's way in, with the accounts service answered here, so no account is made and no mail
// is sent: the mail's link, sign-up, the code, the empty library, and the way to Import.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, test } from 'node:test';

import { chromium } from 'playwright';

const port = 8127;
const root = new URL('../..', import.meta.url).pathname;
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore', detached: true });
await new Promise((done) => setTimeout(done, 2500));
after(() => process.kill(-server.pid));

const browser = await chromium.launch();
after(() => browser.close());

// One fake service for one page. The account is a tester once a good code has been sent.
async function open(path, { signedIn = false, tester = false, viewport = { width: 1440, height: 900 } } = {}) {
  const page = await browser.newPage({ viewport });
  // The library is empty here, and the setup over an empty library is tested in setup.test.mjs.
  await page.addInitScript(() => localStorage.setItem('rpm-setup-done:new-user', '1'));
  const account = { signedIn, tester, sent: [], redeemed: [] };
  const answer = (route, status, body = {}) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route(`http://localhost:${port}/accounts/**`, (route) => {
    const path = new URL(route.request().url()).pathname.replace('/accounts/', '');
    account.sent.push(path);
    if (path === 'auth/refresh') return account.signedIn ? answer(route, 200, { accessToken: 'token', expiresIn: 3600 }) : answer(route, 401);
    if (path === 'auth/register' || path === 'auth/confirm') return answer(route, 200, { status: 'confirm_required' });
    if (path === 'auth/login') {
      account.signedIn = true;
      return answer(route, 200, { accessToken: 'token', expiresIn: 3600 });
    }
    if (path === 'auth/me') return answer(route, 200, { userId: 'new-user', email: 'a@b.c', displayName: 'A', grSupporter: account.tester, grTester: account.tester });
    if (path === 'auth/beta-code') {
      const { code } = route.request().postDataJSON();
      account.redeemed.push(code);
      if (code !== 'K7QM-2XPD') return answer(route, 400, { code: 'refused' });
      account.tester = true;
      return answer(route, 200, { status: 'tester' });
    }
    return answer(route, 404);
  });
  await page.route(`http://localhost:${port}/api/**`, (route) => answer(route, 200, { files: [], art: {}, nextCursor: null }));

  await page.goto(`http://localhost:${port}${path}`);
  return { page, account };
}

async function signUp(page) {
  await page.fill('input[autocomplete=name]', 'New Person');
  await page.fill('input[type=email]', 'a@b.c');
  await page.fill('input[type=password]', 'a good long password');
  await page.click('button[type=submit]');
  await page.fill('input[autocomplete=one-time-code]', '123456');
  await page.click('button[type=submit]');
}

test('the link in the mail goes from sign-up to an empty library, with nothing to type', async () => {
  const { page, account } = await open('/?invite=K7QM-2XPD');

  await page.waitForSelector('input[autocomplete=name]');
  assert.equal(new URL(page.url()).search, '', 'the code stays on the address');

  await signUp(page);
  await page.waitForSelector('.rail');
  assert.deepEqual(account.redeemed, ['K7QM-2XPD']);

  // A first run on an empty library starts at Import.
  await page.waitForSelector('text=Add files');
  await page.close();
});

test('the same, at phone width', async () => {
  const { page } = await open('/?invite=K7QM-2XPD', { viewport: { width: 390, height: 844 } });

  await page.waitForSelector('input[autocomplete=name]');
  await signUp(page);
  await page.waitForSelector('text=Add files');
  await page.close();
});

test('with no code, sign-up says what is needed, and the app waits for the code', async () => {
  const { page, account } = await open('/');

  await page.click('button:has-text("Create account")');
  await page.waitForSelector('text=closed beta');
  await signUp(page);

  await page.waitForSelector('text=Your code');
  assert.equal(await page.$('.rail'), null);

  await page.fill('input[autocapitalize=characters]', 'WRONGONE');
  await page.click('button[type=submit]');
  await page.waitForSelector('[role=alert]');
  assert.equal(await page.$('.rail'), null);

  await page.fill('input[autocapitalize=characters]', 'K7QM-2XPD');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Add files');
  assert.deepEqual(account.redeemed, ['WRONGONE', 'K7QM-2XPD']);
  await page.close();
});

test('a tester never sees the code screen', async () => {
  const { page, account } = await open('/', { signedIn: true, tester: true });

  await page.waitForSelector('.rail');
  assert.equal(await page.$('text=Your code'), null);
  assert.deepEqual(account.redeemed, []);
  await page.close();
});

test('a code in a tester\'s link is left alone', async () => {
  const { page, account } = await open('/?invite=K7QM-2XPD', { signedIn: true, tester: true });

  await page.waitForSelector('.rail');
  assert.deepEqual(account.redeemed, []);
  await page.close();
});

test('on a computer the deck menu leads to the account and to feedback, and feedback is sent', async () => {
  const { page } = await open('/', { signedIn: true, tester: true });
  const sent = [];
  await page.route(`http://localhost:${port}/api/errors/feedback`, async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.waitForSelector('.rail');
  await page.click('button[title="Open menu"], .deck .side.end button:last-child');
  await page.click('.menu button:has-text("Settings")');
  await page.waitForSelector('[role=dialog] h3:has-text("Profile")');
  await page.click('[role=tab]:has-text("Cloud")');
  await page.waitForSelector('h4:has-text("Cloud storage")');
  await page.keyboard.press('Escape');

  await page.click('.deck .side.end button:last-child');
  await page.click('.menu button:has-text("Send feedback")');
  await page.waitForSelector('[role=dialog] select');
  await page.click('[role=dialog] button[type=submit]');
  await page.waitForSelector('[role=alert]');
  assert.deepEqual(sent, [], 'an empty report went out');

  await page.fill('textarea', 'The queue forgets its place.');
  await page.click('[role=dialog] button[type=submit]');
  await page.waitForSelector('text=Your feedback was sent');
  assert.equal(sent[0].message, 'The queue forgets its place.');
  assert.equal(sent[0].head, 'web');
  assert.equal(sent[0].replyTo, 'a@b.c');
  await page.close();
});

test('on a phone the account has a tab, with a way to sign out', async () => {
  const { page } = await open('/', { signedIn: true, tester: true, viewport: { width: 390, height: 844 } });

  await page.click('nav.tabs button:has-text("Account")');
  await page.waitForSelector('h3:has-text("Profile")');
  await page.waitForSelector('.account a:has-text("Terms of Use")');
  await page.click('.account button:has-text("Sign out") >> nth=0');
  await page.waitForSelector('button:has-text("Create account")');
  await page.close();
});

test('the wordmark and the line under it sit where the desktop has them', async () => {
  const { page } = await open('/', { signedIn: true, tester: true });

  await page.waitForSelector('.rest svg');
  const place = await page.evaluate(() => {
    const box = (selector) => document.querySelector(selector).getBoundingClientRect();
    return { mark: box('.rest svg'), line: box('.tagline'), head: box('.head'), panes: box('.panes') };
  });
  assert.deepEqual([place.mark.x, place.mark.y, place.mark.width, place.mark.height], [25, 25, 93, 36]);
  assert.equal(place.line.y, place.mark.bottom + 1);
  assert.ok(Math.abs(place.line.x - (25 + (114 / 507) * 93)) < 0.05, 'the d stands on the stem of the p');
  assert.ok(Math.abs(place.head.right - place.line.x) < 0.05, 'the head hangs left of the stem');
  assert.equal(place.panes.y, 94);
  await page.close();
});

test('someone signed in with no code can sign out again', async () => {
  const { page } = await open('/', { signedIn: true });

  await page.waitForSelector('text=Your code');
  await page.click('button:has-text("Sign out")');
  await page.waitForSelector('button:has-text("Create account")');
  await page.close();
});
