// A tag built from other tags: "{track:00} - {title}". Ported from TagTemplate. A field that says nothing
// takes its punctuation with it, so "{artist} - {title}" with no artist is the title alone.

export const TAG_PRESETS = [
  '{artist} - {title}',
  '{track:00} - {title}',
  '{title} ({artist})',
  '{artist} - {album} - {title}',
  '{album} ({year})',
  '{albumartist}',
  '{artist}',
  '{album}',
];

const GLUE = ' -._,/:;|';
const TOKEN = /\{(\w+)(?::([^}]*))?\}/g;

const trimEnd = (text: string): string => {
  let end = text.length;
  while (end > 0 && GLUE.includes(text[end - 1]!)) end--;
  return text.slice(0, end);
};

const trimBoth = (text: string): string => {
  let start = 0;
  while (start < text.length && GLUE.includes(text[start]!)) start++;
  return trimEnd(text.slice(start));
};

const meaningful = (literal: string): boolean => /[\p{L}\p{N}]/u.test(literal);

function formatted(held: string | null | undefined, format: string): string {
  const text = (held ?? '').trim();
  if (!text || !format) return text;
  if (!/^-?\d+$/.test(text)) return text;
  const number = Number(text);
  if (number === 0) return '';
  return /^0+$/.test(format) ? String(number).padStart(format.length, '0') : String(number);
}

function bracketed(before: string, after: string): { openAt: number; closeAt: number } | null {
  const trimmed = trimEnd(before);
  if (!trimmed) return null;
  const close = { '(': ')', '[': ']', '{': '}' }[trimmed[trimmed.length - 1]!];
  if (!close) return null;
  const end = after.indexOf(close);
  if (end < 0 || meaningful(after.slice(0, end))) return null;
  return { openAt: trimmed.length - 1, closeAt: end };
}

export function renderTemplate(pattern: string, value: (token: string) => string | null | undefined): string {
  if (!pattern) return '';

  // Literals and tokens, alternating, so a token's glue is the literal either side of it.
  const literals: string[] = [];
  const values: string[] = [];
  let at = 0;
  for (const token of pattern.matchAll(TOKEN)) {
    literals.push(pattern.slice(at, token.index));
    values.push(formatted(value(token[1]!.toLowerCase()), token[2] ?? ''));
    at = token.index + token[0].length;
  }
  literals.push(pattern.slice(at));

  values.forEach((held, i) => {
    if (held) return;
    const before = literals[i]!;
    const after = literals[i + 1]!;

    const bracket = bracketed(before, after);
    if (bracket) {
      literals[i] = trimEnd(before.slice(0, bracket.openAt));
      literals[i + 1] = after.slice(bracket.closeAt + 1);
      return;
    }

    const anythingYet = values.slice(0, i).some(Boolean) || literals.slice(0, i + 1).some(meaningful);
    if (anythingYet) literals[i] = meaningful(before) ? trimEnd(before) : '';
    else if (!meaningful(after)) literals[i + 1] = '';
  });

  const built = values.map((held, i) => literals[i]! + held).join('') + literals[literals.length - 1]!;
  return trimBoth(built.trim()).trim();
}
