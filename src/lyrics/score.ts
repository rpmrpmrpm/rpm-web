// A sheet cut into what is sung and what is waited through. An LRC says when each line starts and never how
// long it lasts, so a break is either a line with no words or a wait no singing could fill. A reader sees both
// as the same thing. This is LyricScore, with the desktop's figures.

import { isWordless, lastStartedBy, type LyricLine, type LyricSheet } from './sheet';

// How long a wait has to be before it is a break and not a breath.
export const REST_SECONDS = 20;

// How long the last line before a rest stays up, from its own moment. It is a long line, and less than half
// the shortest break, so it can never use up a rest.
export const SUNG_SECONDS = 8;

export type Piece = { words: LyricLine } | { from: number; until: number };

export interface Part {
  id: number;
  // A rest carries the number of the stretch it closes, so it shows with the words before it.
  section: number;
  piece: Piece;
  seconds: number;
}

export const isRest = (piece: Piece): piece is { from: number; until: number } => 'from' in piece;

export function scoreOf(sheet: LyricSheet): Part[] {
  const parts: Part[] = [];
  const add = (section: number, piece: Piece, seconds: number) => parts.push({ id: parts.length, section, piece, seconds });
  let section = 0;
  let lastSang: number | null = null;

  for (const [at, line] of sheet.lines.entries()) {
    const next = sheet.lines[at + 1]?.seconds ?? Infinity;

    if (isWordless(line.text)) {
      add(section, { from: line.seconds, until: next }, line.seconds);
      section++;
      lastSang = null;
      continue;
    }

    // A wait nobody marked. The rest closes the stretch before it, and the line after it opens the next.
    if (lastSang !== null && line.seconds - lastSang >= REST_SECONDS) {
      add(section, { from: lastSang + SUNG_SECONDS, until: line.seconds }, lastSang + SUNG_SECONDS);
      section++;
    }

    add(section, { words: line }, line.seconds);
    lastSang = line.seconds;
  }

  // The outro. Without this rest the last line stays lit for as long as the sheet is shown.
  if (lastSang !== null) add(section, { from: lastSang + SUNG_SECONDS, until: Infinity }, lastSang + SUNG_SECONDS);
  return parts;
}

export const partAt = (parts: readonly Part[], seconds: number): number | null => lastStartedBy(parts, seconds, (part) => part.seconds);

export function sectionAt(parts: readonly Part[], seconds: number): number | null {
  const at = partAt(parts, seconds);
  return at === null ? null : parts[at]!.section;
}
