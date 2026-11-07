// A track's sidecar: the whole set of its tags, its cover and its id, kept privately for this account
// beside the shared audio. A restore rebuilds the file from it, so an edit that should still be there when
// the track goes back to a computer is written here as well as on the catalogue row.

import { ApiError, type Api } from '../api/http';
import type { Transfers } from '../import/importer';
import type { TagSet } from './tag-fields';

export class Sidecars {
  constructor(
    private readonly api: Pick<Api, 'json'>,
    private readonly transfers: Transfers,
    private readonly fetcher: typeof fetch = (...args) => fetch(...args),
  ) {}

  // The sidecar, or null when the store holds none for the track (a row with no sidecar is not a failure,
  // it is a track nobody can restore). Anything else that goes wrong throws.
  async read(rpmId: string): Promise<TagSet | null> {
    let signed: string;
    try {
      signed = await this.api.json(`cloud/sidecar/${encodeURIComponent(rpmId)}`, (raw) => (raw as { url: string }).url);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
    const answer = await this.fetcher(signed);
    if (answer.status === 404 || answer.status === 403) return null;
    if (!answer.ok) throw new ApiError(answer.status, 'The sidecar could not be read.');
    const read = (await answer.json()) as unknown;
    if (typeof read !== 'object' || read === null) throw new ApiError(200, 'The sidecar is not an object.');
    return read as TagSet;
  }

  async write(rpmId: string, sidecar: TagSet): Promise<void> {
    const slot = await this.api.json(`cloud/sidecar/${encodeURIComponent(rpmId)}/upload`, (raw) => (raw as { url: string }).url);
    await this.transfers.put(slot, new TextEncoder().encode(JSON.stringify(sidecar)), { contentType: 'application/json' });
  }
}
