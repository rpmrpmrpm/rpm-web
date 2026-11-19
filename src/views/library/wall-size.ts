// The card size on the artists and genres walls: the width a card aims for, chosen with the heading's slider and
// kept in this browser. It is a target, not a size: each row is filled edge to edge, so a card is drawn at the
// target rounded to a whole number of columns. The two walls share these numbers, as on the desktop
// (ArtistWallView), because they are shown in the same pane and the listener moves between them.

export const SMALLEST_TARGET = 190;
export const LARGEST_TARGET = 480;
export const FIRST_TARGET = 300;
export const WALL_GAP = 14;

export const ARTISTS_SIZE_KEY = 'rpm-artists-card-size';
export const GENRES_SIZE_KEY = 'rpm-genres-card-size';

// How many columns fill `available` with cards closest to `target` wide: the nearest whole number, not the
// floor, so the cards come as close to the target as they can. Never so many that a card is narrower than the
// smallest target, and never fewer than one.
export function wallColumns(available: number, target: number): number {
  if (!(available > 0)) return 1;
  const nearest = Math.round((available + WALL_GAP) / (target + WALL_GAP));
  const most = Math.floor((available + WALL_GAP) / (SMALLEST_TARGET + WALL_GAP));
  return Math.max(1, Math.min(nearest, most));
}

// The size kept in this browser, or the first size when there is none or it cannot be read.
export function storedTarget(key: string): number {
  try {
    const stored = Number(localStorage.getItem(key));
    return stored >= SMALLEST_TARGET && stored <= LARGEST_TARGET ? stored : FIRST_TARGET;
  } catch {
    return FIRST_TARGET;
  }
}

export function keepTarget(key: string, target: number) {
  try {
    localStorage.setItem(key, String(target));
  } catch {
    // It holds for this visit.
  }
}
