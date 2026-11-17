// The explicit mark that some download tools add to the end of a song title, as in "Killah 🅴".
//
// rpm draws its own explicit badge from the advisory flag, so a title that keeps the mark shows two marks in
// two styles. The mark is taken off the title and sent as the advisory flag instead. The desktop app applies
// the same rule when it reads a file (ExplicitTitleMark), so a track reads the same from either side.
//
// Only a mark at the end of the title, after a space, is taken off. That is where the tools put it. A mark
// anywhere else may be part of the name, so it is left alone.

// U+1F174, NEGATIVE SQUARED LATIN CAPITAL LETTER E: the character the tools write.
export const EXPLICIT_MARK = '\u{1F174}';

// The advisory number for explicit, as the sidecar and the catalogue store it.
export const ADVISORY_EXPLICIT = 1;

// The title without the mark at its end, and whether it had one. A title without the mark comes back
// exactly as it was given.
export function splitExplicitMark(title: string | null | undefined): { title: string | null; marked: boolean } {
  if (title === null || title === undefined) return { title: null, marked: false };

  const end = title.trimEnd();
  if (!end.endsWith(EXPLICIT_MARK)) return { title, marked: false };

  const rest = end.slice(0, -EXPLICIT_MARK.length);
  if (rest.length === 0 || !/\s$/.test(rest)) return { title, marked: false };

  return { title: rest.trimEnd(), marked: true };
}
