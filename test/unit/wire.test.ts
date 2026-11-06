import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ApiError } from '../../src/api/http';
import { durationSeconds, isExplicit, readPage, readQuota, readStream, readTrack } from '../../src/api/wire';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

describe('the wire shapes', () => {
  it('reads a page of the real list', () => {
    const page = readPage(fixture('cloud-list.json'));
    expect(page.tracks.length).toBeGreaterThan(0);
    const track = page.tracks[0]!;
    expect(track.rpmId).toBe('072008a6-107f-4773-9de7-eec47e22c83f');
    expect(track.title).toBe('Aniron (I Desire)');
    expect(track.tags?.trackNumber).toBe(2);
    expect(durationSeconds(track)).toBeCloseTo(163.39, 1);
  });

  it('reads a row with nothing but an id, as an old row is', () => {
    const track = readTrack({ rpmId: 'abc' });
    expect(track).toMatchObject({ sha256: '', title: null, tags: null, addedAt: 0, updatedAt: 0 });
    expect(durationSeconds(track)).toBe(0);
  });

  it('refuses a row with no id, because a row with no id cannot be played or listed', () => {
    expect(() => readTrack({ title: 'x' })).toThrow(ApiError);
  });

  it('does not read a broken answer as an empty library', () => {
    expect(() => readPage({ message: 'oops' })).toThrow(ApiError);
    expect(() => readQuota({})).toThrow(ApiError);
    expect(() => readStream({})).toThrow(ApiError);
  });

  it('reads the quota, free and tester', () => {
    expect(readQuota(fixture('cloud-quota.json'))).toMatchObject({ fileCount: 4210, tester: false });
    expect(readQuota(fixture('cloud-quota-tester.json')).quotaBytes).toBeGreaterThan(0);
  });

  it('shows the E only for explicit, not for a record stated to be clean', () => {
    const track = (advisory: number) => readTrack({ rpmId: 'a', tags: { advisory } });
    expect(isExplicit(track(0))).toBe(false);
    expect(isExplicit(track(1))).toBe(true);
    expect(isExplicit(track(2))).toBe(false);
  });
});
