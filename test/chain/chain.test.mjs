// The joins between tracks are checked on samples, not by ear. One continuous signal is cut into
// three tracks, the tracks go through the chain, and the stream that comes out is decoded with the
// native ffmpeg and compared with the original.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import createRpmMedia from '../../public/media/rpm-media.js';
import { Chain, MemorySource, STREAM_RATE } from '../../src/audio/chain.js';
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
    const { bytes, drained } = chain.render(1);
    parts.push(bytes);
    if (drained) break;
  }
  parts.push(chain.finish());
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

test('a track that cannot be read stops the render, and the next call moves on', () => {
  const [one] = cut(original).map((pcm, index) => encode(pcm, `skip-${index}.flac`, ['-c:a', 'flac']));
  const chain = new Chain(media);
  chain.add({ name: 'bad.flac', source: new MemorySource(new TextEncoder().encode('not audio '.repeat(50))), gain: 1 });
  chain.add({ name: 'good.flac', source: new MemorySource(one), gain: 1 });
  assert.equal(chain.render(1).failed, true);
  while (!chain.render(1).drained);
  assert.equal(chain.failures.length, 1);
  assert.equal(chain.failures[0].name, 'bad.flac');
  assert.ok(chain.failures[0].said.length > 0);
  assert.equal(chain.boundaries.length, 1);
  chain.close();
});

test('a track added after the queue ran dry joins with every sample identical', () => {
  const [one, two] = cut(original).map((pcm, index) => encode(pcm, `late-${index}.flac`, ['-c:a', 'flac']));
  const chain = new Chain(media);
  chain.add({ name: 'one.flac', source: new MemorySource(one), gain: 1 });
  const parts = [];
  for (;;) {
    const { bytes, drained } = chain.render(1);
    parts.push(bytes);
    if (drained) break;
  }
  chain.add({ name: 'two.flac', source: new MemorySource(two), gain: 1 });
  for (;;) {
    const { bytes, drained } = chain.render(1);
    parts.push(bytes);
    if (drained) break;
  }
  parts.push(chain.finish());
  chain.close();
  const decoded = decodeStream(concat(parts), 'late.mp4');
  const expected = (LENGTHS[0] + LENGTHS[1]) * 2;
  assert.equal(decoded.length, expected);
  assert.equal(largestDifference(decoded, original, 0, LENGTHS[0] + LENGTHS[1]), 0);
});

test('a track reopened after a failure starts where it stopped', () => {
  const file = encode(original.subarray(0, 441_000 * 2), 'resume.flac', ['-c:a', 'flac']);
  const chain = new Chain(media);
  chain.add({ name: 'resume.flac', source: new MemorySource(file), gain: 1, startAt: 3 });
  const parts = [];
  for (;;) {
    const { bytes, drained } = chain.render(1);
    parts.push(bytes);
    if (drained) break;
  }
  parts.push(chain.finish());
  assert.equal(chain.boundaries[0].offset, 3);
  chain.close();
  const decoded = decodeStream(concat(parts), 'resume.mp4');
  assert.equal(decoded.length / 2, 441_000 - 3 * STREAM_RATE);
  assert.equal(largestDifference(decoded, original.subarray(3 * STREAM_RATE * 2), 0, 1000), 0);
});

