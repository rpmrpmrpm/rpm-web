import { describe, expect, it } from 'vitest';

import { FREE, offerFor, ORIGINAL, settles, storedRate, storeRate, WHOLE } from '../../src/audio/ladder';

function memory() {
  const held = new Map<string, string>();
  return { getItem: (key: string) => held.get(key) ?? null, setItem: (key: string, value: string) => void held.set(key, value), held };
}

describe('the streaming rate', () => {
  it('is the original for a supporter or tester who never chose', () => {
    expect(settles(offerFor(true), storedRate(memory()))).toBe(ORIGINAL);
  });

  it('is the original while the plan is not known, and 128 on the free plan', () => {
    expect(offerFor(null)).toBe(WHOLE);
    expect(settles(offerFor(false), storedRate(memory()))).toBe(128);
  });

  it('keeps a supporter\'s choice, gives the free rate while support has lapsed, and the choice again when it is back', () => {
    const store = memory();
    storeRate(store, 192);
    expect(settles(offerFor(true), storedRate(store))).toBe(192);
    expect(settles(offerFor(false), storedRate(store))).toBe(128);
    expect(settles(offerFor(true), storedRate(store))).toBe(192);
  });

  it('reads a rate that is not on the ladder as the original', () => {
    const store = memory();
    store.setItem('rpm-stream-kilobits', '1000');
    expect(storedRate(store)).toBe(ORIGINAL);
    expect(storedRate(null)).toBe(ORIGINAL);
  });

  it('offers the free plan one rung, greyed out', () => {
    expect(FREE).toEqual({ rungs: [128], capped: true });
    expect(WHOLE.rungs[0]).toBe(ORIGINAL);
  });
});

describe('the quality the listener chooses', () => {
  it('is kept, tells its listeners, and refuses a rate that is not on the ladder', async () => {
    const { StreamQuality } = await import('../../src/audio/ladder');
    const store = memory();
    const quality = new StreamQuality(store);
    let told = 0;
    quality.onChange(() => told++);
    expect(quality.choice).toBe(ORIGINAL);
    quality.choose(256);
    quality.choose(256);
    quality.choose(1000);
    expect(quality.choice).toBe(256);
    expect(told).toBe(1);
    expect(new StreamQuality(store).choice).toBe(256);
  });
});
