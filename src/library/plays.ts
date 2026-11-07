// What this browser has played, and what the listener's other devices have. Ported from PlayLog and
// PlaysSync.
//
// The two are kept apart. This browser's own counts are what it sends, and it must always be able to say
// what they are: a store that added everybody's together could never separate them again. What travels
// is a total, never a count to add on, so a lost answer or a retry writes the same number twice.

import type { Played } from './home';

interface Own {
  plays: number;
  lastPlayedAt: number;
  sent: number;
}

interface Foreign {
  plays: number;
  lastPlayedAt: number;
}

export interface SavedPlays {
  own: Record<string, Own>;
  foreign: Record<string, Record<string, Foreign>>;
  cursor: number;
}

export interface PlaysEntry {
  rpmId: string;
  plays: number;
  lastPlayedAt: number;
}

export interface PlaysRow extends PlaysEntry {
  deviceId: string;
  updatedAt: number;
}

export interface PlaysClient {
  trackPlays(since: number): Promise<PlaysRow[]>;
  sendTrackPlays(deviceId: string, rows: PlaysEntry[]): Promise<void>;
}

export interface PlaysStore {
  read(userId: string): Promise<SavedPlays | null>;
  write(userId: string, saved: SavedPlays): Promise<void>;
}

export const PER_PASS = 200;

const empty = (): SavedPlays => ({ own: {}, foreign: {}, cursor: 0 });

export class PlayLog {
  private held = empty();
  private userId = '';
  // Moved on when the account changes. A sync pass that began before that takes nothing in and sends
  // nothing, or it would write one account's rows into the next account's log.
  private era = 0;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly store: PlaysStore) {}

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed() {
    for (const listener of this.listeners) listener();
  }

  async open(userId: string): Promise<void> {
    this.era++;
    this.userId = userId;
    this.held = empty();
    const era = this.era;
    const saved = await this.store.read(userId).catch(() => null);
    if (era !== this.era || !saved) return;
    // Plays counted while the file was being read are kept.
    for (const [id, own] of Object.entries(this.held.own)) saved.own[id] = own;
    this.held = saved;
    this.changed();
  }

  close() {
    this.era++;
    this.userId = '';
    this.held = empty();
    this.changed();
  }

  private save() {
    if (this.userId) void this.store.write(this.userId, this.held).catch(() => {});
  }

  // Saved at once, because a tab can be closed without warning.
  note(rpmId: string, at: number) {
    if (!rpmId) return;
    const mine = this.held.own[rpmId] ?? { plays: 0, lastPlayedAt: 0, sent: 0 };
    mine.plays += 1;
    mine.lastPlayedAt = Math.max(mine.lastPlayedAt, at);
    this.held.own[rpmId] = mine;
    this.save();
    this.changed();
  }

  everythingPlayed(): Map<string, Played> {
    const totals = new Map<string, Played>();
    for (const id of new Set([...Object.keys(this.held.own), ...Object.keys(this.held.foreign)])) {
      const mine = this.held.own[id];
      const theirs = Object.values(this.held.foreign[id] ?? {});
      totals.set(id, {
        plays: (mine?.plays ?? 0) + theirs.reduce((sum, row) => sum + row.plays, 0),
        lastPlayedAt: Math.max(mine?.lastPlayedAt ?? 0, ...theirs.map((row) => row.lastPlayedAt)),
      });
    }
    return totals;
  }

  async sync(client: PlaysClient, mine: string): Promise<void> {
    const era = this.era;
    try {
      const theirs = await client.trackPlays(this.held.cursor);
      if (era !== this.era) return;
      this.apply(theirs, mine);
    } catch {
      // Offline, or the store did not answer. The counts stay, and the next pass asks again.
      return;
    }

    const due = Object.entries(this.held.own)
      .filter(([, row]) => row.plays > row.sent)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .slice(0, PER_PASS)
      .map(([rpmId, row]) => ({ rpmId, plays: row.plays, lastPlayedAt: row.lastPlayedAt }));
    if (!due.length) return;

    try {
      await client.sendTrackPlays(mine, due);
    } catch {
      return;
    }
    if (era !== this.era) return;
    // Marked with the values that were sent. A play counted since is still unsent, and goes next time.
    for (const row of due) {
      const held = this.held.own[row.rpmId];
      if (held) held.sent = row.plays;
    }
    this.save();
  }

  private apply(rows: readonly PlaysRow[], mine: string) {
    let applied = 0;
    for (const row of rows) {
      if (!row.rpmId || row.deviceId === mine) continue;
      const forTrack = (this.held.foreign[row.rpmId] ??= {});
      const had = forTrack[row.deviceId];
      if (had && had.plays === row.plays && had.lastPlayedAt >= row.lastPlayedAt) continue;
      // A row that goes backwards is taken as it stands: a reinstalled device reports what is there now.
      forTrack[row.deviceId] = { plays: row.plays, lastPlayedAt: Math.max(had?.lastPlayedAt ?? 0, row.lastPlayedAt) };
      applied++;
    }
    // The cursor follows what arrived, not what was applied. Most rows are this browser's own, and an
    // account with one device would read its whole history on every visit otherwise.
    const newest = rows.reduce((latest, row) => Math.max(latest, row.updatedAt), this.held.cursor);
    const moved = newest > this.held.cursor;
    this.held.cursor = newest;
    if (applied || moved) this.save();
    if (applied) this.changed();
  }
}
