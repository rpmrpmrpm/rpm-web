// The canonical copy made here must give the same bytes as the one the desktop app makes. The hash of
// those bytes is the key of the blob in the store, so any difference stores the same track twice.
//
// Set RPM_PARITY_DIR to also compare the audio files in a folder of real music. The folder is read and
// never changed.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { test } from 'node:test';

import createRpmMedia from '../../public/media/rpm-media.js';
import { makeCorpus, nativeFfmpeg } from './corpus.mjs';

const work = new URL('../../.build/parity/', import.meta.url).pathname;
const output = join(work, 'out');
const held = ['.mp3', '.m4a', '.aac', '.flac', '.ogg', '.oga', '.opus', '.wav', '.aif', '.aiff', '.wma', '.wv'];

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const isMp4Family = (ext) => ['.m4a', '.mp4', '.m4b'].includes(ext);

// CanonicalAudio.RefusedTheCodec
const refusedTheCodec = (said) => /Could not find tag for codec|Could not write header/i.test(said);

function nativeOnce(source, target, forceMp4) {
  const args = ['-loglevel', 'error', '-y', '-i', source, '-map', '0:a', '-c', 'copy', '-map_metadata', '-1',
    '-map_chapters', '-1', '-bitexact'];
  if (isMp4Family(extname(target))) args.push('-movflags', '+faststart');
  if (forceMp4) args.push('-f', 'mp4');
  args.push(target);
  const result = spawnSync(nativeFfmpeg, args, { encoding: 'utf8' });
  return result.status === 0 ? null : result.stderr;
}

// CanonicalAudio.CreateAsync
function canonical(once, source, target) {
  const ext = extname(target);
  let error = once(source, target, false);
  if (error !== null && isMp4Family(ext) && refusedTheCodec(error)) error = once(source, target, true);
  return error;
}

mkdirSync(output, { recursive: true });

const media = await createRpmMedia({ print() {}, printErr() {} });
media.FS.mkdir('/in');
media.FS.mkdir('/out');
media.FS.mount(media.NODEFS, { root: output }, '/out');
let mounted = null;

function wasmOnce(source, target, forceMp4) {
  const folder = dirname(source);
  if (mounted !== folder) {
    if (mounted) media.FS.unmount('/in');
    media.FS.mount(media.NODEFS, { root: folder }, '/in');
    mounted = folder;
  }
  const result = media.ccall('rpm_canonical', 'number',
    ['string', 'string', 'number'],
    [`/in/${basename(source)}`, `/out/${basename(target)}`, forceMp4 ? 1 : 0]);
  return result === 0 ? null : media.UTF8ToString(media.ccall('rpm_last_error', 'number', [], []));
}

let compared = 0;

function compare(source) {
  const ext = extname(source).toLowerCase();
  // A name of its own for each case: the module's file system keeps a record of each name it has
  // seen, and a file removed behind its back would stay in that record.
  compared += 1;
  const nativeFile = join(output, `native-${compared}${ext}`);
  const wasmFile = join(output, `wasm-${compared}${ext}`);

  const nativeSaid = canonical(nativeOnce, source, nativeFile);
  const wasmSaid = canonical(wasmOnce, source, wasmFile);

  assert.equal(wasmSaid === null, nativeSaid === null,
    `native said: ${nativeSaid}\nwasm said: ${wasmSaid}`);
  if (nativeSaid === null) {
    assert.equal(statSync(wasmFile).size, statSync(nativeFile).size, 'the sizes differ');
    assert.equal(sha256(wasmFile), sha256(nativeFile), 'the hashes differ');
  }

  rmSync(nativeFile, { force: true });
  rmSync(wasmFile, { force: true });
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

const corpus = join(work, 'corpus');

for (const name of makeCorpus(corpus)) {
  test(`parity: ${name}`, () => compare(join(corpus, name)));
}

test('a file that is not audio fails on both sides, with words', () => {
  const path = join(corpus, 'notes.mp3');
  writeFileSync(path, 'this is not audio '.repeat(100));
  const said = canonical(wasmOnce, path, join(output, 'wasm-notes.mp3'));
  assert.notEqual(said, null);
  assert.ok(said.length > 0);
  assert.notEqual(canonical(nativeOnce, path, join(output, 'native-notes.mp3')), null);
});

test('the native ffmpeg is the pinned version', () => {
  const version = execFileSync(nativeFfmpeg, ['-version'], { encoding: 'utf8' }).split('\n')[0];
  assert.match(version, /^ffmpeg version 8\.1\.3-rpm/);
});

if (process.env.RPM_PARITY_DIR) {
  const files = audioFiles(process.env.RPM_PARITY_DIR);
  const limit = Number(process.env.RPM_PARITY_LIMIT ?? files.length);
  for (const path of files.slice(0, limit)) {
    test(`real file: ${basename(path)}`, () => compare(path));
  }
}
