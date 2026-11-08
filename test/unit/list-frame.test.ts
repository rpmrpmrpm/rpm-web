import { describe, expect, it } from 'vitest';

import { anchorOf, lettering, type Ink } from '../../src/library/list-frame';

// A font where every letter is half the size wide, and ink runs from 0.7 of the size above the line to 0.2 below.
const plain = (said: string, size: number): Ink => ({ left: 0.05 * size, width: 0.5 * size * said.length, top: -0.7 * size, bottom: 0.2 * size });

describe('the name in the band', () => {
  it('sets every name at the size the gauge fills the band at', () => {
    const edge = 500;
    const set = lettering('Chill', edge, plain)!;
    // The band is 8% of the edge, and the gauge is 0.9 of the size tall.
    expect(set.size).toBeCloseTo((edge * 0.08) / 0.9, 6);
    expect(lettering('Loved and forgotten', edge, plain)!.size).toBeGreaterThan(0);
  });

  it('cancels the left bearing and centres the gauge on the band', () => {
    const set = lettering('Chill', 500, plain)!;
    expect(set.alongBand).toBeCloseTo(-0.05 * set.size, 6);
    expect(set.acrossBand).toBeCloseTo(-((-0.7 + 0.2) / 2) * set.size, 6);
  });

  it('sets a long name smaller so it stops before the corner', () => {
    const edge = 500;
    const name = 'A very long list name that runs past the corner';
    const set = lettering(name, edge, plain)!;
    expect(plain(name, set.size).width).toBeCloseTo(edge * 0.8375, 6);
  });

  it('draws no name in a font that measures nothing', () => {
    expect(lettering('Chill', 500, () => ({ left: 0, width: 0, top: 0, bottom: 0 }))).toBeNull();
    expect(lettering('', 500, plain)).toBeNull();
  });

  it('anchors on the band, near the top', () => {
    expect(anchorOf(1000)).toEqual({ x: 908.13, y: 37.5 });
  });
});
