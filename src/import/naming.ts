// Where a track is filed: the relative path it is stored under. It sits under the same name on a later
// restore to a desktop, so the rules match NamingTemplate and PathSanitizer in RPM.Core.

export const DEFAULT_PATTERN = '{albumartist}/{album}/{track:00} - {title}';
export const UNKNOWN_ARTIST = 'Unknown Artist';
const MAX_SEGMENT = 120;

const RESERVED = new Set(['CON', 'PRN', 'AUX', 'NUL', ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((n) => [`COM${n}`, `LPT${n}`])]);

export function sanitizeSegment(segment: string | null | undefined, fallback = 'Unknown'): string {
  if (!segment || !segment.trim()) return fallback;

  let out = '';
  let lastWasSpace = false;
  for (const raw of segment) {
    let ch = raw;
    if (ch === '/' || ch === '\\' || /\s/.test(ch)) ch = ' ';
    else if (/[\p{Cc}<>:"|?*]/u.test(ch)) continue;
    if (ch === ' ') {
      if (lastWasSpace) continue;
      lastWasSpace = true;
    } else {
      lastWasSpace = false;
    }
    out += ch;
  }

  let result = out.trim().replace(/\.+$/, '');
  if (!result) return fallback;
  if (result.length > MAX_SEGMENT) result = result.slice(0, MAX_SEGMENT).replace(/[ .]+$/, '');
  return RESERVED.has(result.toUpperCase()) ? `${result}_` : result;
}

export interface NamingFacts {
  Artist?: string | null;
  AlbumArtist?: string | null;
  Album?: string | null;
  Title?: string | null;
  TrackNumber?: number;
  DiscNumber?: number;
  Year?: number;
  Genre?: string | null;
  Work?: string | null;
  MovementName?: string | null;
}

function numberToken(input: string, name: string, value: number): string {
  const open = `{${name}`;
  const index = input.indexOf(open);
  if (index < 0) return input;
  const end = input.indexOf('}', index);
  if (end < 0) return input;

  const token = input.slice(index, end + 1);
  // Guards {disc} against matching a longer token.
  if (token[open.length] !== ':' && token[open.length] !== '}') return input;

  const format = token.includes(':') ? token.slice(token.indexOf(':') + 1, -1) : '';
  const text = value > 0 ? String(value).padStart(format.length, '0') : '';
  const replaced = input.replaceAll(token, text);

  // "  - Title" when the number is absent: the dangling separator goes.
  return text ? replaced : replaced.replace(/^[\s\-_.]+/, '');
}

function renderSegment(segment: string, facts: NamingFacts, artist: string, albumArtist: string, album: string, title: string): string {
  const rendered = segment
    .replaceAll('{albumartist}', albumArtist)
    .replaceAll('{artist}', artist)
    .replaceAll('{album}', album)
    .replaceAll('{movement}', facts.MovementName?.trim() ? facts.MovementName : title)
    .replaceAll('{work}', facts.Work ?? '')
    .replaceAll('{title}', title)
    .replaceAll('{genre}', facts.Genre ?? '')
    .replaceAll('{year}', facts.Year ? String(facts.Year) : '');
  return numberToken(numberToken(rendered, 'track', facts.TrackNumber ?? 0), 'disc', facts.DiscNumber ?? 0);
}

export function relativePath(facts: NamingFacts, fileName: string, extension: string, pattern = DEFAULT_PATTERN): string {
  const artist = facts.Artist || UNKNOWN_ARTIST;
  const albumArtist = facts.AlbumArtist || artist;
  const album = facts.Album ?? '';
  const title = facts.Title || fileName.replace(/\.[^.]*$/, '');
  const work = facts.Work ?? '';

  const segments = pattern.split('/');
  const rendered: string[] = [];
  segments.forEach((segment, index) => {
    const isFolder = index < segments.length - 1;
    // A track with no album belongs one level up, and not in an "Unknown" folder.
    if (isFolder && !album && segment.includes('{album}')) return;
    if (isFolder && !work && segment.includes('{work}')) return;
    rendered.push(sanitizeSegment(renderSegment(segment, facts, artist, albumArtist, album, title)));
  });
  return rendered.join('/') + extension;
}
