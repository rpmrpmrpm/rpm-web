import { describe, expect, it } from 'vitest';

import { accents, type Rgb } from '../../src/design/palette.generated';
import { contrast, footOf, hueOf, lookOf, roomed, scatter, seedOf, trioOf } from '../../src/library/list-look';

// The same cases as the phone app's GeneratedListLookTests, so the three apps are held to one answer.

const accent = (name: string): Rgb => accents.find((entry) => entry.name === name)!.base;
const foot = (name: string): Rgb => accents.find((entry) => entry.name === name)!.gradient.at(-1)!;

describe('the seed', () => {
  it('gives the two heart lists one seed', () => {
    expect(seedOf(hueOf('FavoriteTracks')!, null, 0)).toBe(9778);
    expect(seedOf(hueOf('LovedAndForgotten')!, null, 0)).toBe(9778);
  });

  it('keeps the hue when a genre moves everything else', () => {
    const plain = seedOf(5, null, 0);
    const rock = seedOf(5, 'Rock', 0);
    expect(rock).not.toBe(plain);
    expect(rock % accents.length).toBe(5);
  });

  it('scatters decades rather than adding them', () => {
    expect(Math.abs(seedOf(5, null, 1960) - seedOf(5, null, 1970))).toBeGreaterThan(10);
  });

  it('hashes an empty name to the FNV offset', () => {
    expect(scatter('')).toBe(2166136261 % 4096);
  });
});

describe('the trio', () => {
  it('rolls red, crimson and magenta for the heart lists', () => {
    expect(trioOf(9778)).toEqual({ hot: accent('Magenta'), mid: accent('Crimson'), deep: accent('Red') });
  });

  it('sorts by light and not by the ring', () => {
    expect(trioOf(9774)).toEqual({ hot: accent('Lime'), mid: accent('Azure'), deep: accent('Forest') });
  });
});

describe('the inks', () => {
  it('sets the heart lists in crimson on the foot of red, as the desktop measured', () => {
    const look = lookOf('FavoriteTracks', null, 0)!;
    expect(look.border).toEqual(foot('Red'));
    expect(look.text).toEqual(accent('Crimson'));
    expect(contrast(look.text, look.border)).toBeCloseTo(3.15, 2);
  });

  it('sets New to you in lime on the foot of forest', () => {
    const look = lookOf('FirstListens', null, 0)!;
    expect(look.border).toEqual(foot('Forest'));
    expect(look.text).toEqual(accent('Lime'));
    expect(contrast(look.text, look.border)).toBeCloseTo(9.87, 2);
  });

  it('takes the border from the palette ramp, or 40% where there is none', () => {
    for (const entry of accents) expect(footOf(entry.base)).toEqual(entry.gradient.at(-1));
    expect(footOf([200, 100, 50])).toEqual([80, 40, 20]);
  });

  it('washes a whole mood in its own hue', () => {
    for (const kind of ['Calm', 'Energetic', 'Danceable', 'Decade', 'Classical', 'MostPlayed']) {
      expect(lookOf(kind, null, 0)!.tint).toEqual(accents[hueOf(kind)!]!.base);
    }
  });
});

describe('the kinds', () => {
  it('puts five lists on the room', () => {
    for (const kind of ['RightNow', 'OnRepeat', 'FavoriteTracks', 'FirstListens', 'LovedAndForgotten']) expect(roomed(kind)).toBe(true);
    for (const kind of ['Calm', 'Decade', 'MostPlayed', 'LateNight', 'NeverPlayed']) expect(roomed(kind)).toBe(false);
  });

  it('has no look for a kind it does not know', () => {
    expect(lookOf('SomethingNewer', null, 0)).toBeNull();
  });
});
