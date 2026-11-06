// The shapes the cloud sends. Every optional field follows one rule: absent, empty or zero means "not
// known", never "zero". Rows written before the catalogue existed carry few of these fields. Treating
// a missing track number as track 0 puts the track first and draws the album in the wrong order.

import { ApiError } from './http';

export interface CloudTrackTags {
  durationSeconds?: number;
  trackNumber?: number;
  trackCount?: number;
  discNumber?: number;
  discCount?: number;
  year?: number;
  genre?: string | null;
  albumArtist?: string | null;
  extension?: string | null;
  channels?: number;
  sampleRate?: number;
  bitsPerSample?: number;
  bitrateKbps?: number;
  codecDescription?: string | null;
  loudnessLufs?: number | null;
  truePeak?: number | null;
  favorite?: boolean;
  favoritedAt?: number;
  advisory?: number;
  composer?: string | null;
  work?: string | null;
  movementName?: string | null;
}

export interface CloudTrack {
  rpmId: string;
  sha256: string;
  relativePath: string | null;
  originalSize: number;
  title: string | null;
  artist: string | null;
  album: string | null;
  addedAt: number;
  tags: CloudTrackTags | null;
  updatedAt: number;
}

export interface CloudPage {
  tracks: CloudTrack[];
  cursor: string | null;
}

export interface CloudQuota {
  usedBytes: number;
  quotaBytes: number;
  fileCount: number;
  unlimited: boolean;
  tester: boolean;
}

export interface CloudStream {
  url: string;
  kilobits: number;
  live: boolean;
}

function record(raw: unknown, what: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) throw new ApiError(200, `${what} is not an object.`);
  return raw as Record<string, unknown>;
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const number = (value: unknown): number => (typeof value === 'number' ? value : 0);

export function readTrack(raw: unknown): CloudTrack {
  const row = record(raw, 'A track');
  if (typeof row.rpmId !== 'string') throw new ApiError(200, 'A track has no id.');
  return {
    rpmId: row.rpmId,
    sha256: text(row.sha256) ?? '',
    relativePath: text(row.relativePath),
    originalSize: number(row.originalSize),
    title: text(row.title),
    artist: text(row.artist),
    album: text(row.album),
    addedAt: number(row.addedAt),
    tags: row.tags ? (row.tags as CloudTrackTags) : null,
    updatedAt: number(row.updatedAt),
  };
}

export function readPage(raw: unknown): CloudPage {
  const page = record(raw, 'A page of tracks');
  if (!Array.isArray(page.files)) throw new ApiError(200, 'A page of tracks has no files.');
  return { tracks: page.files.map(readTrack), cursor: text(page.cursor) };
}

export function readQuota(raw: unknown): CloudQuota {
  const quota = record(raw, 'The quota');
  if (typeof quota.quotaBytes !== 'number') throw new ApiError(200, 'The quota has no limit.');
  return {
    usedBytes: number(quota.usedBytes),
    quotaBytes: quota.quotaBytes,
    fileCount: number(quota.fileCount),
    unlimited: quota.unlimited === true,
    tester: quota.tester === true,
  };
}

export function readStream(raw: unknown): CloudStream {
  const stream = record(raw, 'A stream');
  if (typeof stream.url !== 'string') throw new ApiError(200, 'A stream has no address.');
  return { url: stream.url, kilobits: number(stream.kilobits), live: stream.live === true };
}

// Whether the track shows the E. The wire carries a number, and 2 means stated to be clean, so "not
// zero" is the wrong question.
export const isExplicit = (track: CloudTrack): boolean => track.tags?.advisory === 1;

export const durationSeconds = (track: CloudTrack): number => Math.max(0, track.tags?.durationSeconds ?? 0);
