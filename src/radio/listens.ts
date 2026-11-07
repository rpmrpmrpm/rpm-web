// What this browser has heard on the radio, as totals. A total travels, never an amount to add on, so a lost answer or
// a retry writes the same number twice. One row per station per device, in the same store as the other apps.

import type { Api } from '../api/http';
import type { RadioStation } from './station';
import type { Heard } from './tuner';

const STORE_KEY = 'rpm.radioListens';
const MOST_AT_ONCE = 200;

interface Row {
  heardSeconds: number;
  tunes: number;
  lastHeardAt: number;
  station: RadioStation;
  unsent: boolean;
}

export class RadioListens {
  private rows: Record<string, Row> = {};

  constructor(
    private readonly api: Pick<Api, 'call'>,
    private readonly device: () => string,
  ) {
    try {
      this.rows = (JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Record<string, Row>) ?? {};
    } catch {
      this.rows = {};
    }
  }

  private save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.rows));
    } catch {
      // Held for this visit.
    }
  }

  async note({ station, seconds, newTune, at }: Heard) {
    const key = station.uuid.toLowerCase();
    const row = this.rows[key] ?? { heardSeconds: 0, tunes: 0, lastHeardAt: 0, station, unsent: true };
    this.rows[key] = { heardSeconds: row.heardSeconds + seconds, tunes: row.tunes + (newTune ? 1 : 0), lastHeardAt: Math.max(row.lastHeardAt, at), station, unsent: true };
    this.save();

    const out = Object.entries(this.rows).filter(([, held]) => held.unsent).slice(0, MOST_AT_ONCE);
    try {
      await this.api.call('cloud/station-listens', {
        method: 'PUT',
        body: {
          deviceId: this.device(),
          stations: out.map(([uuid, held]) => ({ uuid, heardSeconds: held.heardSeconds, tunes: held.tunes, lastHeardAt: held.lastHeardAt, station: held.station })),
        },
      });
    } catch {
      return;
    }
    for (const [uuid, held] of out) {
      const now = this.rows[uuid];
      if (now?.heardSeconds === held.heardSeconds) now.unsent = false;
    }
    this.save();
  }
}
