import { describe, expect, it } from 'vitest';

import { readTrack } from '../../src/api/wire';
import { albumLufs, gainDbFor, gainFor, levelOf, levelOfRecord, linear } from '../../src/audio/level';

const track = (lufs: number, truePeak = 0, durationSeconds = 100) =>
  readTrack({ rpmId: 'a', tags: { loudnessLufs: lufs, truePeak, durationSeconds } });

describe('the gain of a track', () => {
  it('brings a measurement to -18 LUFS', () => {
    expect(gainDbFor({ lufs: -12, truePeak: null })).toBeCloseTo(-6);
    expect(gainDbFor({ lufs: -22, truePeak: null })).toBeCloseTo(4);
  });

  it('limits the gain to 15 dB both ways', () => {
    expect(gainDbFor({ lufs: -50, truePeak: null })).toBeCloseTo(15);
    expect(gainDbFor({ lufs: 5, truePeak: null })).toBeCloseTo(-15);
  });

  it('holds a boost back so the peak stays under the ceiling', () => {
    // Peak at -3 dBTP leaves 2 dB under the ceiling of -1.
    expect(gainDbFor({ lufs: -24, truePeak: 10 ** (-3 / 20) })).toBeCloseTo(2);
  });

  it('does not raise a quiet track to the ceiling', () => {
    expect(gainDbFor({ lufs: -20, truePeak: 0.1 })).toBeCloseTo(2);
  });

  it('turns a track already over the ceiling down', () => {
    expect(gainDbFor({ lufs: -18, truePeak: 1 })).toBeCloseTo(-1);
  });

  it('leaves a track that was not measured alone', () => {
    expect(gainDbFor({ lufs: null, truePeak: null })).toBe(0);
    expect(levelOf(readTrack({ rpmId: 'a' })).lufs).toBeNull();
    expect(levelOf(track(0)).lufs).toBeNull();
  });

  it('makes dB into a factor', () => {
    expect(linear(-6)).toBeCloseTo(0.501, 3);
    expect(linear(0)).toBe(1);
  });
});

describe('the level of a record', () => {
  it('does not average in decibels', () => {
    expect(albumLufs([{ lufs: -10, seconds: 100 }, { lufs: -30, seconds: 100 }])).toBeCloseTo(-12.96, 1);
  });

  it('weights a track by its length', () => {
    const interlude = albumLufs([{ lufs: -10, seconds: 600 }, { lufs: -30, seconds: 40 }]);
    expect(interlude).toBeGreaterThan(-10.5);
  });

  it('skips tracks that were not measured', () => {
    const level = levelOfRecord([track(-14, 0.8), readTrack({ rpmId: 'b' })]);
    expect(level.lufs).toBeCloseTo(-14);
    expect(level.truePeak).toBe(0.8);
  });
});

describe('which gain is played', () => {
  const quiet = { lufs: -24, truePeak: null };
  const record = { lufs: -14, truePeak: null };

  it('uses the record in album order and the track on shuffle', () => {
    expect(gainFor('album', true, quiet, record)).toBeCloseTo(linear(-4));
    expect(gainFor('album', false, quiet, record)).toBeCloseTo(linear(6));
  });

  it('falls back to the track when the record is not measured', () => {
    expect(gainFor('album', true, quiet, { lufs: null, truePeak: null })).toBeCloseTo(linear(6));
  });

  it('does nothing when off, or with nothing measured', () => {
    expect(gainFor('off', true, quiet, record)).toBe(1);
    expect(gainFor('track', true, { lufs: null, truePeak: null }, record)).toBe(1);
  });
});
