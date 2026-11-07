// What Track info says about a record: the catalogues' papers and the two articles, from one API route. The
// rules for what earns a line are the desktop's: a fact that is not known gets no line, and an answer nobody
// gave is not the same as nothing to say.

import { ApiError, type Api } from '../api/http';
import type { CloudTrack } from '../api/wire';
import type { Article } from './articles';

export interface CatalogLink {
  url: string;
  relation?: string | null;
}

export interface BandMember {
  name: string;
  id?: string | null;
  born?: string | null;
  died?: string | null;
  hasDied?: boolean;
}

export interface CatalogArtist {
  name: string;
  id?: string | null;
  kind?: string | null;
  disambiguation?: string | null;
  country?: string | null;
  area?: string | null;
  began?: string | null;
  ended?: string | null;
  hasEnded?: boolean;
  wikidataId?: string | null;
  genres?: string[] | null;
  links?: CatalogLink[] | null;
  members?: BandMember[] | null;
}

export interface CatalogAlbum {
  title: string;
  id?: string | null;
  artist?: string | null;
  disambiguation?: string | null;
  firstReleased?: string | null;
  primaryType?: string | null;
  secondaryTypes?: string[] | null;
  genres?: string[] | null;
  links?: CatalogLink[] | null;
}

export interface Dossier {
  artist: CatalogArtist | null;
  album: CatalogAlbum | null;
  artistArticle: Article | null;
  albumArticle: Article | null;
}

export type Site = 'official' | 'discogs' | 'bandcamp' | 'facebook' | 'x' | 'instagram' | 'other';

export interface ElsewhereLink {
  site: Site;
  url: string;
}

const SEPARATOR = '  ·  ';

// The sites Track info lists, in the order they are read.
const ELSEWHERE: Site[] = ['official', 'discogs', 'bandcamp', 'facebook', 'x', 'instagram'];

function siteOf(link: CatalogLink): Site {
  let host: string;
  try {
    host = new URL(link.url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return 'other';
  }
  if (host.endsWith('bandcamp.com')) return 'bandcamp';
  if (host === 'discogs.com') return 'discogs';
  if (host === 'facebook.com' || host === 'm.facebook.com') return 'facebook';
  if (host === 'twitter.com' || host === 'x.com') return 'x';
  if (host === 'instagram.com') return 'instagram';

  // A host this list knows and does not show. MusicBrainz often files these as a homepage, and a shop must not
  // stand where the reader expects the band's own site.
  if (/(^|\.)(wikipedia|wikidata)\.org$|(^|\.)(spotify|apple|youtube|soundcloud|genius|allmusic|tumblr)\.com$|^youtu\.be$|^last\.fm$|^bsky\./.test(host)) return 'other';
  return link.relation?.toLowerCase() === 'official homepage' ? 'official' : 'other';
}

// One link per site. The album's links are passed first: its Discogs page is about this record.
export function elsewhere(dossier: Dossier): ElsewhereLink[] {
  const all = [...(dossier.album?.links ?? []), ...(dossier.artist?.links ?? [])];
  return ELSEWHERE.flatMap((site) => {
    const found = all.find((link) => siteOf(link) === site);
    return found ? [{ site, url: found.url }] : [];
  });
}

// "1967-", or "1967-1995" once it is over. Only the years: a day says which entry a cataloguer filed first.
export function lifespan(artist: CatalogArtist): string {
  const began = artist.began?.slice(0, 4) ?? '';
  const ended = artist.ended?.slice(0, 4) ?? '';
  if (!began && !ended) return '';
  return artist.ended || artist.hasEnded ? `${began}-${ended}` : `${began}-`;
}

// "Group · Liverpool · 1960-1970". Only the parts that are known.
export function artistFacts(artist: CatalogArtist | null): string {
  if (!artist) return '';
  return [artist.disambiguation, artist.kind, artist.area ?? artist.country, lifespan(artist)].filter(Boolean).join(SEPARATOR);
}

export function albumFacts(album: CatalogAlbum | null): string {
  if (!album) return '';
  const year = /^\d{4}/.exec(album.firstReleased ?? '')?.[0];
  return [album.disambiguation, album.primaryType, ...(album.secondaryTypes ?? []), year].filter(Boolean).join(SEPARATOR);
}

// The first paragraph, which the pane shows before the reader asks for more.
export function lead(article: Article): string {
  const end = article.text.indexOf('\n');
  return end < 0 ? article.text : article.text.slice(0, end);
}

export const hasMore = (article: Article): boolean => article.text.trim().includes('\n');

// The act a record is asked about. A compilation's album artist names nobody, so it asks about the track's own.
export function askAbout(track: CloudTrack): string | null {
  const credit = track.tags?.albumArtist?.trim();
  const named = credit && !/^various( artists)?$/i.test(credit) ? credit : track.artist?.trim();
  return named || null;
}

// Part of an answer is still an answer, and a question still being asked is not a failure.
const STILL_ASKING = 503;
const TRIES = 4;
const RETRY_MS = 3000;

export class Dossiers {
  private readonly held = new Map<string, Promise<Dossier>>();

  constructor(
    private readonly api: Pick<Api, 'json'>,
    private readonly languages: () => string,
    private readonly wait: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
  ) {}

  private async ask(address: string): Promise<Dossier> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.api.json(address, (raw) => {
          const said = raw as Partial<Dossier>;
          return { artist: said.artist ?? null, album: said.album ?? null, artistArticle: said.artistArticle ?? null, albumArticle: said.albumArticle ?? null };
        });
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== STILL_ASKING || attempt >= TRIES) throw error;
        await this.wait(RETRY_MS);
      }
    }
  }

  // A failure throws, for the pane to say nothing rather than "nothing is known", and is asked again next time.
  of(artist: string, album: string | null, tracks: number): Promise<Dossier> {
    const address = `metadata/dossier?artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album ?? '')}&tracks=${tracks}&languages=${encodeURIComponent(this.languages())}`;
    let asked = this.held.get(address);
    if (!asked) {
      asked = this.ask(address);
      asked.catch(() => this.held.delete(address));
      this.held.set(address, asked);
    }
    return asked;
  }
}
