// The cloud library.

import type { Api } from './http';
import type { PlaysEntry, PlaysRow } from '../library/plays';
import { readPage, readQuota, readStream, type CloudPage, type CloudQuota, type CloudStream, type CloudTrack } from './wire';

const PAGE_SIZE = 2000;

export class CloudClient {
  constructor(private readonly api: Api) {}

  quota(signal?: AbortSignal): Promise<CloudQuota> {
    return this.api.json('cloud/quota', readQuota, { signal });
  }

  page(cursor: string | null, signal?: AbortSignal): Promise<CloudPage> {
    const after = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    return this.api.json(`cloud/list?limit=${PAGE_SIZE}${after}`, readPage, { signal });
  }

  // The whole library. A failure on any page fails the whole read: a partial list must not be taken
  // for the library.
  async list(onProgress?: (read: number) => void, signal?: AbortSignal): Promise<CloudTrack[]> {
    const tracks: CloudTrack[] = [];
    let cursor: string | null = null;
    do {
      const page: CloudPage = await this.page(cursor, signal);
      tracks.push(...page.tracks);
      cursor = page.cursor;
      onProgress?.(tracks.length);
    } while (cursor);
    return tracks;
  }

  async trackPlays(since: number): Promise<PlaysRow[]> {
    const answer = await this.api.json(`cloud/track-plays?since=${since}`, (raw) => raw as { tracks?: PlaysRow[] });
    return answer.tracks ?? [];
  }

  async sendTrackPlays(deviceId: string, tracks: PlaysEntry[]): Promise<void> {
    await this.api.call('cloud/track-plays', { method: 'PUT', body: { deviceId, tracks } });
  }

  // Song ratings (0 to 10) for tracks the account holds, at most 200 per call.
  async putTrackRatings(tracks: { rpmId: string; rating: number }[]): Promise<void> {
    await this.api.call('cloud/track-ratings', { method: 'PUT', body: { tracks } });
  }

  // Moves the date added of tracks the account holds earlier (unix seconds), at most 200 per call.
  async putTrackAdded(tracks: { rpmId: string; addedAt: number }[]): Promise<void> {
    await this.api.call('cloud/track-added', { method: 'PUT', body: { tracks } });
  }

  async remove(rpmId: string): Promise<void> {
    await this.api.call(`cloud/file/${encodeURIComponent(rpmId)}`, { method: 'DELETE' });
  }

  stream(rpmId: string, rate: number, signal?: AbortSignal): Promise<CloudStream> {
    return this.api.json(`cloud/stream/${encodeURIComponent(rpmId)}?rate=${rate}`, readStream, { signal });
  }

  // Asks the store to make a rendition, without waiting for it. The look-ahead goes
  // through this and never through a live address.
  async requestRendition(rpmIds: string[], kilobits: number): Promise<void> {
    await this.api.call('cloud/transcode', { method: 'POST', body: { rpmIds, kilobits } });
  }
}
