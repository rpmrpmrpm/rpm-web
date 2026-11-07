// An act's pictures, from the API the desktop asks: GET artwork. Each one lives on another host, so it goes
// through the fetch route and comes back as an address in rpm's own store. An answer that could not be had is
// asked for again next time: "no picture" and "no answer" are not the same.

import type { Api } from '../api/http';

export interface ArtistArtwork {
  cover: string | null;
  backgrounds: string[];
  thumbs: string[];
  logo: string | null;
}

export class ArtistArt {
  private readonly held = new Map<string, Promise<ArtistArtwork | null>>();

  constructor(
    private readonly api: Pick<Api, 'json'>,
    private readonly shown: (address: string) => Promise<string | null>,
  ) {}

  private artwork(artist: string): Promise<ArtistArtwork | null> {
    const key = artist.trim().toLowerCase();
    let asked = this.held.get(key);
    if (!asked) {
      asked = this.api
        .json(`artwork?artist=${encodeURIComponent(artist)}`, (raw) => {
          const answer = raw as Partial<ArtistArtwork>;
          return { cover: answer.cover ?? null, backgrounds: answer.backgrounds ?? [], thumbs: answer.thumbs ?? [], logo: answer.logo ?? null };
        })
        .catch(() => {
          this.held.delete(key);
          return null;
        });
      this.held.set(key, asked);
    }
    return asked;
  }

  // The wide photograph: what stands behind a banner card and on an artist tile.
  async photo(artist: string): Promise<string | null> {
    const artwork = await this.artwork(artist);
    const address = artwork?.backgrounds[0] ?? artwork?.thumbs[0];
    return address ? this.shown(address) : null;
  }

  // Every photograph there is, for the arrows on an artist page.
  async photos(artist: string): Promise<(string | null)[]> {
    const artwork = await this.artwork(artist);
    return Promise.all((artwork?.backgrounds ?? []).map((address) => this.shown(address)));
  }

  async logo(artist: string): Promise<string | null> {
    const artwork = await this.artwork(artist);
    return artwork?.logo ? this.shown(artwork.logo) : null;
  }
}
