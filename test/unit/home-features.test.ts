import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../src/api/http';
import { ArtistArt } from '../../src/library/artist-art';
import { bannerLayout, chooseQuickPicks, FEATURE_COUNT, featureStrip, inPanels, type FeatureSources } from '../../src/library/home-features';

const sources = (changes: Partial<FeatureSources> = {}): FeatureSources => ({
  continued: [],
  added: [],
  suggested: [],
  played: [],
  listened: [],
  isVarious: () => false,
  ...changes,
});

describe('the banner', () => {
  it('gives every question a card before any gets a second', () => {
    const strip = featureStrip(sources({ continued: ['was-on'], added: ['new1', 'new2'], suggested: ['like1'], played: ['most1'], listened: ['heard1'] }));
    expect(strip.slice(0, 5).map((card) => card.kind)).toEqual(['continue', 'added', 'suggested', 'played', 'listened']);
  });

  it('deals the record that was on last first', () => {
    const strip = featureStrip(sources({ continued: ['was-on'], added: ['was-on'], played: ['was-on'], listened: ['was-on'] }), 4);
    expect(strip).toEqual([{ kind: 'continue', key: 'was-on' }]);
  });

  it('features a record once, and moves past it to the next', () => {
    const strip = featureStrip(sources({ suggested: ['shared'], played: ['shared', 'other'], listened: ['shared'] }));
    expect(strip.map((card) => card.key)).toEqual(['shared', 'other']);
  });

  it('fills a new collection from what arrived last', () => {
    const added = Array.from({ length: 10 }, (_, index) => `new${index}`);
    expect(featureStrip(sources({ added }))).toHaveLength(FEATURE_COUNT);
  });

  it('never features a compilation, and offers the next answer instead', () => {
    const strip = featureStrip(sources({ continued: ['va'], added: ['va', 'act'], isVarious: (key) => key === 'va' }));
    expect(strip).toEqual([{ kind: 'added', key: 'act' }]);
  });

  it('ends on a collection too small to fill it', () => {
    expect(featureStrip(sources())).toEqual([]);
  });

  it('stops growing the plate at its widest, and the rest is neighbours', () => {
    const layout = bannerLayout(1400);
    expect(layout.plate).toBe(760);
    expect(layout.peek).toBe(344);
    expect(layout.slide).toBe(180);
  });

  it('gives the plate the whole strip where there is no room for neighbours', () => {
    expect(bannerLayout(420)).toMatchObject({ plate: 420, peek: 0 });
  });

  it('moves far enough to be seen on a narrow strip', () => {
    expect(bannerLayout(100).slide).toBe(60);
  });
});

describe('the quick selection', () => {
  const noRecord = () => null;

  it('deals one of each kind in turn', () => {
    expect(chooseQuickPicks(['s1', 's2'], ['a1', 'a2'], noRecord)).toEqual([
      { kind: 'song', key: 's1' },
      { kind: 'album', key: 'a1' },
      { kind: 'song', key: 's2' },
      { kind: 'album', key: 'a2' },
    ]);
  });

  it('gives a collection that only has songs nothing but songs', () => {
    expect(chooseQuickPicks(['s1', 's2'], [], noRecord).map((pick) => pick.key)).toEqual(['s1', 's2']);
  });

  it('stops at the count', () => {
    expect(chooseQuickPicks(['s1', 's2', 's3'], [], noRecord, 2)).toHaveLength(2);
  });

  it('offers each record once, and the next entry takes its place', () => {
    const recordOf = ({ key }: { key: string }) => key.replace(/\d/, '').slice(0, 1) === 'x' ? 'same' : key;
    expect(chooseQuickPicks(['x1', 'x2', 'y'], ['x3', 'z'], recordOf).map((pick) => pick.key)).toEqual(['x1', 'z', 'y']);
  });

  it('steps past an empty key without losing the turn of its kind', () => {
    expect(chooseQuickPicks(['', 's1'], [], noRecord).map((pick) => pick.key)).toEqual(['s1']);
  });

  it('reads down each panel, then across', () => {
    expect(inPanels([1, 2, 3, 4, 5, 6])).toEqual([[1, 2, 3, 4], [5, 6]]);
    expect(inPanels([])).toEqual([]);
  });
});

describe('an act\'s pictures', () => {
  const art = (json: (path: string) => Promise<unknown>) =>
    new ArtistArt({ json: vi.fn(async (path: string, read: (raw: unknown) => unknown) => read(await json(path))) } as never, async (address) => `signed/${address}`);

  it('asks by the act\'s name, and hands back an address in rpm\'s own store', async () => {
    const json = vi.fn(async () => ({ backgrounds: ['wide.jpg'], thumbs: ['square.jpg'] }));
    expect(await art(json).photo('Manu Chao')).toBe('signed/wide.jpg');
    expect(json).toHaveBeenCalledWith('artwork?artist=Manu%20Chao');
  });

  it('falls back on a thumb', async () => {
    expect(await art(async () => ({ backgrounds: [], thumbs: ['square.jpg'] })).photo('A')).toBe('signed/square.jpg');
  });

  it('has nothing to show for an act with no pictures', async () => {
    expect(await art(async () => ({ backgrounds: [], thumbs: [] })).photo('A')).toBeNull();
  });

  it('asks once per act', async () => {
    const json = vi.fn(async () => ({ backgrounds: ['a.jpg'] }));
    const pictures = art(json);
    await pictures.photo('Manu Chao');
    await pictures.photo('MANU CHAO ');
    expect(json).toHaveBeenCalledTimes(1);
  });

  it('asks again after no answer, because that is not "no picture"', async () => {
    const json = vi.fn(async () => ({ backgrounds: ['a.jpg'] }));
    json.mockRejectedValueOnce(new ApiError(503, 'still asking'));
    const pictures = art(json);
    expect(await pictures.photo('A')).toBeNull();
    expect(await pictures.photo('A')).toBe('signed/a.jpg');
  });
});
