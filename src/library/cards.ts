// The conductor a classical record credits and the label a record names, for Track info's cards under the
// album's, as the desktop's EncyclopediaLookup finds them. The API runs that lookup, because the page's content
// policy does not reach Wikidata.

import type { Api } from '../api/http';
import type { Article } from './articles';

export interface CardLink {
  // A site the API names in camel case: "officialSite", "discogs", "allMusic", "wikidata", "other".
  site: string;
  url: string;
}

export interface ConductorCard {
  name: string;
  roles: string[];
  born: string | null;
  died: string | null;
  article: Article | null;
  photoUrl: string | null;
  links: CardLink[];
}

export interface LabelCard {
  name: string;
  founded: string | null;
  ended: string | null;
  genres: string[];
  article: Article | null;
  logoUrl: string | null;
  links: CardLink[];
}

// The few sites whose names are not their enum name, as the desktop's SiteName writes them. The official site is
// a string the caller looks up, and any other site goes by its host.
const NAMES: Record<string, string> = {
  lastFm: 'Last.fm',
  appleMusic: 'Apple Music',
  allMusic: 'AllMusic',
  youTube: 'YouTube',
  soundCloud: 'SoundCloud',
  wikipedia: 'Wikipedia',
  wikidata: 'Wikidata',
  discogs: 'Discogs',
  bandcamp: 'Bandcamp',
  spotify: 'Spotify',
  genius: 'Genius',
  instagram: 'Instagram',
  facebook: 'Facebook',
  x: 'X',
  tumblr: 'Tumblr',
  bluesky: 'Bluesky',
};

// What a link is called on a card. Null for the official site, which the caller names in the reader's language.
export function siteName(link: CardLink): string | null {
  if (link.site === 'officialSite') return null;
  const named = NAMES[link.site];
  if (named) return named;
  try {
    return new URL(link.url).hostname.replace(/^www\./, '');
  } catch {
    return link.url;
  }
}

// Wikidata writes its occupations and genres in lower case ("conductor"); a line of them on a card starts each
// with a capital, as a label does.
export const capitalised = (words: readonly string[]): string =>
  words.map((word) => (word ? word[0]!.toLocaleUpperCase() + word.slice(1) : word)).join('  ·  ');

// When a conductor lived, as the card says it: "1927-2013", a key for "Born 1940", or "-1910" when only the
// death is known. Null when neither is.
export function lifeOf(card: ConductorCard): { text: string } | { key: string; values: string[] } | null {
  if (card.born && card.died) return { text: `${card.born}-${card.died}` };
  if (card.born) return { key: 'TrackInfo_ConductorBorn', values: [card.born] };
  if (card.died) return { text: `-${card.died}` };
  return null;
}

// When a label was active: since, from and to, or only when it closed. Null when neither year is known.
export function activeOf(card: LabelCard): { key: string; values: string[] } | null {
  if (card.founded && card.ended) return { key: 'TrackInfo_LabelFromTo', values: [card.founded, card.ended] };
  if (card.founded) return { key: 'TrackInfo_LabelSince', values: [card.founded] };
  if (card.ended) return { key: 'TrackInfo_LabelClosed', values: [card.ended] };
  return null;
}

export class EncyclopediaCards {
  private readonly held = new Map<string, Promise<unknown>>();

  constructor(
    private readonly api: Pick<Api, 'json'>,
    private readonly languages: () => string,
  ) {}

  // One question per name and language for the visit: an opera credits its conductor on every track. A failure
  // throws, for the pane to show no card rather than "nobody", and is asked again next time.
  private ask<T>(route: string, name: string, read: (raw: unknown) => T): Promise<T> {
    const address = `metadata/${route}?name=${encodeURIComponent(name.trim())}&languages=${encodeURIComponent(this.languages())}`;
    let asked = this.held.get(address) as Promise<T> | undefined;
    if (!asked) {
      asked = this.api.json(address, read);
      asked.catch(() => this.held.delete(address));
      this.held.set(address, asked);
    }
    return asked;
  }

  // The conductor a credit names, or null where nobody who conducts goes by that name.
  conductor(credit: string): Promise<ConductorCard | null> {
    return this.ask('conductor', credit, (raw) => (raw as { conductor?: ConductorCard | null }).conductor ?? null);
  }

  // The record label a tag names, or null where no label goes by that name.
  label(tag: string): Promise<LabelCard | null> {
    return this.ask('label', tag, (raw) => (raw as { label?: LabelCard | null }).label ?? null);
  }
}
