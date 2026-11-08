// rpm's own copy of each station's logo, from radio/logo. The deployed site reaches the API only with the user's
// token, and an img element cannot send one, so the logo is fetched here and shown from a blob address.
//
// A 404 is an answer: rpm has no logo for that station. It is kept, and the station is not asked again until the
// logos change. Any other failure is not an answer about the station, so it is not kept and the next draw asks again.

import { ApiError, type Api } from '../api/http';

export class StationLogos {
  // The stamp of the logos that the kept answers were read from. When the stamp changes, the answers are dropped.
  // Their addresses are not revoked, because a logo on screen may still be drawn from one.
  private stamp: string | null = null;
  private readonly asked = new Map<string, Promise<string | null>>();
  private readonly answered = new Map<string, string | null>();

  constructor(
    private readonly api: Pick<Api, 'call'>,
    private readonly currentStamp: () => string,
    private readonly toAddress: (blob: Blob) => string = (blob) => URL.createObjectURL(blob),
  ) {}

  // The answer already read for this station, without waiting: an address, null when rpm has no logo for it, or
  // undefined when it has not been read.
  known(uuid: string): string | null | undefined {
    this.follow();
    return this.answered.get(uuid.toLowerCase());
  }

  // The address of rpm's logo for the station, or null when rpm has none. Rejects when the logo could not be read.
  url(uuid: string): Promise<string | null> {
    this.follow();
    const key = uuid.toLowerCase();
    let asking = this.asked.get(key);
    if (!asking) {
      asking = this.read(key, this.stamp ?? '');
      this.asked.set(key, asking);
    }
    return asking;
  }

  private follow() {
    const stamp = this.currentStamp();
    if (stamp === this.stamp) return;
    this.stamp = stamp;
    this.asked.clear();
    this.answered.clear();
  }

  private async read(key: string, stamp: string): Promise<string | null> {
    let address: string | null;
    try {
      const answer = await this.api.call(`radio/logo/${encodeURIComponent(key)}${stamp ? `?v=${encodeURIComponent(stamp)}` : ''}`);
      address = this.toAddress(await answer.blob());
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) {
        if (stamp === this.stamp) this.asked.delete(key);
        throw error;
      }
      address = null;
    }
    // An answer read under a stamp that has since changed is shown by the one who asked, but not kept.
    if (stamp === this.stamp) this.answered.set(key, address);
    return address;
  }
}
