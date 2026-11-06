// Tags read out of a file's name and folders, as FilenameTags does on the desktop.

export const FILENAME_PRESETS = [
  '{track} - {title}',
  '{track}. {title}',
  '{track} {title}',
  '{artist} - {title}',
  '{track} - {artist} - {title}',
  '{artist} - {album} - {track} - {title}',
  '{disc}-{track} {title}',
  '{album}/{track} - {title}',
  '{artist}/{album}/{track} - {title}',
  '{artist}/{album} ({year})/{track} - {title}',
] as const;

const NUMERIC = new Set(['track', 'disc', 'year', 'movement']);
const TOKEN = /\{(\w+)(?::[^}]*)?\}/g;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compile(pattern: string): { regex: RegExp; names: string[] } | null {
  let source = '^';
  let at = 0;
  const names: string[] = [];
  for (const token of pattern.matchAll(TOKEN)) {
    source += escape(pattern.slice(at, token.index));
    const name = token[1]!.toLowerCase();
    names.push(name);
    // Numbers take digits only. Text is lazy and refuses a slash: "Simon - Garfunkel - The Boxer" has
    // to break at the first dash, not the last.
    source += NUMERIC.has(name) ? '(\\d+)' : '([^/]+?)';
    at = token.index + token[0].length;
  }
  if (names.length === 0) return null;
  return { regex: new RegExp(`${source}${escape(pattern.slice(at))}$`), names };
}

export function parseFilename(path: string, pattern: string): Record<string, string> | null {
  if (!path.trim() || !pattern.trim()) return null;
  const compiled = compile(pattern);
  if (!compiled) return null;

  const slashed = path.replace(/\\/g, '/');
  const slash = slashed.lastIndexOf('/');
  const dot = slashed.lastIndexOf('.');
  const bare = dot > slash && dot > 0 ? slashed.slice(0, dot) : slashed;

  // As many trailing segments as the pattern asks for, so the folders above cannot make it fail.
  const segments = bare.split('/').filter(Boolean);
  const want = pattern.split('/').length;
  if (segments.length < want) return null;

  const match = compiled.regex.exec(segments.slice(-want).join('/'));
  if (!match) return null;

  const result: Record<string, string> = {};
  compiled.names.forEach((name, index) => {
    const value = match[index + 1]!.trim();
    if (value) result[name] = value;
  });
  return result;
}

export function bestPreset(paths: readonly string[]): number {
  let best = 0;
  let most = 0;
  FILENAME_PRESETS.forEach((preset, index) => {
    const matched = paths.filter((path) => {
      const parsed = parseFilename(path, preset);
      return parsed && Object.keys(parsed).length > 0;
    }).length;
    if (matched > most) {
      most = matched;
      best = index;
    }
  });
  return best;
}
