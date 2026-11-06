// A real import through the workbench, against the live store, on a throwaway test account. There is
// no staging stack. Set RPM_TEST_EMAIL and RPM_TEST_PASSWORD to run it, and each run removes what it
// uploaded. A test key never goes in the repo. It runs on the dev server, or on a deployed site named
// by RPM_TEST_SITE, which is the only place the site's content security policy applies.

import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { chromium } from 'playwright';

import { nativeFfmpeg } from '../parity/corpus.mjs';

const { RPM_TEST_EMAIL: email, RPM_TEST_PASSWORD: password, RPM_TEST_SITE } = process.env;
const root = new URL('../..', import.meta.url).pathname;
const work = join(root, '.build/e2e');
const port = 8126;
const site = RPM_TEST_SITE ?? `http://localhost:${port}`;
const stamp = Date.now();
const album = `Import Test ${stamp}`;

function ffmpeg(...args) {
  execFileSync(nativeFfmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
}

function makeAlbum() {
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  ffmpeg('-f', 'lavfi', '-i', `color=c=0x${(stamp % 0xffffff).toString(16).padStart(6, '0')}:s=600x600`, '-frames:v', '1', join(work, 'cover.png'));
  const files = [];
  for (let n = 1; n <= 3; n++) {
    const file = join(work, `0${n} - Tone ${n}.flac`);
    ffmpeg('-f', 'lavfi', '-i', `sine=f=${220 * n + (stamp % 97)}:d=6:r=44100`, '-i', join(work, 'cover.png'), '-map', '0:a', '-map', '1:v', '-c:v', 'copy',
      '-disposition:v', 'attached_pic', '-c:a', 'flac', '-metadata', `title=Tone ${n}`, '-metadata', 'artist=rpm test', '-metadata', `album=${album}`, '-metadata', `track=${n}`, '-metadata', 'date=2026', file);
    files.push(file);
  }
  return files;
}

function nativeHash(file) {
  const out = join(work, 'native-canon.flac');
  const result = spawnSync(nativeFfmpeg, ['-loglevel', 'error', '-y', '-i', file, '-map', '0:a', '-c', 'copy', '-map_metadata', '-1', '-map_chapters', '-1', '-bitexact', out]);
  assert.equal(result.status, 0);
  return createHash('sha256').update(readFileSync(out)).digest('hex');
}

async function signIn(page) {
  await page.goto(`${site}/`);
  await page.waitForSelector('input[type=email]');
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', password);
  await page.click('button[type=submit]');
  await page.waitForSelector('.rail');
}

// Calls the API from the page, with the page's own session.
const api = (page, path, method = 'GET', body) =>
  page.evaluate(async ([path, method, body]) => {
    const refresh = await fetch('/accounts/auth/refresh', { method: 'POST', headers: { 'X-RPM-Session': 'cookie' } });
    const { accessToken } = await refresh.json();
    const answer = await fetch(`/api/${path}`, { method, headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: answer.status, json: await answer.json().catch(() => null) };
  }, [path, method, body]);

async function list(page) {
  return (await api(page, 'cloud/list?limit=2000')).json.files;
}

async function ours(page) {
  return (await list(page)).filter((file) => file.album === album);
}

// An earlier run that was stopped may have left its tracks behind.
async function clearEarlierRuns(page) {
  const left = (await list(page)).filter((file) => file.album?.startsWith('Import Test '));
  for (const file of left) await api(page, `cloud/file/${file.rpmId}`, 'DELETE');
  return left.length;
}

test('a real import through the workbench', { skip: !email, timeout: 300_000 }, async (context) => {
  const files = makeAlbum();
  if (!RPM_TEST_SITE) {
    const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore', detached: true });
    await new Promise((done) => setTimeout(done, 2500));
    context.after(() => {
      try {
        process.kill(-server.pid);
      } catch {
        // Already gone.
      }
    });
  }

  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  context.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error)));
  page.on('console', (message) => {
    if (/Content Security Policy/.test(message.text())) problems.push(message.text());
  });
  const hosts = new Set();
  page.on('request', (request) => hosts.add(new URL(request.url()).host));
  context.after(() => console.log(`hosts: ${[...hosts].join(' ')}`));

  // A free account would be asked for a code. The answer changes in this page only, so the server
  // still treats it as free, and nothing is written to the account.
  await page.route('**/accounts/auth/me', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), grSupporter: true } });
  });

  await signIn(page);
  console.log(`left by earlier runs: ${await clearEarlierRuns(page)}`);
  await page.click('.rail button:has-text("Import")');
  await page.setInputFiles('input[type=file][multiple]', files);

  // The tags were read from the files themselves.
  await page.waitForFunction((name) => document.querySelector('.album')?.textContent === name, album, { timeout: 30_000 });
  await page.waitForFunction(() => [...document.querySelectorAll('.row .title')].map((row) => row.textContent).join() === 'Tone 1,Tone 2,Tone 3', null, { timeout: 30_000 });
  await page.screenshot({ path: join(work, 'workbench.png') });

  await page.click('footer button:text-is("Import")');
  await page.waitForFunction(() => document.querySelectorAll('.state.done').length === 3, null, { timeout: 120_000 });

  const stored = await ours(page);
  try {
    assert.equal(stored.length, 3);
    const one = stored.find((file) => file.title === 'Tone 1');
    assert.equal(one.tags.trackNumber, 1);
    assert.equal(one.tags.year, 2026);
    assert.ok(one.tags.durationSeconds > 5.9 && one.tags.durationSeconds < 6.1);
    assert.equal(one.relativePath, `rpm test/${album}/01 - Tone 1.flac`);

    // The hash in the store is what the desktop's own ffmpeg gives for the same file.
    assert.equal(one.sha256, nativeHash(files[0]));

    // The 128 copy and the head clip were made in the browser, so no live transcode is needed.
    const rendition = await api(page, `cloud/stream/${one.rpmId}?rate=128`);
    assert.equal(rendition.json.live ?? false, false, 'the 128 copy is not there');
    assert.equal(rendition.json.kilobits, 128);

    const sidecar = await api(page, `cloud/sidecar/${one.rpmId}`);
    assert.equal(sidecar.status, 200);

    // The album is on the wall, with the cover that was in the files, and it plays.
    await page.waitForSelector(`.card:has-text("${album}") img`, { timeout: 30_000 });
    await page.click(`.card:has-text("${album}")`);
    await page.click('.track:has-text("Tone 2")');
    await page.waitForFunction(() => /TONE 2/i.test(document.querySelector('.playing')?.textContent ?? ''), null, { timeout: 20_000 });
    await page.waitForFunction(() => /0:0[1-5]/.test(document.querySelector('.seek .time')?.textContent ?? ''), null, { timeout: 20_000 });

    // The room takes its colour from the cover. A failure here is silent on screen.
    await page.waitForFunction(() => document.querySelector('.room')?.style.getPropertyValue('--wash').startsWith('rgb'), null, { timeout: 20_000 });

    // The same files again: nothing is stored twice.
    await page.click('button:has-text("Clear finished")');
    await page.setInputFiles('input[type=file][multiple]', files.slice(0, 1));
    await page.waitForFunction(() => document.querySelectorAll('.row').length === 1, null, { timeout: 20_000 });
    await page.click('footer button:text-is("Import")');
    await page.waitForFunction(() => document.querySelectorAll('.state.known').length === 1, null, { timeout: 60_000 });
    assert.equal((await ours(page)).length, 3);

    assert.deepEqual(problems, []);
  } catch (error) {
    await page.screenshot({ path: join(work, 'failed.png') });
    console.log(await page.$$eval('.row', (rows) => rows.map((row) => row.textContent)));
    console.log(await page.evaluate(() => document.querySelector('footer')?.textContent));
    throw error;
  } finally {
    for (const file of stored) await api(page, `cloud/file/${file.rpmId}`, 'DELETE');
    for (const file of await ours(page)) await api(page, `cloud/file/${file.rpmId}`, 'DELETE');
    assert.equal((await ours(page)).length, 0, 'the test left tracks behind');
  }
});
