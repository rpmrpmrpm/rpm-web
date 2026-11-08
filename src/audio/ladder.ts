// The rates a track is streamed at, and who may have which, as AudioLadder in the phone apps and in the .NET
// solution. The store decides what an account is served and this side decides what to ask for, so the two follow one
// rule: what supporting rpm buys is the original file. A free account is served 128 kbps whatever it asks for.

// The untranscoded file, as it was uploaded.
export const ORIGINAL = 0;
export const FREE_KILOBITS = 128;

export interface RateOffer {
  // The rates on offer, in the order a chooser lists them: the original first, then the highest to the lowest.
  rungs: readonly number[];
  // Whether the choice has been taken away, which is what a screen greys out.
  capped: boolean;
}

export const WHOLE: RateOffer = { rungs: [ORIGINAL, 320, 256, 192, 128, 96], capped: false };
export const FREE: RateOffer = { rungs: [FREE_KILOBITS], capped: true };

// What an account may choose between. Supporters and the closed beta's testers both carry the supporter mark. An
// account whose plan is not known yet is offered the whole ladder: telling somebody they are on the free plan
// because a request failed is the worse of the two mistakes, and the store caps what it serves either way.
export const offerFor = (supporter: boolean | null): RateOffer => (supporter === false ? FREE : WHOLE);

// The rate to ask for, for a remembered choice: the choice where the offer has it, and the first rung where it does
// not (a supporter's 320 read back after their support ended gives the free rate, and comes back when they return).
export const settles = (offer: RateOffer, kilobits: number): number => (offer.rungs.includes(kilobits) ? kilobits : offer.rungs[0]!);

const KEY = 'rpm-stream-kilobits';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

// The remembered choice. Unset is the original, as on the phones: a new supporter or tester streams lossless from
// the moment the account says so, and a free account's one rate is never written, because its chooser is greyed out.
export function storedRate(store: Store | null): number {
  try {
    const stored = store?.getItem(KEY);
    const rate = stored === null || stored === undefined ? ORIGINAL : Number(stored);
    return WHOLE.rungs.includes(rate) ? rate : ORIGINAL;
  } catch {
    return ORIGINAL;
  }
}

export function storeRate(store: Store | null, kilobits: number) {
  try {
    store?.setItem(KEY, String(kilobits));
  } catch {
    // The choice holds until the page closes.
  }
}

// The listener's choice, kept in this browser, with a word to whoever settles the player's rate on it.
export class StreamQuality {
  private chosen: number;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly store: Store | null) {
    this.chosen = storedRate(store);
  }

  get choice(): number {
    return this.chosen;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // A rate that is not on the ladder is not a choice, and changes nothing.
  choose(kilobits: number) {
    if (!WHOLE.rungs.includes(kilobits) || kilobits === this.chosen) return;
    this.chosen = kilobits;
    storeRate(this.store, kilobits);
    for (const listener of this.listeners) listener();
  }
}
