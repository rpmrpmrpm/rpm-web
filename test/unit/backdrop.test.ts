import { describe, expect, it } from 'vitest';

import { BACKDROPS, effectiveId } from '../../src/design/backdrop.svelte';

describe('which backdrop stands', () => {
  it('is the stored one, and the default for an id this version does not know', () => {
    expect(effectiveId('night', false)).toBe('night');
    expect(effectiveId('from-a-later-version', true)).toBe('');
    expect(effectiveId('', true)).toBe('');
  });

  it('is the default for a supporter backdrop on an account that is not a supporter', () => {
    expect(effectiveId('gold', false)).toBe('');
    expect(effectiveId('gold', true)).toBe('gold');
  });

  it('offers the desktop backdrops, the default first and one for supporters', () => {
    expect(BACKDROPS.map((backdrop) => backdrop.id)).toEqual(['', 'night', 'pegasus', 'sheet-music', 'gold']);
    expect(BACKDROPS.filter((backdrop) => backdrop.supporters).map((backdrop) => backdrop.id)).toEqual(['gold']);
  });
});