test('a rendition keeps the exact length of the track', () => {
  const file = encode(original.subarray(0, LENGTHS[0] * 2), 'source.flac', ['-c:a', 'flac']);
  media.rmSources = { read: (id, view) => { const part = file.subarray(place, place + view.length); view.set(part); place += part.length; return part.length; }, seek: (id, offset, whence) => { if (whence === 3) return file.length; place = whence === 0 ? offset : whence === 1 ? place + offset : file.length + offset; return place; } };
  let place = 0;
  const name = media.stringToNewUTF8('source.flac');
  const decoder = media._rm_open(1, name, STREAM_RATE);
  media._free(name);
  assert.notEqual(decoder, 0);
  const out = media.stringToNewUTF8('/tmp/rendition.m4a');
  assert.equal(media._rm_encode(decoder, out, 128, 0), 0, media.UTF8ToString(media._rpm_last_error()));
  media._rm_close(decoder);
  const bytes = media.FS.readFile('/tmp/rendition.m4a');
  media.FS.unlink('/tmp/rendition.m4a');
  media._free(out);
  assert.ok(bytes.length > 10_000);
  assert.equal(String.fromCharCode(...bytes.subarray(4, 8)), 'ftyp');

  // Read back through the same decoder the player uses, which trims to the stored length.
  const chain = new Chain(media);
  chain.add({ name: 'rendition.m4a', source: new MemorySource(bytes), gain: 1 });
  const parts = [];
  for (;;) {
    const result = chain.render(1);
    parts.push(result.bytes);
    if (result.drained) break;
  }
  parts.push(chain.finish());
  chain.close();
  assert.equal(decodeStream(concat(parts), 'rendition.mp4').length / 2, LENGTHS[0]);
});

test('a head clip is the first three seconds', () => {
  const file = encode(original.subarray(0, LENGTHS[0] * 2), 'head.flac', ['-c:a', 'flac']);
  let place = 0;
  media.rmSources = { read: (id, view) => { const part = file.subarray(place, place + view.length); view.set(part); place += part.length; return part.length; }, seek: (id, offset, whence) => { if (whence === 3) return file.length; place = whence === 0 ? offset : whence === 1 ? place + offset : file.length + offset; return place; } };
  const name = media.stringToNewUTF8('head.flac');
  const decoder = media._rm_open(1, name, STREAM_RATE);
  media._free(name);
  const out = media.stringToNewUTF8('/tmp/head.m4a');
  assert.equal(media._rm_encode(decoder, out, 96, 3), 0);
  media._rm_close(decoder);
  media._free(out);
  const bytes = media.FS.readFile('/tmp/head.m4a');
  media.FS.unlink('/tmp/head.m4a');
  assert.ok(bytes.length < 60_000, `the clip is ${bytes.length} bytes`);
});

test('levelling gain changes the level and the join stays exact', () => {
  const quiet = encode(original.subarray(0, 88_200), 'gain.flac', ['-c:a', 'flac']);
  const chain = new Chain(media);
  chain.add({ name: 'gain.flac', source: new MemorySource(quiet), gain: 0.5 });
  const parts = [];
  for (;;) {
    const { bytes, drained } = chain.render(1);
    parts.push(bytes);
    if (drained) break;
  }
  parts.push(chain.finish());
  chain.close();
  const decoded = decodeStream(concat(parts), 'gain.mp4');
  assert.equal(decoded.length, 88_200);
  assert.ok(largestDifference(decoded.map((v) => v * 2), original, 0, 44_100) <= 2);
});

const pieces = (chain) => {
  const parts = [];
  for (;;) {
    const { bytes, drained, waiting, failed } = chain.render(1);
    parts.push(bytes);
    if (drained || waiting || failed) return { parts, waiting, failed };
  }
};

test('a head clip hands over to the track on the same sample', () => {
  const frames = LENGTHS[0];
  const whole = encode(original.subarray(0, frames * 2), 'join-whole.flac', ['-c:a', 'flac']);
  const head = encode(original.subarray(0, 44_100 * 2), 'join-head.flac', ['-c:a', 'flac']);

  const chain = new Chain(media);
  chain.add({ id: 'one', name: 'join.flac', head, gain: 1 });

  // The clip plays with nothing else known, and then there is nothing to make until the address comes.
  const first = pieces(chain);
  assert.equal(first.waiting, true);
  assert.equal(chain.framesWritten, 44_100);
  assert.deepEqual(chain.failures, []);

  chain.join('one', () => new MemorySource(whole));
  const rest = pieces(chain);
  assert.equal(rest.waiting, false);
  const stream = concat([...first.parts, ...rest.parts, chain.finish()]);
  const boundaries = chain.boundaries;
  chain.close();

  const decoded = decodeStream(stream, 'join.mp4');
  assert.equal(decoded.length, frames * 2, 'a clip joined to its own recording is the length of the recording');
  assert.equal(largestDifference(decoded, original, 0, frames), 0);

  // The clip's own length says nothing about the track's: it is not known until the join, and the clock runs
  // straight through the join.
  assert.equal(boundaries.length, 2);
  assert.equal(boundaries[0].duration, 0);
  assert.equal(boundaries[1].at, 1);
  assert.equal(boundaries[1].offset, 1);
  assert.ok(Math.abs(boundaries[1].duration - frames / STREAM_RATE) < 0.01);
});

