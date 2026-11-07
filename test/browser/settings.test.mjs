// The desktop's backdrops behind the app, chosen in Settings, and the profile with its picture.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, test } from 'node:test';

import { chromium } from 'playwright';

import { serve } from './fixture.mjs';

const port = 8134;
const site = `http://localhost:${port}`;
const root = new URL('../..', import.meta.url).pathname;
const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore', detached: true });
await new Promise((done) => setTimeout(done, 2500));
after(() => process.kill(-server.pid));

const browser = await chromium.launch();
after(() => browser.close());

async function open() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error)));
  await serve(page, site);
  await page.goto(site);
  await page.waitForSelector('.rail, .tabs');
  return { page, problems, close: () => context.close() };
}

const picture = (page) => page.$eval('.room .picture', (layer) => getComputedStyle(layer).backgroundImage);

async function settings(page, tab) {
  await page.click('.deck button[aria-label="Menu"]');
  await page.click('text=Settings');
  await page.click(`[role=tab]:has-text("${tab}")`);
}

test('the app stands on the desktop backdrop, and Settings changes it for this browser', async () => {
  const { page, problems, close } = await open();
  assert.match(await picture(page), /rpamp/);

  await settings(page, 'Display');
  await page.click('.tile:has-text("Night")');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.room .picture')).backgroundImage.includes('night'));
  assert.equal(await page.evaluate(() => localStorage.getItem('rpm-backdrop')), 'night');
  assert.equal(await page.getAttribute('.tile:has-text("Night")', 'aria-pressed'), 'true');

  await page.reload();
  await page.waitForSelector('.rail');
  assert.match(await picture(page), /night/);
  assert.deepEqual(problems, []);
  await close();
});

test('the profile shows the account picture and the display name', async () => {
  const { page, problems, close } = await open();
  await settings(page, 'Profile');
  await page.waitForSelector('.avatar img');
  assert.equal(await page.inputValue('.named input'), 'A Listener');
  assert.deepEqual(problems, []);
  await close();
});
