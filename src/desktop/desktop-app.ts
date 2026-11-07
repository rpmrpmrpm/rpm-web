// The desktop app, seen from the browser. A page cannot ask whether an app is installed: browsers refuse
// that, because it would tell a site what is on the computer. So the only test is to follow the rpm:// link
// when the person presses Open, and see whether the window loses focus. What that showed is remembered in
// this browser.

export type DesktopPlatform = 'mac' | 'windows';
export type DownloadTarget = 'mac-arm64' | 'mac-x64' | 'mac-x64-macos12' | 'windows';

// A bare link starts the app, or brings it to the front, and asks for nothing else.
export const OPEN_ADDRESS = 'rpm://open';

// Only the Mac app registers rpm:// so far.
export const canOpen = (platform: DesktopPlatform | null): boolean => platform === 'mac';

const KEY = 'rpm-desktop-here';
const WAIT_MS = 2500;
// A prompt from the browser can stay up for a while. Leaving after this long still counts.
const STILL_COUNTS_MS = 60_000;

interface NavigatorLike {
  userAgent: string;
  maxTouchPoints: number;
  userAgentData?: { getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }> };
}

// An iPad reports itself as a Mac, and only its touch points give it away. Phones get no offer.
export function desktopPlatform(browser: NavigatorLike): DesktopPlatform | null {
  if (/Android|iPhone|iPad/.test(browser.userAgent)) return null;
  if (/Macintosh/.test(browser.userAgent)) return browser.maxTouchPoints > 1 ? null : 'mac';
  return /Windows/.test(browser.userAgent) ? 'windows' : null;
}

// The download, when the browser can tell. Safari and Firefox do not say which chip a Mac has, and neither
// does anything say which macOS an Intel Mac runs, so those are asked.
export async function downloadFor(platform: DesktopPlatform, browser: NavigatorLike): Promise<DownloadTarget | null> {
  if (platform === 'windows') return 'windows';
  try {
    const answer = await browser.userAgentData?.getHighEntropyValues?.(['architecture']);
    return answer?.architecture === 'arm' ? 'mac-arm64' : null;
  } catch {
    return null;
  }
}

interface Surroundings {
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  page: Pick<Document, 'addEventListener' | 'removeEventListener' | 'hidden'>;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  wait: (ms: number) => Promise<void>;
}

const browserSurroundings = (): Surroundings => ({
  target: window,
  page: document,
  storage: localStorage,
  wait: (ms) => new Promise((done) => setTimeout(done, ms)),
});

export class DesktopApp {
  private readonly around: Surroundings;

  constructor(around?: Surroundings) {
    this.around = around ?? browserSurroundings();
  }

  get here(): boolean {
    return this.around.storage.getItem(KEY) === 'yes';
  }

  // Call as the link is followed. True when the app came forward. False says only that nothing was seen
  // in time, and a later change is reported through onLate.
  async watch(onLate: () => void): Promise<boolean> {
    const { target, page, storage, wait } = this.around;
    let left = false;
    let answered = false;

    const leaving = () => {
      if (page.hidden === false && !left) return;
      noteLeft();
    };
    const noteLeft = () => {
      left = true;
      storage.setItem(KEY, 'yes');
      if (answered) onLate();
      stop();
    };
    const stop = () => {
      target.removeEventListener('blur', noteLeft);
      page.removeEventListener('visibilitychange', leaving);
    };

    target.addEventListener('blur', noteLeft);
    page.addEventListener('visibilitychange', leaving);

    await wait(WAIT_MS);
    answered = true;
    if (left) return true;

    storage.removeItem(KEY);
    void wait(STILL_COUNTS_MS).then(stop);
    return false;
  }
}
