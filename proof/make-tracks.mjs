// Writes the test albums: one continuous sound cut into seven tracks, in three encodings. The sound
// slides slowly in pitch, so a gap at a join can be heard at once. Each track is 25 seconds, so five
// track changes take about two minutes on a locked phone.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { nativeFfmpeg } from '../test/parity/corpus.mjs';

const RATE = 44100;
const TRACKS = 7;
const FRAMES = RATE * 25 + 137;
const folder = new URL('./tracks/', import.meta.url).pathname;
mkdirSync(folder, { recursive: true });

const total = FRAMES * TRACKS;
const samples = new Int16Array(total * 2);
let phase = 0;
for (let i = 0; i < total; i++) {
  const t = i / RATE;
  const pitch = 330 + 110 * Math.sin((2 * Math.PI * t) / 40);
  phase += (2 * Math.PI * pitch) / RATE;
  const value = 0.25 * Math.sin(phase) + 0.1 * Math.sin(2.01 * phase);
  samples[i * 2] = samples[i * 2 + 1] = Math.round(value * 32767);
}

const sets = [
  ['flac', 'flac', ['-c:a', 'flac']],
  ['mp3', 'mp3', ['-c:a', 'libmp3lame', '-b:a', '192k']],
  ['aac128', 'm4a', ['-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '44100', '-movflags', '+faststart']],
];

for (let n = 0; n < TRACKS; n++) {
  const part = samples.subarray(n * FRAMES * 2, (n + 1) * FRAMES * 2);
  const raw = join(folder, 'part.raw');
  writeFileSync(raw, Buffer.from(part.buffer, part.byteOffset, part.byteLength));
  for (const [set, extension, args] of sets) {
    execFileSync(nativeFfmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 's16le', '-ar', String(RATE),
      '-ac', '2', '-i', raw, ...args, join(folder, `${set}-${n + 1}.${extension}`)]);
  }
}
execFileSync('rm', [join(folder, 'part.raw')]);
