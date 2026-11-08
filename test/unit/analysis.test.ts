import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../src/api/http';
import { keyName, keysOf, Readings, readingOf } from '../../src/library/analysis';

const SHA = 'AB'.repeat(32);
const fact = (field: string, generation: number, value: object, modelled = false) => ({ field, generation, value: JSON.stringify(value), modelled });

describe('a key', () => {
  it('is named from its Camelot code as a key tag names it', () => {
    expect(keyName('8A')).toBe('Am');
    expect(keyName('8B')).toBe('C');
    expect(keyName('12b')).toBe('E');
    expect(keyName('13A')).toBeNull();
    expect(keyName('nonsense')).toBeNull();
  });
});

describe('the names a track is asked by', () => {
  it('are the file hash and the id, as the pool writes them', () => {
    expect(keysOf({ rpmId: 'ABC-1', sha256: SHA })).toEqual([`canon:${SHA.toLowerCase()}`, 'rpm:abc-1']);
    expect(keysOf({ rpmId: 'a', sha256: 'short' })).toEqual(['rpm:a']);
  });
});

describe('a reading', () => {
  it('takes the key, the tempo, the beat grid and the energy, with numbers written as text', () => {
    const reading = readingOf([
      fact('key', 1, { camelot: '8A', confidence: '0.73' }),
      fact('grid', 10, { bpm: '123.9', bpmConfidence: '0.9', beats: '0.5,1,1.5', firstDownbeat: '1', downbeatConfidence: '0.6', beatsPerBar: '4' }, true),
      fact('energy', 1, { curve: '0.1,0.2', intensity: '0.81' }),
    ]);
    expect(reading).toEqual({
      camelot: '8A', keyName: 'Am', keyConfidence: 0.73, bpm: 123.9, bpmConfidence: 0.9,
      beatsPerBar: 4, firstDownbeat: 1, downbeatConfidence: 0.6, energy: 0.81, modelled: true,
    });
  });

  it('leaves out a fact of another generation, and a grid with no beats', () => {
    const reading = readingOf([fact('grid', 9, { bpm: '120' }), fact('key', 1, { camelot: '1B', confidence: '0.1' })]);
    expect(reading?.bpm).toBeNull();
    expect(reading?.camelot).toBe('1B');
    expect(readingOf([fact('grid', 10, { bpm: '120', beats: '' })])?.beatsPerBar).toBeNull();
  });

  it('is nothing when the pool knows nothing this reader understands', () => {
    expect(readingOf([])).toBeNull();
    expect(readingOf([fact('level', 1, { lufs: '-9' })])).toBeNull();
    expect(readingOf([{ field: 'key', generation: 1, value: 'not json' }])).toBeNull();
  });
});

describe('asking the pool', () => {
  it('asks by both names and reads the answer', async () => {
    const json = vi.fn(async (_: string, read: (raw: unknown) => unknown) => read({ facts: [fact('energy', 1, { intensity: '0.5' })] }));
    const reading = await new Readings({ json } as never).of({ rpmId: 'a', sha256: SHA });
    expect(json.mock.calls[0]![0]).toBe(`recordings/facts?key=${encodeURIComponent(`canon:${SHA.toLowerCase()}`)}&key=rpm%3Aa`);
    expect(reading?.energy).toBe(0.5);
  });

  it('lets a failed call through rather than reading it as nothing known', async () => {
    const json = vi.fn(async () => {
      throw new ApiError(500, 'no');
    });
    await expect(new Readings({ json } as never).of({ rpmId: 'a', sha256: SHA })).rejects.toThrow();
  });
});
