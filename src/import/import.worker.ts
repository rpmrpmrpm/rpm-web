// The heavy part of an import, away from the page: reading tags, fingerprints, the canonical copy, and
// the renditions.
// It handles one message at a time.

import { LoudnessMeter, MEASURE_RATE } from './loudness';
import { parseBlob } from 'music-metadata';

// @ts-expect-error chain.js is plain JavaScript, shared with the tests that run in Node.
import { FileSource } from '../audio/chain.js';
import type { TrackTags } from './queue';

export type ToImportWorker =
  | { id: number; type: 'tags'; file: File }
  | { id: number; type: 'loudness'; file: File }
  | { id: number; type: 'fingerprint'; file: File }
  | { id: number; type: 'clip'; file: File; kilobits: number; start: number; seconds: number }
  | { id: number; type: 'art'; file: File }
  | { id: number; type: 'canonical'; file: File; extension: string }
  | { id: number; type: 'renditions'; file: File; kilobits: number; headKilobits: number; headSeconds: number };

export interface ArtBytes {
  bytes: Uint8Array;
  mime: string;
}

const module = new URL('/media/rpm-media.js', self.location.origin).href;
const { default: createRpmMedia } = await import(/* @vite-ignore */ module);
const media = await createRpmMedia();
media.FS.mkdir('/in');
media.FS.mkdir('/print');
media.FS.mkdir('/out');

const sources = new Map<number, InstanceType<typeof FileSource>>();
media.rmSources = {
  read: (id: number, view: Uint8Array) => sources.get(id)!.read(view),
  seek: (id: number, offset: number, whence: number) => sources.get(id)!.seek(offset, whence),
};

const lastError = (): string => media.UTF8ToString(media._rpm_last_error());

// The id in the file's own tags, in whichever tag format the file has.
function rpmIdOf(native: Record<string, { id: string; value: unknown }[]>): string | null {
  for (const tags of Object.values(native)) {
    for (const tag of tags) {
      if (/(^|:)RPM_ID$/i.test(tag.id) || tag.id === '----:com.rpm.id:id') {
        const value = Array.isArray(tag.value) ? tag.value[0] : tag.value;
        const text = typeof value === 'string' ? value : (value as { text?: string })?.text;
        if (text) return text;
      }
    }
  }
  return null;
}

const first = (values: (string | undefined)[] | undefined) => values?.[0] ?? null;

async function readTags(file: File): Promise<{ tags: TrackTags; hasArt: boolean }> {
  const { common, format, native } = await parseBlob(file, { skipPostHeaders: false });
  return {
    hasArt: (common.picture?.length ?? 0) > 0,
    tags: {
      Title: common.title ?? null,
      Artist: common.artist ?? null,
      AlbumArtist: common.albumartist ?? null,
      Album: common.album ?? null,
      Genre: first(common.genre),
      TrackNumber: common.track?.no ?? 0,
      TrackCount: common.track?.of ?? 0,
      DiscNumber: common.disk?.no ?? 0,
      DiscCount: common.disk?.of ?? 0,
      DiscSubtitle: first(common.discsubtitle),
      Year: common.year ?? 0,
      Composers: common.composer?.join('; ') ?? null,
      Conductor: first(common.conductor),
      Comment: common.comment?.[0]?.text ?? null,
      Lyrics: common.lyrics?.[0]?.text ?? null,
      Grouping: common.grouping ?? null,
      Bpm: common.bpm ?? 0,
      Copyright: common.copyright ?? null,
      Publisher: first(common.label),
      Isrc: first(common.isrc),
      MusicalKey: common.key ?? null,
      ReleaseCountry: common.releasecountry ?? null,
      TitleSort: common.titlesort ?? null,
      ArtistSort: common.artistsort ?? null,
      AlbumArtistSort: common.albumartistsort ?? null,
      ComposerSort: common.composersort ?? null,
      Work: common.work ?? null,
      MovementName: common.movement ?? null,
      MovementNumber: common.movementIndex?.no ?? 0,
      MovementCount: common.movementIndex?.of ?? 0,
      Lyricist: first(common.lyricist),
      Arranger: first(common.arranger),
      Barcode: common.barcode ?? null,
      CatalogNumber: first(common.catalognumber),
      Media: common.media ?? null,
      ReleaseType: first(common.releasetype),
      OriginalYear: common.originalyear ?? 0,
      MusicBrainzRecordingId: common.musicbrainz_recordingid ?? null,
      MusicBrainzReleaseId: common.musicbrainz_albumid ?? null,
      MusicBrainzReleaseGroupId: common.musicbrainz_releasegroupid ?? null,
      MusicBrainzArtistId: first(common.musicbrainz_artistid),
      MusicBrainzReleaseArtistId: first(common.musicbrainz_albumartistid),
      DurationSeconds: format.duration ?? 0,
      Channels: format.numberOfChannels ?? 0,
      SampleRate: format.sampleRate ?? 0,
      BitsPerSample: format.bitsPerSample ?? 0,
      BitrateKbps: format.bitrate ? Math.round(format.bitrate / 1000) : 0,
      CodecDescription: format.codec ?? null,
      RpmId: rpmIdOf(native as Record<string, { id: string; value: unknown }[]>),
    },
  };
}

