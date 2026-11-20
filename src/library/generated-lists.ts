// The desktop's generated lists, as this page shows them. A list arrives as a run of several lists' worth of
// songs, and `shows` says how many make one list. The page shows one slice of the run, and "Generate new"
// moves to the next slice. Nothing is cut here: every slice was chosen by the desktop, in its own order. The
// phone apps do the same (GeneratedLists.window).

import type { GeneratedList } from './playlists';

const READINGS_KEY = 'rpm.generatedListReadings';

// The slice of a run that is one list. Slices do not overlap, except the last one: where the run does not divide
// evenly, the last slice reaches back so that it is still a full list. A run of 130 with lists of 50 gives 0-50,
// 50-100 and 80-130. A run no longer than one list is the list itself. The reading is how many times "Generate
// new" was pressed, and any number, also a negative one, lands on a slice.
export function windowOf(ids: readonly string[], shows: number, reading: number): string[] {
  if (shows <= 0 || ids.length <= shows) return [...ids];
  const slices = Math.ceil(ids.length / shows);
  const which = ((reading % slices) + slices) % slices;
  const start = Math.min(which * shows, ids.length - shows);
  return ids.slice(start, start + shows);
}

// What the store and the readings know a list by. A cut from an older desktop sends no id, and the three fields
// the cut is keyed on stand in for it, as on the phone.
export const listKey = (list: GeneratedList): string => list.id ?? `${list.kind}|${list.genre ?? ''}|${list.decade ?? 0}`;

// Whether a list has another slice to move to.
export const hasAnother = (list: GeneratedList): boolean => (list.shows ?? 0) > 0 && list.trackIds.length > (list.shows ?? 0);

// How many times "Generate new" was pressed on each list, in this browser. The desktop keeps its own count, and
// the two are not shared, so a press here answers at once with nothing that can fail. The count only goes up. It
// is not wrapped at the number of slices, because a new cut can have a different number of them, and the window
// wraps instead.
//
// On the account's own lists the store answers a press with a new list (`cloud/moodlists/next`), kept here with the
// press it answered. It is shown only while the list is on that press.
export class Readings {
  private byList: Record<string, number>;
  private fresh: Record<string, { reading: number; trackIds: string[] }>;

  constructor(private readonly store: Pick<Storage, 'getItem' | 'setItem'> | null = browserStorage()) {
    this.byList = read(store);
    this.fresh = readFresh(store);
  }

  of(list: GeneratedList): number {
    return this.byList[listKey(list)] ?? 0;
  }

  // Moves the list on by one press and returns the new count.
  step(list: GeneratedList): number {
    const key = listKey(list);
    const reading = (this.byList[key] ?? 0) + 1;
    this.byList = { ...this.byList, [key]: reading };
    this.keep(READINGS_KEY, this.byList);
    return reading;
  }

  // Keeps the store's list for press `reading`. An answer for a press the listener has moved past is dropped.
  noteFresh(list: GeneratedList, reading: number, trackIds: string[]): void {
    if (reading !== this.of(list)) return;
    this.fresh = { ...this.fresh, [listKey(list)]: { reading, trackIds } };
    this.keep(FRESH_KEY, this.fresh);
  }

  // The songs this list shows now: the store's answer to this press, or the slice of the run.
  showing(list: GeneratedList): string[] {
    const answer = this.fresh[listKey(list)];
    if (answer && answer.reading === this.of(list)) return answer.trackIds;
    return windowOf(list.trackIds, list.shows ?? 0, this.of(list));
  }

  private keep(key: string, value: unknown) {
    try {
      this.store?.setItem(key, JSON.stringify(value));
    } catch {
      // A private window may refuse to store. The list still moves for this visit.
    }
  }
}

const FRESH_KEY = 'rpm.generatedListFresh';

function readFresh(store: Pick<Storage, 'getItem'> | null): Record<string, { reading: number; trackIds: string[] }> {
  try {
    const raw: unknown = JSON.parse(store?.getItem(FRESH_KEY) ?? '{}');
    if (!raw || typeof raw !== 'object') return {};
    return Object.fromEntries(
      Object.entries(raw).filter(
        (entry): entry is [string, { reading: number; trackIds: string[] }] =>
          Number.isInteger((entry[1] as { reading?: unknown })?.reading) && Array.isArray((entry[1] as { trackIds?: unknown })?.trackIds),
      ),
    );
  } catch {
    return {};
  }
}

function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function read(store: Pick<Storage, 'getItem'> | null): Record<string, number> {
  try {
    const raw: unknown = JSON.parse(store?.getItem(READINGS_KEY) ?? '{}');
    if (!raw || typeof raw !== 'object') return {};
    return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, number] => Number.isInteger(entry[1])));
  } catch {
    return {};
  }
}
