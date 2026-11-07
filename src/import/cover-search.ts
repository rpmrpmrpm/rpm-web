// Cover art by name, through rpm's API. The API reads the picture from the host it lives on and hands
// back a signed address in rpm's own store, because a browser cannot read those hosts itself.

import type { Api } from '../api/http';

export type CoverKind = 'cover' | 'disc';

export interface CoverCandidate {
  source: string;
  thumbUrl: string;
  fullUrl: string;
  width: number;
  height: number;
  title: string | null;
  artist: string | null;
  note: string | null;
  discThumbUrl: string | null;
  discUrl: string | null;
}

export interface PickedPicture {
  bytes: Uint8Array;
  mime: string;
}

const AT_ONCE = 6;

export class CoverSearch {
  private running = 0;
  private readonly waiting: (() => void)[] = [];
  private readonly addresses = new Map<string, Promise<string | null>>();

  constructor(
    private readonly api: Pick<Api, 'json'>,
    private readonly fetcher: typeof fetch = (...args) => fetch(...args),
  ) {}

  sources(kind: CoverKind): Promise<string[]> {
    return this.api.json(kind === 'disc' ? 'artwork/sources?kind=disc' : 'artwork/sources', (raw) => (raw as string[]) ?? []);
  }

  async search(artist: string, album: string, sources: readonly string[], kind: CoverKind, limit = 12): Promise<CoverCandidate[]> {
    const words = new URLSearchParams({ limit: String(limit) });
    if (artist.trim()) words.set('artist', artist.trim());
    if (album.trim()) words.set('album', album.trim());
    if (sources.length) words.set('sources', sources.join(','));
    if (kind === 'disc') words.set('kind', 'disc');
    const answer = await this.api.json(`artwork/search?${words}`, (raw) => raw as { results?: CoverCandidate[] });
    return answer.results ?? [];
  }

  private async turn<T>(run: () => Promise<T>): Promise<T> {
    if (this.running >= AT_ONCE) await new Promise<void>((go) => this.waiting.push(go));
    this.running++;
    try {
      return await run();
    } finally {
      this.running--;
      this.waiting.shift()?.();
    }
  }

  // A signed address for a picture on another host, which an img element can show.
  shown(address: string): Promise<string | null> {
    let held = this.addresses.get(address);
    if (!held) {
      held = this.turn(() => this.api.json('artwork/fetch', (raw) => (raw as { url?: string }).url ?? null, { method: 'POST', body: { url: address } })).catch(() => {
        this.addresses.delete(address);
        return null;
      });
      this.addresses.set(address, held);
    }
    return held;
  }

  // The picture itself, to keep with the record. The full picture first, then the thumbnail.
  async download(addresses: readonly (string | null | undefined)[]): Promise<PickedPicture | null> {
    for (const address of addresses) {
      if (!address) continue;
      const signed = await this.shown(address);
      if (!signed) continue;
      const answer = await this.fetcher(signed);
      if (!answer.ok) continue;
      const blob = await answer.blob();
      return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type || 'image/jpeg' };
    }
    return null;
  }
}
