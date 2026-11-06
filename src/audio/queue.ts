// The rules of the queue and of the transport keys, apart from anything that makes sound, so they can
// be tested. These follow Transport, StartGate, Retries, QueueEdit and QueueShuffle in RPM.Core.

export type Loaded = 'nothing' | 'playing' | 'paused';
export type TransportMove = 'nothing' | 'pause' | 'resume' | 'remember' | 'forget';

// Starting a track takes time, and for that time nothing is loaded. Somebody who presses next and then
// pause has asked for silence, so the press is remembered and applied when the audio arrives.
export class Transport {
  pausePending = false;

  // A track is being got ready. A pause pressed during the previous load does not carry over.
  starting(): void {
    this.pausePending = false;
  }

  forgotten(): void {
    this.pausePending = false;
  }

  // Whether the audio should be paused on arrival. This uses up the remembered press.
  arrives(): boolean {
    const pending = this.pausePending;
    this.pausePending = false;
    return pending;
  }

  // What a play key shows: what the listener asked for, which the player can only answer for itself
  // when it holds something.
  wantsToPlay(starting: boolean, loaded: Loaded): boolean {
    if (loaded === 'playing') return true;
    if (loaded === 'paused') return false;
    return starting && !this.pausePending;
  }

  pause(starting: boolean, loaded: Loaded): TransportMove {
    if (loaded === 'playing') return 'pause';
    if (loaded === 'paused') return 'nothing';
    if (!starting || this.pausePending) return 'nothing';
    this.pausePending = true;
    return 'remember';
  }

  play(starting: boolean, loaded: Loaded): TransportMove {
    if (loaded === 'paused') return 'resume';
    if (loaded === 'playing') return 'nothing';
    if (!starting || !this.pausePending) return 'nothing';
    this.pausePending = false;
    return 'forget';
  }

  toggle(starting: boolean, loaded: Loaded): TransportMove {
    return this.wantsToPlay(starting, loaded) ? this.pause(starting, loaded) : this.play(starting, loaded);
  }
}

// Which attempt at starting something owns the player. Two taps a second apart start two attempts, and
// the one that finishes last is not always the one tapped last. A later claim cancels the earlier one.
export class StartGate {
  private generation = 0;
  private live: AbortController | null = null;

  begin(): StartAttempt {
    this.live?.abort();
    this.live = new AbortController();
    return new StartAttempt(this, ++this.generation, this.live.signal);
  }

  retire(): void {
    this.generation++;
    this.live?.abort();
    this.live = null;
  }

  isLive(generation: number): boolean {
    return this.generation === generation;
  }
}

export class StartAttempt {
  constructor(
    private readonly gate: StartGate,
    readonly generation: number,
    readonly signal: AbortSignal,
  ) {}

  get isLive(): boolean {
    return this.gate.isLive(this.generation);
  }
}

// How many goes one track gets before the player moves on. A file shorter than its tag says stops at
// the same place every time, so the retries need a limit. The count is per track.
export class Retries {
  static readonly MOST = 3;

  private track: string | null = null;
  private used = 0;

  constructor(private readonly most = Retries.MOST) {}

  mayRetry(rpmId: string): boolean {
    if (this.track !== rpmId) {
      this.track = rpmId;
      this.used = 0;
    }
    if (this.used >= this.most) return false;
    this.used++;
    return true;
  }

  forget(): void {
    this.track = null;
    this.used = 0;
  }
}

export interface RemovalPlan {
  removals: number[];
  currentIndex: number;
  removedCurrent: boolean;
}

// What removing positions does to the queue. Out-of-range and duplicate positions are dropped: a view
// can pass a selection that is out of date.
export function planRemoval(count: number, currentIndex: number, remove: Iterable<number>): RemovalPlan {
  const removals = [...new Set(remove)].filter((i) => i >= 0 && i < count).sort((a, b) => b - a);
  if (removals.length === 0) return { removals, currentIndex, removedCurrent: false };

  const removedCurrent = currentIndex >= 0 && removals.includes(currentIndex);
  const above = currentIndex < 0 ? 0 : removals.filter((i) => i < currentIndex).length;
  return { removals, currentIndex: removedCurrent || currentIndex < 0 ? -1 : currentIndex - above, removedCurrent };
}

export interface MovePlan {
  from: number;
  to: number;
  currentIndex: number;
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

// Where a position ends up after a row is lifted out and put back: out first, then back in.
function follow(index: number, from: number, to: number): number {
  if (index < 0) return -1;
  if (index === from) return to;
  const shifted = index > from ? index - 1 : index;
  return shifted >= to ? shifted + 1 : shifted;
}

export function planMove(count: number, currentIndex: number, from: number, to: number): MovePlan {
  if (count <= 1) return { from: 0, to: 0, currentIndex };
  const start = clamp(from, 0, count - 1);
  const end = clamp(to, 0, count - 1);
  return { from: start, to: end, currentIndex: start === end ? currentIndex : follow(currentIndex, start, end) };
}

// The rows after the playing one in another order. The rows up to and including the playing one stay
// where they are. With two or more rows to move, the order that comes back is never the order that
// went in, because a key that was pressed and changed nothing would look broken.
export function shuffled<T>(rows: readonly T[], current: number, random: () => number = Math.random): T[] {
  const first = clamp(current + 1, 0, rows.length);
  const moving = rows.slice(first);
  if (moving.length < 2) return [...rows];

  for (let i = moving.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [moving[i], moving[j]] = [moving[j]!, moving[i]!];
  }
  if (moving.every((row, k) => row === rows[first + k])) moving.push(moving.shift()!);

  return [...rows.slice(0, first), ...moving];
}

// The rows still to come put back in the order they stood in before the shuffle. A row added while the
// queue was shuffled keeps its place, because it was put there on purpose. Rows are matched by object,
// because one record can stand in the queue twice.
export function restored<T>(rows: readonly T[], current: number, before: readonly T[]): T[] {
  const rank = new Map<T, number>();
  before.forEach((row, i) => {
    if (!rank.has(row)) rank.set(row, i);
  });

  const first = clamp(current + 1, 0, rows.length);
  const order = [...rows];
  const slots: number[] = [];
  for (let i = first; i < rows.length; i++) if (rank.has(rows[i]!)) slots.push(i);

  const known = slots.map((i) => rows[i]!).sort((a, b) => rank.get(a)! - rank.get(b)!);
  slots.forEach((slot, k) => {
    order[slot] = known[k]!;
  });
  return order;
}

// A press on previous early in a track goes to the track before. Later, it starts this track again.
export const RESTART_AFTER_SECONDS = 3;
