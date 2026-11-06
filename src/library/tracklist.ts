// How a record comes apart into discs. An untagged disc reads as disc 1, and an untagged track sorts
// last inside its own disc, as the desktop lists the same rows.

export interface DiscSection<T> {
  discNumber: number;
  tracks: T[];
}

export function byDisc<T>(tracks: readonly T[], discOf: (t: T) => number, trackOf: (t: T) => number): DiscSection<T>[] {
  const discs = new Map<number, T[]>();
  for (const track of tracks) {
    const disc = discOf(track) || 1;
    if (!discs.has(disc)) discs.set(disc, []);
    discs.get(disc)!.push(track);
  }

  // Array.prototype.sort is stable, so ties keep the order the caller handed over.
  const rank = (track: T) => trackOf(track) || Number.MAX_SAFE_INTEGER;
  return [...discs.keys()]
    .sort((a, b) => a - b)
    .map((discNumber) => ({ discNumber, tracks: discs.get(discNumber)!.sort((a, b) => rank(a) - rank(b)) }));
}
