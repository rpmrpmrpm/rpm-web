// Who made a song, for Track info's credits, as the desktop lists them (TrackFacts): who wrote it, who conducted
// it, who remixed it, the label, and the numbers that identify the recording. The catalogue row carries only the
// composer. The rest is in the track's sidecar, which keeps every tag of the file it came from.

import type { CloudTrack } from '../api/wire';
import type { Sidecars } from './sidecars';
import type { TagSet } from './tag-fields';

// The lines, in the desktop's order, by the sidecar's field and the label's string.
export const CREDIT_LINES: readonly [field: string, label: string][] = [
  ['Composers', 'Details_Composers'],
  ['Conductor', 'Details_Conductor'],
  ['RemixedBy', 'Details_RemixedBy'],
  ['Publisher', 'Details_Publisher'],
  ['Copyright', 'Details_Copyright'],
  ['Isrc', 'Details_Isrc'],
  ['Grouping', 'Details_Grouping'],
  ['ReleaseCountry', 'Details_ReleaseCountry'],
  ['Comment', 'Details_Comment'],
];

export interface Credit {
  label: string;
  value: string;
}

const textOf = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

// The lines that have something on them. The row's composer comes before the sidecar's, because the row is what
// every device edits.
export function creditsOf(track: CloudTrack, sidecar: TagSet | null): Credit[] {
  return CREDIT_LINES.flatMap(([field, label]) => {
    const value = (field === 'Composers' ? textOf(track.tags?.composer) : null) ?? textOf(sidecar?.[field]);
    return value ? [{ label, value }] : [];
  });
}

// One field of a track's sidecar, as text, or null.
export const sidecarText = (sidecar: TagSet | null, field: string): string | null => textOf(sidecar?.[field]);

// The sidecars Track info has read this visit, without their pictures. A track with none is remembered as none;
// a read that failed is not remembered, and is asked again next time.
export class RemoteTags {
  private readonly held = new Map<string, Promise<TagSet | null>>();

  constructor(private readonly sidecars: Pick<Sidecars, 'read'>) {}

  of(rpmId: string): Promise<TagSet | null> {
    let asked = this.held.get(rpmId);
    if (!asked) {
      asked = this.sidecars.read(rpmId).then((sidecar) => {
        if (!sidecar) return null;
        const { Art: _art, ...kept } = sidecar as TagSet & { Art?: unknown };
        return kept as TagSet;
      });
      asked.catch(() => this.held.delete(rpmId));
      this.held.set(rpmId, asked);
    }
    return asked;
  }
}

// The parts of a record that is several things under one title: "Eine kleine Nachtmusik / Divertimento". Cut on
// " / " with its spaces, so "AC/DC" and "Live/Dead" stay whole. Empty for a record that is one thing.
export function albumParts(title: string | null | undefined): string[] {
  if (!title || !title.includes(' / ')) return [];
  const seen = new Set<string>();
  const parts = title
    .split(' / ')
    .map((part) => part.trim())
    .filter((part) => {
      const key = part.toLocaleLowerCase();
      if (!part || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return parts.length > 1 ? parts : [];
}

// Which part a track belongs to: the one its work is, or the first.
export function partOf(parts: readonly string[], work: string | null | undefined): number {
  const wanted = work?.trim().toLocaleLowerCase();
  const found = wanted ? parts.findIndex((part) => part.toLocaleLowerCase() === wanted) : -1;
  return Math.max(found, 0);
}
