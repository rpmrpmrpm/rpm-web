// People's photos and banners. The API asks for the user's token, and an img element cannot carry one, so a
// picture is fetched by the app and shown from a blob.
//
// An address with a ?v= stamp always gives the same picture, so it is kept for the visit. An address without one
// (a feed card, a reply, a notification) gives the person's current picture, and the API says to keep it for one
// minute, so it is asked again after that. A picture that could not be read is asked again next time.

import type { Api } from '../api/http';

const UNSTAMPED_MS = 60_000;

export class Faces {
  private readonly held = new Map<string, { at: number; url: Promise<string | null> }>();

  constructor(
    private readonly api: Pick<Api, 'call'>,
    private readonly clock: () => number = Date.now,
    private readonly blobUrl: (blob: Blob) => string = (blob) => URL.createObjectURL(blob),
  ) {}

  // stamp is the avatarUpdatedAt where the answer carries it, 0 where it does not.
  avatar(userId: string, stamp: number): Promise<string | null> {
    return this.picture(`profiles/${encodeURIComponent(userId)}/avatar`, stamp);
  }

  banner(userId: string, stamp: number): Promise<string | null> {
    return this.picture(`profiles/${encodeURIComponent(userId)}/banner`, stamp);
  }

  private picture(path: string, stamp: number): Promise<string | null> {
    const address = stamp > 0 ? `${path}?v=${stamp}` : path;
    const kept = this.held.get(address);
    if (kept && (stamp > 0 || this.clock() - kept.at < UNSTAMPED_MS)) return kept.url;

    const url: Promise<string | null> = this.api
      .call(address)
      .then(async (answer) => this.blobUrl(await answer.blob()))
      .catch(() => {
        if (this.held.get(address)?.url === url) this.held.delete(address);
        return null;
      });
    this.held.set(address, { at: this.clock(), url });
    return url;
  }
}
