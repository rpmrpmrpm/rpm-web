import { describe, expect, it } from 'vitest';

import { byteSize } from '../../src/library/bytes';

describe('sizes as people read them', () => {
  it('writes sizes as the desktop does: 1,024 to a unit, no decimals below a megabyte', () => {
    expect(byteSize(0)).toBe('0 B');
    expect(byteSize(418 * 1024)).toBe('418 KB');
    expect(byteSize(77.3 * 1024 ** 2)).toBe('77.3 MB');
    expect(byteSize(100 * 1024 ** 3)).toBe('100 GB');
  });
});
