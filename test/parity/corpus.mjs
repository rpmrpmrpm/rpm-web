// Writes the files the parity test compares, with the native ffmpeg that the desktop app ships.
// Each case is a realistic file: tags, cover art where the container holds it, and the encoders that
// real music comes from.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { join } from 'node:path';

const rid = `${platform() === 'darwin' ? 'osx' : 'linux'}-${arch()}`;

export const nativeFfmpeg =
  process.env.RPM_FFMPEG ?? new URL(`../../../rpm-desktop/RPM.Desktop/NativeLibs/tools/${rid}/ffmpeg`, import.meta.url).pathname;

function run(...args) {
  execFileSync(nativeFfmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
}

const tags = ['-metadata', 'title=Parity', '-metadata', 'artist=rpm', '-metadata', 'album=Corpus', '-metadata', 'track=3'];

// Two tones and quiet noise, so the encoders have something real to work on.
const tone = ['-f', 'lavfi', '-i', 'sine=f=220:d=20:r=44100,aformat=channel_layouts=stereo'];
const art = (dir) => ['-i', join(dir, 'cover.png')];
const withArt = ['-map', '0:a', '-map', '1:v', '-c:v', 'copy', '-disposition:v', 'attached_pic'];

// name, then the arguments that make the file. ext is the extension of the file.
export function cases(dir) {
  return [
    { name: 'cbr.mp3', make: [...tone, ...art(dir), ...withArt, '-c:a', 'libmp3lame', '-b:a', '192k', '-id3v2_version', '3', ...tags] },
    { name: 'vbr.mp3', make: [...tone, '-c:a', 'libmp3lame', '-q:a', '4', ...tags] },
    { name: 'mono.mp3', make: [...tone, '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '96k'] },
    { name: 'aac.m4a', make: [...tone, ...art(dir), ...withArt, '-c:a', 'aac', '-b:a', '192k', ...tags] },
    { name: 'alac.m4a', make: [...tone, '-c:a', 'alac', ...tags] },
    { name: 'eac3.m4a', make: [...tone, '-c:a', 'eac3', '-b:a', '192k', '-f', 'mp4'] },
    { name: 'two-streams.m4a', make: [...tone, '-f', 'lavfi', '-i', 'sine=f=440:d=20', '-map', '0:a', '-map', '1:a', '-c:a', 'aac', '-f', 'mp4'] },
    { name: 'adts.aac', make: [...tone, '-c:a', 'aac', '-b:a', '128k', '-f', 'adts'] },
    { name: 'plain.flac', make: [...tone, '-c:a', 'flac', ...tags] },
    { name: 'art.flac', make: [...tone, ...art(dir), ...withArt, '-c:a', 'flac', ...tags] },
    { name: 'hires.flac', make: [...tone, '-ar', '96000', '-sample_fmt', 's32', '-c:a', 'flac'] },
    { name: 'vorbis.ogg', make: [...tone, '-c:a', 'vorbis', '-strict', '-2', ...tags] },
    { name: 'flac.oga', make: [...tone, '-c:a', 'flac', '-f', 'oga', ...tags] },
    { name: 'plain.opus', make: [...tone, '-ar', '48000', '-c:a', 'opus', '-strict', '-2', ...tags] },
    { name: 's16.wav', make: [...tone, '-c:a', 'pcm_s16le', ...tags] },
    { name: 's24.wav', make: [...tone, '-c:a', 'pcm_s24le'] },
    { name: 'be.aif', make: [...tone, '-c:a', 'pcm_s16be', '-f', 'aiff'] },
    { name: 'tags.aiff', make: [...tone, '-c:a', 'pcm_s24be', ...tags] },
    { name: 'wmav2.wma', make: [...tone, '-c:a', 'wmav2', '-b:a', '128k', ...tags] },
    { name: 'plain.wv', make: [...tone, '-c:a', 'wavpack', ...tags] },
  ];
}

// A file cut short, as a failed download leaves it.
const truncated = [
  { name: 'cut.mp3', from: 'cbr.mp3', keep: 0.6 },
  { name: 'cut.flac', from: 'plain.flac', keep: 0.6 },
  { name: 'cut.aac', from: 'adts.aac', keep: 0.6 },
];

export function makeCorpus(dir) {
  mkdirSync(dir, { recursive: true });
  const cover = join(dir, 'cover.png');
  if (!existsSync(cover)) run('-f', 'lavfi', '-i', 'color=c=0x204060:s=300x300', '-frames:v', '1', cover);

  const files = [];
  for (const { name, make } of cases(dir)) {
    const path = join(dir, name);
    if (!existsSync(path)) run(...make, path);
    files.push(name);
  }
  for (const { name, from, keep } of truncated) {
    const path = join(dir, name);
    if (!existsSync(path)) {
      const bytes = readFileSync(join(dir, from));
      writeFileSync(path, bytes.subarray(0, Math.floor(bytes.length * keep)));
    }
    files.push(name);
  }
  return files;
}
