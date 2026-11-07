import { describe, expect, it, vi } from 'vitest';

import { canOpen, desktopPlatform, DesktopApp, downloadFor } from '../../src/desktop/desktop-app';
import { taglineParts } from '../../src/views/shell/tagline';

const browser = (userAgent: string, maxTouchPoints = 0, architecture?: string) => ({
  userAgent,
  maxTouchPoints,
  userAgentData: architecture ? { getHighEntropyValues: async () => ({ architecture }) } : undefined,
});

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0';

describe('which computer this is', () => {
  it.each([
    [MAC, 0, 'mac'],
    [MAC, 5, null],
    [WINDOWS, 0, 'windows'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5, null],
    ['Mozilla/5.0 (Linux; Android 15)', 5, null],
    ['Mozilla/5.0 (X11; Linux x86_64)', 0, null],
  ])('%s with %i touch points is %s', (userAgent, touch, expected) => {
    expect(desktopPlatform(browser(userAgent, touch))).toBe(expected);
  });

  it('only the Mac app can be opened by link so far', () => {
    expect(canOpen('mac')).toBe(true);
    expect(canOpen('windows')).toBe(false);
    expect(canOpen(null)).toBe(false);
  });
});

describe('which download', () => {
  it('goes straight to the download where the browser can tell', async () => {
    expect(await downloadFor('windows', browser(WINDOWS))).toBe('windows');
    expect(await downloadFor('mac', browser(MAC, 0, 'arm'))).toBe('mac-arm64');
  });

  it('asks when it cannot', async () => {
    expect(await downloadFor('mac', browser(MAC))).toBeNull();
    expect(await downloadFor('mac', browser(MAC, 0, 'x86'))).toBeNull();
  });

  it('asks when the browser refuses to say', async () => {
    const refusing = { ...browser(MAC), userAgentData: { getHighEntropyValues: () => Promise.reject(new Error('no')) } };
    expect(await downloadFor('mac', refusing)).toBeNull();
  });
});

function surroundings() {
  const target = new EventTarget();
  const page = Object.assign(new EventTarget(), { hidden: false });
  const kept = new Map<string, string>();
  const waits: { ms: number; go: () => void }[] = [];
  const app = new DesktopApp({
    target: target as unknown as Window,
    page: page as unknown as Document,
    storage: {
      getItem: (key) => kept.get(key) ?? null,
      setItem: (key, value) => void kept.set(key, value),
      removeItem: (key) => void kept.delete(key),
    },
    wait: (ms) => new Promise((go) => waits.push({ ms, go })),
  });
  return { target, page, app, waits, kept };
}

describe('opening the app', () => {
  it('counts the window losing focus as the app coming forward, and remembers it', async () => {
    const { target, app, waits } = surroundings();
    const opened = app.watch(() => {});
    target.dispatchEvent(new Event('blur'));
    waits[0]!.go();
    expect(await opened).toBe(true);
    expect(app.here).toBe(true);
  });

  it('counts the page being hidden too', async () => {
    const { page, app, waits } = surroundings();
    const opened = app.watch(() => {});
    page.hidden = true;
    page.dispatchEvent(new Event('visibilitychange'));
    waits[0]!.go();
    expect(await opened).toBe(true);
  });

  it('forgets an app that no longer answers', async () => {
    const { target, app, waits } = surroundings();
    const first = app.watch(() => {});
    target.dispatchEvent(new Event('blur'));
    waits[0]!.go();
    await first;

    const second = app.watch(() => {});
    waits[1]!.go();
    expect(await second).toBe(false);
    expect(app.here).toBe(false);
  });

  it('still counts leaving after the wait, for a prompt that stayed up', async () => {
    const { target, app, waits } = surroundings();
    const late = vi.fn();
    const opened = app.watch(late);
    waits[0]!.go();
    expect(await opened).toBe(false);

    target.dispatchEvent(new Event('blur'));
    expect(late).toHaveBeenCalledOnce();
    expect(app.here).toBe(true);
  });

  it('stops listening once the late wait is over', async () => {
    const { target, app, waits } = surroundings();
    const late = vi.fn();
    const opened = app.watch(late);
    waits[0]!.go();
    await opened;
    await Promise.resolve();
    waits[1]!.go();
    await new Promise((done) => setTimeout(done));

    target.dispatchEvent(new Event('blur'));
    expect(late).not.toHaveBeenCalled();
    expect(app.here).toBe(false);
  });
});

describe('the tagline', () => {
  it('dims the prefix with its hyphen', () => {
    expect(taglineParts('re-discover your music collection')).toEqual({ head: 're-', tail: 'discover your music collection' });
  });

  it('dims a prefix spelled into the word', () => {
    expect(taglineParts('redécouvrez votre musique')).toEqual({ head: 're', tail: 'découvrez votre musique' });
  });

  it('leaves other languages in one tone', () => {
    expect(taglineParts('重新发现你的音乐收藏')).toEqual({ head: '', tail: '重新发现你的音乐收藏' });
  });
});
