// A genre's lettering, colour and photograph: the desktop's own, brought in by scripts/gen-genre-art.py. The
// table is large and only the genre views read it, so it loads with them.

export interface GenreArt {
  colour: string;
  finish: 'glass' | 'frost';
  aspect: number;
  path: string;
  photo: string | null;
}

let table: Promise<Record<string, GenreArt>> | null = null;

export function genreArtTable(): Promise<Record<string, GenreArt>> {
  table ??= import('./genre-wordmarks.json').then((module) => module.default as Record<string, GenreArt>);
  return table;
}

// The drawing is a thousand units high, and as wide as its aspect says.
export const viewBoxOf = (art: GenreArt): string => `0 0 ${Math.round(art.aspect * 1000)} 1000`;
export const photoAddress = (art: GenreArt): string | null => (art.photo ? `/genres/${art.photo}` : null);