test('a clip of AAC joins a track without changing its length', () => {
  const frames = LENGTHS[0];
  const pcm = original.subarray(0, frames * 2);
  const whole = encode(pcm, 'join-long.m4a', ['-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart']);
  const head = encode(pcm.subarray(0, 3 * 44_100 * 2 > pcm.length ? 44_100 * 2 : 3 * 44_100 * 2), 'join-clip.m4a', ['-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart']);

  const chain = new Chain(media);
  chain.add({ id: 'one', name: 'join.m4a', head, gain: 1, makeSource: () => new MemorySource(whole) });
  const { parts } = pieces(chain);
  const stream = concat([...parts, chain.finish()]);
  chain.close();
  assert.equal(decodeStream(stream, 'join-aac.mp4').length, frames * 2);
});

test('the address can come before the clip runs dry', () => {
  const frames = LENGTHS[0];
  const whole = encode(original.subarray(0, frames * 2), 'early-whole.flac', ['-c:a', 'flac']);
  const head = encode(original.subarray(0, 44_100 * 2), 'early-head.flac', ['-c:a', 'flac']);

  const chain = new Chain(media);
  chain.add({ id: 'one', name: 'early.flac', head, gain: 1 });
  chain.join('one', () => new MemorySource(whole));
  const { parts, waiting } = pieces(chain);
  const stream = concat([...parts, chain.finish()]);
  chain.close();

  assert.equal(waiting, false);
  assert.equal(largestDifference(decodeStream(stream, 'early.mp4'), original, 0, frames), 0);
});

test('a clip that is the whole of the track does not play it twice', () => {
  const short = original.subarray(0, 40_000 * 2);
  const whole = encode(short, 'short.flac', ['-c:a', 'flac']);

  const chain = new Chain(media);
  chain.add({ id: 'one', name: 'short.flac', head: whole, gain: 1, makeSource: () => new MemorySource(whole) });
  const { parts } = pieces(chain);
  const stream = concat([...parts, chain.finish()]);
  chain.close();
  assert.equal(decodeStream(stream, 'short.mp4').length, short.length);
});

test('a source that cannot be read at the join is a failure at that place', () => {
  const head = encode(original.subarray(0, 44_100 * 2), 'fail-head.flac', ['-c:a', 'flac']);

  const chain = new Chain(media);
  chain.add({ id: 'one', name: 'fail.flac', head, gain: 1, makeSource: () => new MemorySource(new TextEncoder().encode('not audio '.repeat(50))) });
  const { failed } = pieces(chain);
  assert.equal(failed, true);
  assert.equal(chain.failures.length, 1);
  assert.equal(chain.failures[0].at, 1);
  chain.close();
});

test('an address for a track that has gone changes nothing', () => {
  const head = encode(original.subarray(0, 44_100 * 2), 'gone-head.flac', ['-c:a', 'flac']);
  const chain = new Chain(media);
  chain.add({ id: 'old', name: 'gone.flac', head, gain: 1 });
  chain.render(0.5);
  chain.stop();
  chain.join('old', () => {
    throw new Error('never opened');
  });
  assert.equal(chain.render(0.5).drained, true);
  chain.close();
});
