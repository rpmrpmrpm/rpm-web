// The joins between tracks are checked on samples, not by ear. One continuous signal is cut into
// three tracks, the tracks go through the chain, and the stream that comes out is decoded with the
// native ffmpeg and compared with the original.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import createRpmMedia from '../../public/media/rpm-media.js';
import { Chain, MemorySource, STREAM_RATE } from '../../proof/chain.js';
import { nativeFfmpeg } from '../parity/corpus.mjs';

const work = new URL('../../.build/chain/', import.meta.url).pathname;
mkdirSync(work, { recursive: true });

// Sample counts that are not multiples of any codec's frame size.
const LENGTHS = [136_711, 119_003, 189_677];

// Two tones, in s16le stereo.
function signal(frames) {
  const samples = new Int16Array(frames * 2);
  for (let i = 0; i < frames; i++) {
    const t = i / STREAM_RATE;
    const value = 0.3 * Math.sin(2 * Math.PI * 441 * t) + 0.2 * Math.sin(2 * Math.PI * 1033 * t);
    samples[i * 2] = samples[i * 2 + 1] = Math.round(value * 32767);
  }
  return samples;
}

function encode(pcm, name, args) {
  const raw = join(work, `${name}.raw`);
  const file = join(work, name);
  writeFileSync(raw, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  execFileSync(nativeFfmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 's16le', '-ar', String(STREAM_RATE),
    '-ac', '2', '-i', raw, ...args, file]);
  return readFileSync(file);
}

function decodeStream(bytes, name) {
  const file = join(work, name);
  writeFileSync(file, bytes);
  const result = spawnSync(nativeFfmpeg, ['-hide_banner', '-loglevel', 'error', '-i', file, '-f', 's16le',
    '-ar', String(STREAM_RATE), '-ac', '2', 'pipe:1'], { maxBuffer: 1 << 28 });
  assert.equal(result.status, 0, result.stderr?.toString());
  const copy = Uint8Array.from(result.stdout);
  return new Int16Array(copy.buffer, 0, Math.floor(copy.length / 2));
}

function concat(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const all = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    all.set(part, at);
    at += part.length;
  }
  return all;
}

const media = await createRpmMedia({ print() {}, printErr() {} });

function renderTracks(files, extension) {
  const chain = new Chain(media);
  files.forEach((bytes, index) => {
    chain.add({ name: `track${index}${extension}`, source: new MemorySource(bytes), gain: 1 });
  });

  const parts = [];
  for (;;) {
    const { bytes, ended } = chain.render(1);
    parts.push(bytes);
    if (ended) break;
  }
  const boundaries = chain.boundaries;
  assert.deepEqual(chain.failures, []);
  chain.close();
  return { stream: concat(parts), boundaries };
}

function cut(whole) {
  let at = 0;
  return LENGTHS.map((length) => {
    const part = whole.subarray(at * 2, (at + length) * 2);
    at += length;
    return part;
  });
}

const total = LENGTHS.reduce((sum, length) => sum + length, 0);
const original = signal(total);

function largestDifference(actual, expected, from, to) {
  let largest = 0;
  for (let i = Math.max(0, from) * 2; i < Math.min(to, expected.length / 2) * 2; i++) {
    largest = Math.max(largest, Math.abs(actual[i] - expected[i]));
  }
  return largest;
}

test('FLAC tracks join with every sample identical', () => {
  const files = cut(original).map((pcm, index) => encode(pcm, `flac-${index}.flac`, ['-c:a', 'flac']));
  const { stream, boundaries } = renderTracks(files, '.flac');
  const decoded = decodeStream(stream, 'flac.mp4');

  assert.equal(decoded.length, original.length);
  assert.equal(largestDifference(decoded, original, 0, total), 0);
  assert.deepEqual(boundaries.map((b) => Math.round(b.at * STREAM_RATE)), [0, LENGTHS[0], LENGTHS[0] + LENGTHS[1]]);
});

for (const [label, extension, args] of [
  ['MP3 from LAME', '.mp3', ['-c:a', 'libmp3lame', '-b:a', '192k']],
  ['the 128 rendition', '.m4a', ['-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '44100', '-movflags', '+faststart']],
  ['AAC at 256', '.m4a', ['-c:a', 'aac', '-b:a', '256k']],
]) {
  test(`${label}: the tracks keep their length and the joins are clean`, () => {
    const files = cut(original).map((pcm, index) => encode(pcm, `lossy-${index}${extension}`, args));
    const { stream, boundaries } = renderTracks(files, extension);
    const decoded = decodeStream(stream, `lossy${extension}.mp4`);

    const firstJoin = LENGTHS[0];
    const secondJoin = LENGTHS[0] + LENGTHS[1];
    const worst = (join) => largestDifference(decoded, original, join - 200, join + 200);
    const body = largestDifference(decoded, original, 20_000, 60_000);

    console.log(`${label}: frames ${decoded.length / 2} of ${total}; boundaries`,
      boundaries.map((b) => Math.round(b.at * STREAM_RATE)), `largest error: body ${body}, joins ${worst(firstJoin)}, ${worst(secondJoin)}`);

    assert.equal(decoded.length / 2, total, 'the stream has the wrong length');

    // Each track was encoded alone, so a lossy codec is less exact at its edges. A gap of silence
    // gives an error of about 16000 here.
    assert.ok(worst(firstJoin) < 2500 && worst(secondJoin) < 2500, 'a join has a gap in it');
  });
}

test('a track that cannot be read is reported and the queue carries on', () => {
  const [one] = cut(original).map((pcm, index) => encode(pcm, `skip-${index}.flac`, ['-c:a', 'flac']));
  const chain = new Chain(media);
  chain.add({ name: 'bad.flac', source: new MemorySource(new TextEncoder().encode('not audio '.repeat(50))), gain: 1 });
  chain.add({ name: 'good.flac', source: new MemorySource(one), gain: 1 });
  while (!chain.render(1).ended);
  assert.equal(chain.failures.length, 1);
  assert.equal(chain.failures[0].name, 'bad.flac');
  assert.ok(chain.failures[0].said.length > 0);
  assert.equal(chain.boundaries.length, 1);
  chain.close();
});

test('levelling gain changes the level and the join stays exact', () => {
  const quiet = encode(original.subarray(0, 88_200), 'gain.flac', ['-c:a', 'flac']);
  const chain = new Chain(media);
  chain.add({ name: 'gain.flac', source: new MemorySource(quiet), gain: 0.5 });
  const parts = [];
  for (;;) {
    const { bytes, ended } = chain.render(1);
    parts.push(bytes);
    if (ended) break;
  }
  chain.close();
  const decoded = decodeStream(concat(parts), 'gain.mp4');
  assert.equal(decoded.length, 88_200);
  assert.ok(largestDifference(decoded.map((v) => v * 2), original, 0, 44_100) <= 2);
});
