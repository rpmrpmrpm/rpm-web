import { describe, expect, it } from 'vitest';

import { tidy, type MenuEntry } from '../../src/views/menu/entries';

const item = (label: string): MenuEntry => ({ label });

describe('a menu', () => {
  it('keeps a rule between two groups', () => {
    const entries = [item('a'), 'rule', item('b')] as MenuEntry[];
    expect(tidy(entries)).toEqual(entries);
  });

  it('takes a rule away with the group it stood beside', () => {
    expect(tidy(['rule', item('a'), 'rule', 'rule', item('b'), 'rule'])).toEqual([item('a'), 'rule', item('b')]);
  });

  it('is empty when there is nothing to offer', () => {
    expect(tidy(['rule', 'rule'])).toEqual([]);
  });
});
