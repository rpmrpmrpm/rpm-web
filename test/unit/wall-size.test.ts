import { afterEach, describe, expect, it, vi } from 'vitest';

import { FIRST_TARGET, keepTarget, LARGEST_TARGET, SMALLEST_TARGET, storedTarget, WALL_GAP, wallColumns } from '../../src/views/library/wall-size';

describe('the card size on the artists and genres walls', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('picks the nearest whole number of columns, not the floor', () => {
    // 1000 wide with a 300 target: 3.2 columns of 314, so three cards a little wider than the target.
    expect(wallColumns(1000, 300)).toBe(3);
    // 1100 wide: 3.55 columns, so four cards a little narrower than the target, not three much wider.
    expect(wallColumns(1100, 300)).toBe(4);
  });

  it('never makes a card narrower than the smallest target', () => {
    const columns = wallColumns(400, SMALLEST_TARGET);
    expect((400 - WALL_GAP * (columns - 1)) / columns).toBeGreaterThanOrEqual(SMALLEST_TARGET);
  });

  it('keeps one column on a narrow or unmeasured wall', () => {
    expect(wallColumns(120, LARGEST_TARGET)).toBe(1);
    expect(wallColumns(0, FIRST_TARGET)).toBe(1);
    expect(wallColumns(Number.NaN, FIRST_TARGET)).toBe(1);
  });

  it('reads back a size it kept, and the first size for anything else', () => {
    const held = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => held.get(key) ?? null, setItem: (key: string, value: string) => held.set(key, value) });
    expect(storedTarget('size')).toBe(FIRST_TARGET);
    keepTarget('size', 412);
    expect(storedTarget('size')).toBe(412);
    held.set('size', '9000');
    expect(storedTarget('size')).toBe(FIRST_TARGET);
  });

  it('gives the first size when the browser refuses to read', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
    });
    expect(storedTarget('size')).toBe(FIRST_TARGET);
  });
});
