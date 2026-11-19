import { describe, expect, it } from 'vitest';

import { isFindKey, usesCommand, type KeyLike } from '../../src/views/search/find-key';

const press = (key: string, held: Partial<KeyLike> = {}): KeyLike => ({ key, code: 'KeyF', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...held });

describe('the key that opens the search over the window', () => {
  it('is Cmd+F on Apple devices and Ctrl+F elsewhere', () => {
    expect(isFindKey(press('f', { metaKey: true }), true)).toBe(true);
    expect(isFindKey(press('f', { ctrlKey: true }), true)).toBe(false);
    expect(isFindKey(press('f', { ctrlKey: true }), false)).toBe(true);
    expect(isFindKey(press('f', { metaKey: true }), false)).toBe(false);
    expect(isFindKey(press('F', { ctrlKey: true }), false)).toBe(true);
  });

  it('leaves the other combinations and the bare letter to the browser and the field', () => {
    expect(isFindKey(press('f'), true)).toBe(false);
    expect(isFindKey(press('f', { metaKey: true, shiftKey: true }), true)).toBe(false);
    expect(isFindKey(press('f', { ctrlKey: true, altKey: true }), false)).toBe(false);
    expect(isFindKey(press('f', { metaKey: true, ctrlKey: true }), true)).toBe(false);
    expect(isFindKey(press('g', { metaKey: true }), true)).toBe(false);
  });

  it("takes the key in F's place on a layout with no Latin letters, and the letter F wherever a Latin layout puts it", () => {
    expect(isFindKey(press('а', { metaKey: true }), true)).toBe(true);
    expect(isFindKey({ ...press('u', { metaKey: true }), code: 'KeyF' }, true)).toBe(false);
    expect(isFindKey({ ...press('f', { metaKey: true }), code: 'KeyY' }, true)).toBe(true);
  });

  it('knows which computers use Cmd', () => {
    expect(usesCommand('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15')).toBe(true);
    expect(usesCommand('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe(true);
    expect(usesCommand('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(false);
    expect(usesCommand('Mozilla/5.0 (X11; Linux x86_64)')).toBe(false);
  });
});