async function readArt(file: File): Promise<ArtBytes | null> {
  const { common } = await parseBlob(file, { skipPostHeaders: true });
  const picture = common.picture?.[0];
  return picture ? { bytes: new Uint8Array(picture.data), mime: picture.format } : null;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// CanonicalAudio.RefusedTheCodec
const refusedTheCodec = (said: string) => /Could not find tag for codec|Could not write header/i.test(said);
const isMp4Family = (extension: string) => ['.m4a', '.mp4', '.m4b'].includes(extension);

function canonicalOnce(input: string, output: string, forceMp4: boolean): string | null {
  const result = media.ccall('rpm_canonical', 'number', ['string', 'string', 'number'], [input, output, forceMp4 ? 1 : 0]);
  return result === 0 ? null : lastError();
}

// The output sits in the module's memory while it is hashed and handed over, so the largest file this
// can take is limited by what a browser gives a page.
async function canonical(file: File, extension: string): Promise<{ bytes: Uint8Array; sha256: string }> {
  media.FS.mount(media.WORKERFS, { files: [file] }, '/in');
  const input = `/in/${file.name}`;
  const output = `/out/canon${extension}`;
  try {
    let said = canonicalOnce(input, output, false);
    if (said !== null && isMp4Family(extension) && refusedTheCodec(said)) said = canonicalOnce(input, output, true);
    if (said !== null) throw new Error(said);

    const bytes: Uint8Array = media.FS.readFile(output);
    return { bytes, sha256: await sha256(bytes) };
  } finally {
    media.FS.unmount('/in');
    try {
      media.FS.unlink(output);
    } catch {
      // It was never written.
    }
  }
}

export interface Loudness {
  lufs: number;
  truePeak: number;
}

const MEASURE_FRAMES = 8192;

// The whole track, read at the rate the desktop measures at, so the two give the same reading.
function measure(file: File): Loudness | null {
  const id = sources.size + 1;
  sources.set(id, new FileSource(file));
  const name = media.stringToNewUTF8(file.name);
  const decoder = media._rm_open(id, name, MEASURE_RATE);
  media._free(name);
  if (!decoder) {
    sources.delete(id);
    return null;
  }

  const pointer = media._malloc(MEASURE_FRAMES * 8);
  const meter = new LoudnessMeter(MEASURE_RATE);
  try {
    for (;;) {
      const got = media._rm_read_pcm(decoder, pointer, MEASURE_FRAMES);
      if (got <= 0) break;
      meter.add(media.HEAPF32.subarray(pointer >> 2, (pointer >> 2) + got * 2), got);
    }
  } finally {
    media._free(pointer);
    media._rm_close(decoder);
    sources.delete(id);
  }
  const lufs = meter.integratedLufs;
  return meter.hasSignal && Number.isFinite(lufs) ? { lufs, truePeak: meter.truePeak } : null;
}

export interface Fingerprint {
  // The compressed form, which AcoustID reads.
  text: string;
  // The sub-fingerprints, signed, which the rpm database matches on.
  raw: number[];
  seconds: number;
}

// The mount is its own, because a canonical copy holds /in across an await and messages can overlap there.
function fingerprint(file: File): Fingerprint {
  media.FS.mount(media.WORKERFS, { files: [file] }, '/print');
  const path = media.stringToNewUTF8(`/print/${file.name}`);
  try {
    const made = media._rm_fingerprint(path);
    if (!made) throw new Error(lastError());
    try {
      const at = media._rm_fingerprint_raw(made) >> 2;
      return {
        text: media.UTF8ToString(media._rm_fingerprint_text(made)),
        raw: Array.from(media.HEAP32.subarray(at, at + media._rm_fingerprint_frames(made))),
        seconds: media._rm_fingerprint_seconds(made),
      };
    } finally {
      media._rm_fingerprint_close(made);
    }
  } finally {
    media._free(path);
    media.FS.unmount('/print');
  }
}

const RENDITION_RATE = 44100;

function encode(file: File, kilobits: number, seconds: number, start = 0): Uint8Array {
  const id = sources.size + 1;
  sources.set(id, new FileSource(file));
  const name = media.stringToNewUTF8(file.name);
  const decoder = media._rm_open(id, name, RENDITION_RATE);
  media._free(name);
  if (!decoder) {
    sources.delete(id);
    throw new Error(lastError());
  }

  const path = '/out/rendition.m4a';
  const out = media.stringToNewUTF8(path);
  try {
    if (start > 0 && media._rm_seek(decoder, start) < 0) throw new Error(lastError());
    const result = media._rm_encode(decoder, out, kilobits, seconds);
    if (result !== 0) throw new Error(lastError());
    return media.FS.readFile(path);
  } finally {
    media._free(out);
    media._rm_close(decoder);
    sources.delete(id);
    try {
      media.FS.unlink(path);
    } catch {
      // It was never written.
    }
  }
}

self.onmessage = async ({ data }: MessageEvent<ToImportWorker>) => {
  try {
    switch (data.type) {
      case 'tags':
        postMessage({ id: data.id, result: await readTags(data.file) });
        break;
      case 'art':
        postMessage({ id: data.id, result: await readArt(data.file) });
        break;
      case 'canonical': {
        const result = await canonical(data.file, data.extension);
        postMessage({ id: data.id, result }, { transfer: [result.bytes.buffer as ArrayBuffer] });
        break;
      }
      case 'loudness':
        postMessage({ id: data.id, result: measure(data.file) });
        break;
      case 'fingerprint':
        postMessage({ id: data.id, result: fingerprint(data.file) });
        break;
      case 'clip': {
        const clip = encode(data.file, data.kilobits, data.seconds, data.start);
        postMessage({ id: data.id, result: clip }, { transfer: [clip.buffer as ArrayBuffer] });
        break;
      }
      case 'renditions': {
        const head = encode(data.file, data.headKilobits, data.headSeconds);
        const rendition = encode(data.file, data.kilobits, 0);
        postMessage({ id: data.id, result: { head, rendition } }, { transfer: [head.buffer as ArrayBuffer, rendition.buffer as ArrayBuffer] });
        break;
      }
    }
  } catch (error) {
    postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) });
  }
};

postMessage({ ready: true });
