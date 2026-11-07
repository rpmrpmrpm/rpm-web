// A lyric with the clock still attached: an LRC sheet after it has been parsed. Ported rule for rule from
// LyricSheet in the other apps, because the rules decide which stamps are read and which lines are kept.

export interface LyricWord {
  seconds: number;
  text: string;
}

export interface LyricLine {
  seconds: number;
  text: string;
  // Only an enhanced sheet times its words. An ordinary sheet times whole lines.
  words: LyricWord[] | null;
  at: number;
}

export interface LyricSheet {
  // In time order, earliest first.
  lines: LyricLine[];
  // The LRC text as it arrived. What is stored is what was sung, not this reading of it.
  source: string | null;
}

export const EMPTY_SHEET: LyricSheet = { lines: [], source: null };

export const isSynced = (sheet: LyricSheet): boolean => sheet.lines.length > 0;

const STAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const OFFSET_TAG = /^\s*\[offset:\s*([+-]?\d+)\s*\]\s*$/;
const WORD_STAMP = /\s*<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>\s*/g;
const WORD_STAMP_AT = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;
// The fraction is required for the bare form: that keeps "3:15 in the morning" a lyric.
const LOOSE_STAMP = /^\s*(?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]|\(\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\)|\d{1,3}:\d{1,2}[.:]\d{1,3})\s*/;

// The four note characters and the two note emoji. Sharps and flats are not: a lyric can be about them.
const NOTES = new Set(['♩', '♪', '♫', '♬', '\u{1f3b5}', '\u{1f3b6}']);

// "5" is five tenths, "05" five hundredths, "005" five thousandths: the digits set the scale.
function secondsOf(match: RegExpMatchArray): number {
  const fraction = match[3] ? Number(match[3]) / 10 ** match[3].length : 0;
  return Number(match[1]) * 60 + Number(match[2]) + fraction;
}

// The clock out of one line: the word stamps inside it, and a stamp left at its start. A reader never sees a
// timecode in a lyric.
export function unstamp(line: string | null | undefined): string {
  if (!line) return '';
  return line.replace(WORD_STAMP, ' ').replace(LOOSE_STAMP, '').trim();
}

// Nothing to read on it: empty, or only the notes a writer uses to mark a break.
export function isWordless(line: string | null | undefined): boolean {
  if (!line?.trim()) return true;
  for (const character of line) if (character.trim() && !NOTES.has(character)) return false;
  return true;
}

// Text before the first stamp was never given a time, so it belongs to no word.
function readWords(body: string, offset: number): LyricWord[] | null {
  const stamps = [...body.matchAll(WORD_STAMP_AT)];
  const words: LyricWord[] = [];
  for (const [index, stamp] of stamps.entries()) {
    const from = stamp.index + stamp[0].length;
    const text = body.slice(from, stamps[index + 1]?.index ?? body.length).trim();
    if (text) words.push({ seconds: Math.max(0, secondsOf(stamp) - offset), text });
  }
  return words.length ? words : null;
}

// Anything that is not a sheet is the empty sheet. Plain lyrics are the common case, and not an error.
export function parseSheet(lrc: string | null | undefined): LyricSheet {
  if (!lrc?.trim()) return EMPTY_SHEET;

  const lines: Omit<LyricLine, 'at'>[] = [];
  let offset = 0;

  for (const raw of lrc.split('\n')) {
    const line = raw.replace(/\r/g, '');

    // The sign is the LRC convention's: a positive offset means the words come early.
    const said = OFFSET_TAG.exec(line);
    if (said) {
      offset = Number(said[1]) / 1000;
      continue;
    }

    const stamps = [...line.matchAll(STAMP)];
    if (!stamps.length) continue;

    // The words follow the last stamp. Several stamps are a refrain written once and sung several times.
    const last = stamps[stamps.length - 1]!;
    const body = line.slice(last.index + last[0].length);
    const text = unstamp(body);

    // A refrain has one set of word times, true of at most one performance, and the file does not say which.
    const words = stamps.length === 1 ? readWords(body, offset) : null;

    for (const stamp of stamps) lines.push({ seconds: Math.max(0, secondsOf(stamp) - offset), text, words });
  }

  if (!lines.length) return EMPTY_SHEET;
  lines.sort((a, b) => a.seconds - b.seconds);
  return { lines: lines.map((line, at) => ({ ...line, at })), source: lrc };
}

// The line being sung, or null before the first line: an intro is a real part of a song.
export function lineAt(sheet: LyricSheet, seconds: number): number | null {
  return lastStartedBy(sheet.lines, seconds, (line) => line.seconds);
}

export function lastStartedBy<T>(rows: readonly T[], seconds: number, start: (row: T) => number): number | null {
  let low = 0;
  let high = rows.length - 1;
  let found: number | null = null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (start(rows[middle]!) <= seconds) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}
