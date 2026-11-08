import { describe, expect, it } from 'vitest';

import { hasAnother, listKey, Readings, windowOf } from '../../src/library/generated-lists';
import type { GeneratedList } from '../../src/library/playlists';

const ids = (count: number) => Array.from({ length: count }, (_, index) => `t${index}`);

function memory(start: Record<string, string> = {}) {
  const held = { ...start };
  return { held, getItem: (key: string) => held[key] ?? null, setItem: (key: string, value: string) => void (held[key] = value) };
}

describe('windowOf', () => {
  it('shows the whole run when it is no longer than one list', () => {
    expect(windowOf(ids(40), 50, 3)).toEqual(ids(40));
    expect(windowOf(ids(50), 50, 1)).toEqual(ids(50));
  });

  it('shows the whole run for a cut that sends no length', () => {
    expect(windowOf(ids(130), 0, 2)).toEqual(ids(130));
  });

  it('steps through slices that do not overlap, and wraps', () => {
    const run = ids(150);
    expect(windowOf(run, 50, 0)).toEqual(run.slice(0, 50));
    expect(windowOf(run, 50, 1)).toEqual(run.slice(50, 100));
    expect(windowOf(run, 50, 2)).toEqual(run.slice(100, 150));
    expect(windowOf(run, 50, 3)).toEqual(run.slice(0, 50));
  });

  it('lets the last slice reach back so it is still a full list', () => {
    const run = ids(130);
    expect(windowOf(run, 50, 2)).toEqual(run.slice(80, 130));
  });

  it('lands a negative reading on a slice', () => {
    const run = ids(150);
    expect(windowOf(run, 50, -1)).toEqual(run.slice(100, 150));
  });
});

describe('the readings', () => {
  const list: GeneratedList = { kind: 'Calm', title: 'Chill', trackIds: ids(100), id: 'calm-id', shows: 50 };

  it('starts every list on its first slice', () => {
    expect(new Readings(memory()).showing(list)).toEqual(ids(100).slice(0, 50));
  });

  it('moves one list on and keeps the count for the next visit', () => {
    const store = memory();
    new Readings(store).step(list);
    expect(new Readings(store).showing(list)).toEqual(ids(100).slice(50, 100));
  });

  it('reads a damaged store as no presses', () => {
    expect(new Readings(memory({ 'rpm.generatedListReadings': 'not json' })).of(list)).toBe(0);
  });

  it('keys a list with no id on what the cut is keyed on', () => {
    expect(listKey({ kind: 'Calm', title: null, trackIds: [], genre: 'Rock', decade: 0 })).toBe('Calm|Rock|0');
  });

  it('offers another list only when the run is longer than one', () => {
    expect(hasAnother(list)).toBe(true);
    expect(hasAnother({ ...list, shows: 0 })).toBe(false);
    expect(hasAnother({ ...list, trackIds: ids(50) })).toBe(false);
  });
});
