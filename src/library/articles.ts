// What Wikipedia says about an act or a genre, through rpm's API: the web app has no way to ask it itself.

import type { Api } from '../api/http';

export interface Article {
  title: string;
  text: string;
  url: string;
  language: string;
}

export class Articles {
  private readonly held = new Map<string, Promise<Article | null>>();

  constructor(
    private readonly api: Pick<Api, 'json'>,
    private readonly languages: () => string,
  ) {}

  private ask(query: string): Promise<Article | null> {
    const address = `metadata/article?${query}&languages=${encodeURIComponent(this.languages())}`;
    let asked = this.held.get(address);
    if (!asked) {
      asked = this.api.json(address, (raw) => (raw as { article?: Article | null }).article ?? null);
      // A failure throws, for the page to say so, and is asked again next time.
      asked.catch(() => this.held.delete(address));
      this.held.set(address, asked);
    }
    return asked;
  }

  ofArtist = (artist: string) => this.ask(`artist=${encodeURIComponent(artist)}`);
  ofGenre = (genre: string) => this.ask(`genre=${encodeURIComponent(genre)}`);
}
