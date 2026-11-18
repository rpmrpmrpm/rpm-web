// What the library search was used for, newest first. The same rules as the desktop's SearchHistory and the
// phones'; change them together. A search is remembered once the box has been left alone for SETTLED_MS: the
// person stopped typing and is reading the answers. The half-typed steps of one search ("radi", then
// "radiohead") are one entry, not two. The list is kept in this browser.

export const MOST = 10;
export const SETTLED_MS = 2000;

const KEY = 'rpm-search-history';

const same = (one: string, other: string) => one.toLocaleLowerCase() === other.toLocaleLowerCase();
const startsWith = (text: string, start: string) => text.toLocaleLowerCase().startsWith(start.toLocaleLowerCase());

// kept with asked at the top. A search that only adds to or takes from the newest entry replaces it. One shorter
// than two characters is not remembered.
export function remember(kept: readonly string[], asked: string): string[] {
  const clean = asked.trim().replace(/[\r\n]/g, ' ');
  if (clean.length < 2) return [...kept];
  const list = kept.filter((entry) => entry.trim());
  if (list.length && (startsWith(clean, list[0]!) || startsWith(list[0]!, clean))) list.shift();
  return [clean, ...list.filter((entry) => !same(entry, clean))].slice(0, MOST);
}

export const forget = (kept: readonly string[], asked: string): string[] => kept.filter((entry) => entry !== asked);

export interface HistoryStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// The list as this browser keeps it. A list that cannot be read starts empty; one that cannot be written lasts
// for this visit.
export class SearchHistory {
  entries = $state.raw<string[]>([]);

  constructor(private readonly store: () => HistoryStore | null) {
    try {
      const read: unknown = JSON.parse(store()?.getItem(KEY) ?? '[]');
      this.entries = Array.isArray(read) ? read.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '').slice(0, MOST) : [];
    } catch {
      this.entries = [];
    }
  }

  remember(asked: string) {
    this.set(remember(this.entries, asked));
  }

  forget(asked: string) {
    this.set(forget(this.entries, asked));
  }

  clear() {
    this.set([]);
  }

  private set(next: string[]) {
    if (next.length === this.entries.length && next.every((entry, index) => entry === this.entries[index])) return;
    this.entries = next;
    try {
      this.store()?.setItem(KEY, JSON.stringify(next));
    } catch {
      // A search that cannot be written down is one that is not offered again. Nothing else is lost.
    }
  }
}
