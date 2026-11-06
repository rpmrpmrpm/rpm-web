// The cloud library.

import type { Api } from './http';
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

  stream(rpmId: string, rate: number, signal?: AbortSignal): Promise<CloudStream> {
    return this.api.json(`cloud/stream/${encodeURIComponent(rpmId)}?rate=${rate}`, readStream, { signal });
  }

  // Asks the store to make a rendition, without waiting for it. See PLAN-TRANSCODE: the look-ahead goes
  // through this and never through a live address.
  async requestRendition(rpmIds: string[], kilobits: number): Promise<void> {
    await this.api.call('cloud/transcode', { method: 'POST', body: { rpmIds, kilobits } });
  }
}
