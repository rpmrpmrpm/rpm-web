import { describe, expect, it } from 'vitest';

import { endSetup, keepStep, openingStep, stepNumber } from '../../src/views/setup/setup';

function memory() {
  const held = new Map<string, string>();
  return {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => void held.set(key, value),
    removeItem: (key: string) => void held.delete(key),
    held,
  };
}

describe('the setup', () => {
  it('opens on the welcome for an account with an empty library', () => {
    expect(openingStep(memory(), memory(), 'u1', true)).toBe('hello');
  });

  it('is not shown to a listener who has music already', () => {
    expect(openingStep(memory(), memory(), 'u1', false)).toBeNull();
  });

  it('is shown once per account in this browser, finished or skipped', () => {
    const store = memory();
    const tab = memory();
    endSetup(store, tab, 'u1');
    expect(openingStep(store, tab, 'u1', true)).toBeNull();
    expect(openingStep(store, tab, 'u2', true)).toBe('hello');
  });

  it('goes on from the step it was on after the page reloads for a new language', () => {
    const tab = memory();
    keepStep(tab, 'region');
    expect(openingStep(memory(), tab, 'u1', true)).toBe('region');
    keepStep(tab, 'look');
    // Music may have arrived by then: the setup is still finished.
    expect(openingStep(memory(), tab, 'u1', false)).toBe('look');
  });

  it('forgets the step when it ends, and ignores a step it does not know', () => {
    const store = memory();
    const tab = memory();
    keepStep(tab, 'layout');
    endSetup(store, tab, 'u1');
    expect(tab.held.size).toBe(0);
    tab.setItem('rpm-setup-step', 'account');
    expect(openingStep(memory(), tab, 'u1', false)).toBeNull();
  });

  it('is shown when there is no storage, rather than failing', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(openingStep(broken, broken, 'u1', true)).toBe('hello');
    expect(() => endSetup(broken, broken, 'u1')).not.toThrow();
  });

  it('numbers its five steps from one', () => {
    expect(stepNumber('region')).toBe(1);
    expect(stepNumber('done')).toBe(5);
  });
});
