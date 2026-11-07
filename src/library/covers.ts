// Album covers. An img element cannot carry a token, so a cover is fetched by the app and shown from a
// blob. Files are kept in the Cache API under the store's stamp, because the address of a cover never
// changes when the picture does.

import type { Api } from '../api/http';
import type { CloudAlbum } from './albums';
import { coverSpellings } from './art-key';

const CACHE = 'rpm-covers-1';
const AT_ONCE = 6;

interface IndexAnswer {
  albumKeys?: string[];
  albums?: { albumKey: string; updatedAt?: number }[];
}

// The store answers with two shapes, because an older API sends bare keys and no stamps.
export function readIndex(raw: unknown): Map<string, number> {
  const answer = raw as IndexAnswer;
  const index = new Map<string, number>();
  if (answer.albums?.length) for (const entry of answer.albums) index.set(entry.albumKey, entry.updatedAt ?? 0);
  else for (const key of answer.albumKeys ?? []) index.set(key, 0);
  return index;
}

export class Covers {
  private index: Promise<Map<string, number>> | null = null;
  private readonly urls = new Map<string, Promise<string | null>>();
  private readonly waiting: (() => void)[] = [];
  private running = 0;

  constructor(private readonly api: Api) {}

  private stored(): Promise<Map<string, number>> {
    this.index ??= this.api.json('cloud/art', readIndex).catch((error) => {
      // Asked again next time. A failure is not "this library has no covers".
      this.index = null;
      throw error;
    });
    return this.index;
  }

  // The store may hold covers this index does not: an import, or another device.
  reread() {
    this.index = null;
  }

  forget() {
    this.index = null;
    for (const url of this.urls.values()) void url.then((value) => value && URL.revokeObjectURL(value));
    this.urls.clear();
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

  private async load(key: string, stamp: number, edge: number): Promise<string | null> {
    const address = `/covers/${key}/${stamp}/${edge}`;
    const cache = 'caches' in globalThis ? await caches.open(CACHE) : null;
    const kept = await cache?.match(address);
    if (kept) return URL.createObjectURL(await kept.blob());

    const answer = await this.turn(async () => {
      const signed = await this.api.json(`cloud/art/${key}?size=${edge}`, (raw) => raw as { url: string });
      const picture = await fetch(signed.url);
      return picture.ok ? picture.blob() : null;
    });
    if (!answer) return null;

    await cache?.put(address, new Response(answer));
    return URL.createObjectURL(answer);
  }

  // A signed address for the album's cover, for the lock screen, which loads the picture itself.
  async address(album: CloudAlbum, edge: number): Promise<string | null> {
    const index = await this.stored();
    for (const key of await coverSpellings(album.tracks)) {
      if (index.has(key)) return (await this.api.json(`cloud/art/${key}?size=${edge}`, (raw) => raw as { url: string })).url;
    }
    return null;
  }

  // The picture itself, as it is stored, to put on other tracks. Null when the store holds none.
  async picture(album: CloudAlbum): Promise<{ bytes: Uint8Array; mime: string } | null> {
    const index = await this.stored();
    for (const key of await coverSpellings(album.tracks)) {
      if (!index.has(key)) continue;
      const signed = await this.api.json(`cloud/art/${key}`, (raw) => raw as { url: string });
      const answer = await fetch(signed.url);
      if (!answer.ok) return null;
      const blob = await answer.blob();
      return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type || 'image/jpeg' };
    }
    return null;
  }

  // A blob address for the album's cover, or null when the store holds none.
  async url(album: CloudAlbum, edge: number): Promise<string | null> {
    let index: Map<string, number>;
    try {
      index = await this.stored();
    } catch {
      return null;
    }

    for (const key of await coverSpellings(album.tracks)) {
      const stamp = index.get(key);
      if (stamp === undefined) continue;

      const id = `${key}/${stamp}/${edge}`;
      let url = this.urls.get(id);
      if (!url) {
        url = this.load(key, stamp, edge).catch(() => {
          this.urls.delete(id);
          return null;
        });
        this.urls.set(id, url);
      }
      return url;
    }
    return null;
  }
}
