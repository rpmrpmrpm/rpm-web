// A fingerprint made here must be the one the desktop's fpcalc makes. The rpm database matches on these
// numbers, and the two apps look each other's tracks up in it.
//
// Set RPM_PARITY_DIR to also compare the audio files in a folder of real music. The folder is read and
// never changed.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { test } from 'node:test';

import createRpmMedia from '../../public/media/rpm-media.js';
import { makeCorpus, nativeFfmpeg } from './corpus.mjs';

const fpcalc = process.env.RPM_FPCALC ?? join(dirname(nativeFfmpeg), 'fpcalc');
const held = ['.mp3', '.m4a', '.aac', '.flac', '.ogg', '.oga', '.opus', '.wav', '.aif', '.aiff', '.wma', '.wv'];

// The arguments in FpcalcRunner. A code other than 0 can come with a complete answer.
function native(path, ...flags) {
  try {
    return JSON.parse(execFileSync(fpcalc, ['-json', ...flags, '-length', '0', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 }));
  } catch (error) {
    return error.stdout ? JSON.parse(error.stdout) : null;
  }
}

const media = await createRpmMedia({ print() {}, printErr() {} });
media.FS.mkdir('/in');
let mounted = null;

function wasm(path) {
  const folder = dirname(path);
  if (mounted !== folder) {
    if (mounted) media.FS.unmount('/in');
    media.FS.mount(media.NODEFS, { root: folder }, '/in');
    mounted = folder;
  }
  const name = media.stringToNewUTF8(`/in/${basename(path)}`);
  const made = media._rm_fingerprint(name);
  media._free(name);
  if (!made) return null;
  const frames = media._rm_fingerprint_frames(made);
  const at = media._rm_fingerprint_raw(made) >> 2;
  const answer = {
    fingerprint: media.UTF8ToString(media._rm_fingerprint_text(made)),
    raw: Array.from(media.HEAP32.subarray(at, at + frames)),
    duration: media._rm_fingerprint_seconds(made),
  };
  media._rm_fingerprint_close(made);
  return answer;
}

function compare(path) {
  const raw = native(path, '-raw', '-signed');
  const text = native(path);
  const ours = wasm(path);
  assert.equal(ours === null, raw === null, 'one side has no fingerprint');
  if (!ours) return;

  assert.deepEqual(ours.raw, raw.fingerprint, 'the sub-fingerprints differ');
  assert.equal(ours.fingerprint, text.fingerprint, 'the compressed forms differ');
  assert.ok(Math.abs(ours.duration - raw.duration) <= 0.005, `the durations differ: ${ours.duration}, ${raw.duration}`);
}

function audioFiles(folder) {
  const found = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) found.push(...audioFiles(path));
    else if (held.includes(extname(entry.name).toLowerCase())) found.push(path);
  }
  return found;
}

const corpus = new URL('../../.build/parity/corpus/', import.meta.url).pathname;

for (const name of makeCorpus(corpus)) {
  test(`fingerprint: ${name}`, () => compare(join(corpus, name)));
}

test('a file that is not audio has no fingerprint on either side, and says why', () => {
  const path = join(corpus, 'notes.mp3');
  writeFileSync(path, 'this is not audio '.repeat(100));
  assert.equal(wasm(path), null);
  assert.ok(media.UTF8ToString(media._rpm_last_error()).length > 0);
  assert.equal(native(path), null);
});

if (process.env.RPM_PARITY_DIR) {
  const files = audioFiles(process.env.RPM_PARITY_DIR);
  const limit = Number(process.env.RPM_PARITY_LIMIT ?? files.length);
  const step = Math.max(1, Math.floor(files.length / limit));
  for (let index = 0; index < files.length && index / step < limit; index += step) {
    test(`real file: ${basename(files[index])}`, () => compare(files[index]));
  }
}
