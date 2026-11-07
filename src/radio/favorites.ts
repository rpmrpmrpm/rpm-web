// The saved stations, kept in step with the listener's other devices. Each device sends what it changed and when, and
// the newest change to a station stands. This is FavoriteLedger, kept in this browser's storage, with the sync of
// FavoritesSync. A station that was saved and then unsaved stays in the ledger, or an older device would bring it back.

import { ApiError, type Api } from '../api/http';
import type { RadioStation } from './station';

export interface FavoriteChange {
  saved: boolean;
  changedAt: number;
  station: RadioStation;
}

export interface Ledger {
  account: string | null;
  cursor: number;
  changes: Record<string, FavoriteChange>;
  unsent: string[];
}

const MOST_AT_ONCE = 200;
const STORE_KEY = 'rpm.radioFavorites';

export const emptyLedger = (): Ledger => ({ account: null, cursor: 0, changes: {}, unsent: [] });

const keyOf = (uuid: string) => uuid.toLowerCase();

// What the server keeps of a station: the fields any device needs to play and draw it.
const wireOf = (station: RadioStation) => ({
  uuid: station.uuid,
  name: station.name,
  streamUrl: station.streamUrl,
  homepage: station.homepage ?? null,
  favicon: station.favicon ?? null,
  country: station.country ?? null,
  countryCode: station.countryCode ?? null,
  language: station.language ?? null,
  tags: station.tags ?? [],
  codec: station.codec ?? null,
  bitrateKbps: station.bitrateKbps ?? 0,
  isHls: station.isHls ?? false,
});

export function savedOf(ledger: Ledger): RadioStation[] {
  return Object.entries(ledger.changes)
    .filter(([, change]) => change.saved)
    .sort(([a, first], [b, second]) => first.changedAt - second.changedAt || (a < b ? -1 : 1))
    .map(([, change]) => change.station);
}

export const holds = (ledger: Ledger, uuid: string) => ledger.changes[keyOf(uuid)]?.saved === true;

export function changed(ledger: Ledger, station: RadioStation, saved: boolean, now: number): Ledger {
  const key = keyOf(station.uuid);
  return {
    ...ledger,
    changes: { ...ledger.changes, [key]: { saved, changedAt: Math.max(now, (ledger.changes[key]?.changedAt ?? -1) + 1), station } },
    unsent: [...ledger.unsent.filter((known) => known !== key), key],
  };
}

export function forAccount(ledger: Ledger, userId: string): Ledger {
  if (ledger.account === null) return { ...ledger, account: userId };
  return ledger.account === userId ? ledger : { ...emptyLedger(), account: userId };
}

export interface FavoriteRow {
  uuid: string;
  saved: boolean;
  changedAt: number;
  updatedAt: number;
  station?: RadioStation | null;
}

export function taking(ledger: Ledger, rows: readonly FavoriteRow[]): Ledger {
  const next: Ledger = { ...ledger, changes: { ...ledger.changes }, unsent: [...ledger.unsent] };
  for (const row of rows) {
    if (!row.station || !row.uuid) continue;
    const key = keyOf(row.uuid);
    const held = next.changes[key];
    if (held && held.changedAt >= row.changedAt) continue;
    next.changes[key] = { saved: row.saved, changedAt: row.changedAt, station: row.station };
    next.unsent = next.unsent.filter((known) => known !== key);
  }
  next.cursor = Math.max(ledger.cursor, ...rows.map((row) => row.updatedAt));
  return next;
}

export function toSend(ledger: Ledger, most: number): Record<string, FavoriteChange> {
  const out: Record<string, FavoriteChange> = {};
  for (const key of ledger.unsent.slice(0, most)) {
    const change = ledger.changes[key];
    if (change) out[key] = change;
  }
  return out;
}

// What changed again while this was being sent stays unsent.
export function sent(ledger: Ledger, out: Record<string, FavoriteChange>): Ledger {
  return { ...ledger, unsent: ledger.unsent.filter((key) => !(out[key] && ledger.changes[key]?.changedAt === out[key].changedAt)) };
}

interface Keep {
  read(): string | null;
  write(text: string): void;
}

const browserKeep: Keep = {
  read() {
    try {
      return localStorage.getItem(STORE_KEY);
    } catch {
      return null;
    }
  },
  write(text) {
    try {
      localStorage.setItem(STORE_KEY, text);
    } catch {
      // The list holds for this visit, and the store has every change that was sent.
    }
  },
};

export class RadioFavorites {
  private ledger: Ledger;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly api: Pick<Api, 'json' | 'call'>,
    private readonly keep: Keep = browserKeep,
    private readonly now: () => number = Date.now,
  ) {
    let read: Ledger | null = null;
    try {
      read = JSON.parse(keep.read() ?? 'null') as Ledger | null;
    } catch {
      read = null;
    }
    this.ledger = read ?? emptyLedger();
  }

  get stations(): RadioStation[] {
    return savedOf(this.ledger);
  }

  has = (uuid: string) => holds(this.ledger, uuid);

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private settle(next: Ledger) {
    this.ledger = next;
    this.keep.write(JSON.stringify(next));
    for (const listener of this.listeners) listener();
  }

  toggle(station: RadioStation) {
    this.settle(changed(this.ledger, station, !this.has(station.uuid), this.now()));
    void this.push();
  }

  private async push() {
    const out = toSend(this.ledger, MOST_AT_ONCE);
    if (!Object.keys(out).length) return;
    try {
      await this.api.call('cloud/station-favorites', {
        method: 'PUT',
        body: { stations: Object.entries(out).map(([uuid, change]) => ({ uuid, saved: change.saved, changedAt: change.changedAt, station: wireOf(change.station) })) },
      });
      this.settle(sent(this.ledger, out));
    } catch {
      // Unsent, and sent with the next pass.
    }
  }

  // One pass: this account's, what changed elsewhere, and what changed here.
  async sync(userId: string) {
    this.settle(forAccount(this.ledger, userId));
    try {
      const rows = await this.api.json(`cloud/station-favorites?since=${this.ledger.cursor}`, (raw) => (raw as { stations?: FavoriteRow[] }).stations ?? []);
      if (this.ledger.account === userId) this.settle(taking(this.ledger, rows));
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
    }
    await this.push();
  }
}
