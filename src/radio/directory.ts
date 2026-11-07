// The station directory: Radio Browser, through rpm's API, which keeps the mirrors and asks the volunteers once for
// everybody. Only stations on https come back, because a page on https can play no others.

import { ApiError, type Api } from '../api/http';
import { genreTerm, type Country } from './results';
import type { RadioStation } from './station';

const BY_UUID_AT_ONCE = 100;

export class DirectoryDown extends Error {}

export interface StationQuery {
  name?: string;
  genre?: string | null;
  countryCode?: string | null;
}

const readStations = (raw: unknown) => (raw as { stations?: RadioStation[] }).stations ?? [];

export class RadioDirectory {
  constructor(private readonly api: Pick<Api, 'json' | 'call'>) {}

  private async ask<T>(address: string, read: (raw: unknown) => T, signal?: AbortSignal): Promise<T> {
    try {
      return await this.api.json(address, read, { signal });
    } catch (error) {
      if (error instanceof ApiError) throw new DirectoryDown();
      throw error;
    }
  }

  // Most listened to first.
  search(query: StationQuery, signal?: AbortSignal): Promise<RadioStation[]> {
    const options = new URLSearchParams();
    if (query.name?.trim()) options.set('name', query.name.trim());
    const term = genreTerm(query.genre);
    if (term) options.set('tag', term);
    if (query.countryCode) options.set('country', query.countryCode);
    return this.ask(`radio/stations?${options}`, readStations, signal);
  }

  // The stations the admin filed under a genre their own tags do not name, so a search never finds them.
  async byUuid(uuids: readonly string[]): Promise<RadioStation[]> {
    const found: RadioStation[] = [];
    for (let at = 0; at < uuids.length; at += BY_UUID_AT_ONCE) {
      found.push(...(await this.ask(`radio/stations/filed?uuids=${uuids.slice(at, at + BY_UUID_AT_ONCE).map(encodeURIComponent).join(',')}`, readStations)));
    }
    return found;
  }

  countries(): Promise<Country[]> {
    return this.ask('radio/countries', (raw) => (raw as { countries?: Country[] }).countries ?? []);
  }

  // The directory's ranking is built from these. Best effort.
  reportPlayed(uuid: string) {
    void this.api.call(`radio/played/${encodeURIComponent(uuid)}`, { method: 'POST' }).catch(() => {});
  }
}
