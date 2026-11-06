// How loud to play a track. A mistake here is silent: a badly levelled track plays at the wrong volume
// and nothing reports an error. This follows ReplayGain and Normalization in the desktop and phone apps.

import type { CloudTrack } from '../api/wire';

export const REFERENCE_LUFS = -18;
export const PEAK_CEILING_DB = -1;
export const MAX_GAIN_DB = 15;

export type NormalizeMode = 'off' | 'album' | 'track';

export interface Level {
  lufs: number | null;
  truePeak: number | null;
}

export const UNKNOWN_LEVEL: Level = { lufs: null, truePeak: null };

// Zero means "not measured" in both fields, so zero is not used as a number here.
export function levelOf(track: CloudTrack): Level {
  const tags = track.tags;
  if (!tags) return UNKNOWN_LEVEL;
  return { lufs: tags.loudnessLufs ? tags.loudnessLufs : null, truePeak: tags.truePeak ? tags.truePeak : null };
}

export function gainDbFor(level: Level, target = REFERENCE_LUFS): number {
  if (level.lufs === null || !Number.isFinite(level.lufs)) return 0;
  const wanted = target - level.lufs;
  const capped = Math.min(Math.max(wanted, -MAX_GAIN_DB), MAX_GAIN_DB);
  const peak = level.truePeak;
  if (peak === null || peak <= 0 || !Number.isFinite(peak)) return capped;

  // The room left under the ceiling. It only ever reduces a gain: the ceiling is a limit, not a target.
  return Math.min(capped, PEAK_CEILING_DB - 20 * Math.log10(peak));
}

export const linear = (gainDb: number): number => (Number.isFinite(gainDb) ? 10 ** (gainDb / 20) : 1);

// Loudness does not average in decibels, so this is the mean of the mean squares, weighted by length.
export function albumLufs(tracks: readonly { lufs: number; seconds: number }[]): number {
  let sum = 0;
  let weight = 0;
  for (const track of tracks) {
    if (!Number.isFinite(track.lufs)) continue;
    const length = track.seconds > 0 ? track.seconds : 1;
    sum += 10 ** (track.lufs / 10) * length;
    weight += length;
  }
  return weight > 0 ? 10 * Math.log10(sum / weight) : -Infinity;
}

export function levelOfRecord(tracks: readonly CloudTrack[]): Level {
  const readings = tracks.flatMap((track) => {
    const lufs = track.tags?.loudnessLufs;
    return lufs ? [{ lufs, seconds: track.tags?.durationSeconds ?? 0 }] : [];
  });
  if (readings.length === 0) return UNKNOWN_LEVEL;
  const peaks = tracks.map((track) => track.tags?.truePeak ?? 0).filter((peak) => peak > 0);
  return { lufs: albumLufs(readings), truePeak: peaks.length ? Math.max(...peaks) : null };
}

// Album gain in album order, track gain on shuffle: the quiet song on a record is meant to be quiet in
// its place, but between two other songs it is just a quiet song. Album mode falls back to the track's
// own measurement, so a partly measured library still plays evenly.
export function gainFor(mode: NormalizeMode, inAlbumOrder: boolean, track: Level, record: Level): number {
  if (mode === 'off') return 1;
  if (mode === 'album' && inAlbumOrder && record.lufs !== null && Number.isFinite(record.lufs)) {
    return linear(gainDbFor(record));
  }
  return track.lufs === null ? 1 : linear(gainDbFor(track));
}
