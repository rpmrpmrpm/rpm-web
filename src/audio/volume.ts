// The one level the listener sets, for every element that makes sound: the player's and the radio's. A slider
// that moved only the player would leave the radio at full volume, so each element is given to this class and
// takes the level from it, now and on every change.
//
// Zero is silence, as on the desktop. A mute is the level at zero, and the level before it is kept so that a
// second press puts it back. A separate mute flag would be a second opinion about the same thing.

const KEY = 'rpm-volume';

// What a press on the mute key gives when nothing was kept: the level was set to zero with the slider, or the page
// opened at zero. Half is neither silence nor loud.
const UNMUTED = 0.5;

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export class Volume {
  private current: number;
  private kept = 0;
  private readonly elements = new Set<HTMLMediaElement>();
  private readonly listeners = new Set<() => void>();

  // store is null where the page has no storage. The level then holds until the page closes.
  constructor(private readonly store: Store | null) {
    this.current = Volume.read(store);
  }

  // A stored zero opens at full: a page that opens silent looks broken.
  private static read(store: Store | null): number {
    try {
      const stored = Number(store?.getItem(KEY));
      return stored > 0 && stored <= 1 ? stored : 1;
    } catch {
      return 1;
    }
  }

  get level(): number {
    return this.current;
  }

  get muted(): boolean {
    return this.current === 0;
  }

  onChange(listener: () => void) {
    this.listeners.add(listener);
  }

  // The element follows the level from now on.
  drive(element: HTMLMediaElement) {
    this.elements.add(element);
    element.volume = this.current;
  }

  set(level: number) {
    const next = Math.min(Math.max(Number.isFinite(level) ? level : 0, 0), 1);
    if (next === this.current) return;
    this.current = next;
    for (const element of this.elements) element.volume = next;
    try {
      this.store?.setItem(KEY, String(next));
    } catch {
      // The level holds until the page closes.
    }
    for (const listener of this.listeners) listener();
  }

  // The speaker mark: down to nothing, and back to the level it had.
  toggleMute() {
    if (this.current > 0) {
      this.kept = this.current;
      this.set(0);
      return;
    }
    this.set(this.kept > 0 ? this.kept : UNMUTED);
  }
}

// iOS ignores element.volume, so a slider there would do nothing. The hardware keys set the level instead.
export function volumeWorks(element: HTMLMediaElement): boolean {
  const before = element.volume;
  element.volume = before > 0.5 ? before - 0.1 : before + 0.1;
  const works = element.volume !== before;
  element.volume = before;
  return works;
}
