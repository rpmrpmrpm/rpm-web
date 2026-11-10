// .m3u, .m3u8 and .pls playlists, which almost every player can export. It is
// RPM.Core/Migration/PlaylistFileReader.cs of the desktop app: the same rules for paths, names and
// text encodings.

import { localPathOf } from './itunes';
import { SkipReason, type SourceLibrary, type SourcePlaylist, type SourceSkip, type SourceTrack } from './model';

interface Entry {
  location: string;
  display: string | null;
  seconds: number;
}

const extension = (path: string) => {
  const name = fileName(path);
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
};
const fileName = (path: string) => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
const stem = (path: string) => {
  const name = fileName(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
};

// .m3u8 is UTF-8. .m3u and .pls are UTF-8 when the bytes are valid UTF-8, Windows-1252 otherwise.
function decode(path: string, bytes: Uint8Array): string {
  const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  const body = bytes.subarray(start);
  if (start > 0 || extension(path) === '.m3u8') return new TextDecoder('utf-8').decode(body);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    return new TextDecoder('windows-1252').decode(body);
  }
}

function readM3u(text: string): Entry[] {
  const entries: Entry[] = [];
  let display: string | null = null;
  let seconds = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#EXTINF:/i.test(line)) {
      const body = line.slice('#EXTINF:'.length);
      const comma = body.indexOf(',');
      const head = comma >= 0 ? body.slice(0, comma) : body;
      display = comma >= 0 ? body.slice(comma + 1).trim() : null;
      const n = Number.parseFloat(/^-?\d+(\.\d+)?/.exec(head)?.[0] ?? '0');
      seconds = n > 0 ? n : 0;
      continue;
    }
    if (line.startsWith('#')) continue;
    entries.push({ location: line, display, seconds });
    display = null;
    seconds = 0;
  }
  return entries;
}

function readPls(text: string): Entry[] {
  const files = new Map<number, string>();
  const titles = new Map<number, string>();
  const lengths = new Map<number, number>();
  for (const raw of text.split('\n')) {
    const m = /^(File|Title|Length)(\d+)=(.*)$/i.exec(raw.trim());
    if (!m) continue;
    const n = Number.parseInt(m[2]!, 10);
    const value = m[3]!.trim();
    const field = m[1]!.toLowerCase();
    if (field === 'file') files.set(n, value);
    else if (field === 'title') titles.set(n, value);
    else {
      const s = Number.parseFloat(value);
      lengths.set(n, s > 0 ? s : 0);
    }
  }
  return [...files.keys()].sort((a, b) => a - b).map((n) => ({ location: files.get(n)!, display: titles.get(n) ?? null, seconds: lengths.get(n) ?? 0 }));
}

const isAbsolute = (path: string) => path.startsWith('/') || path.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(path);

function collapse(path: string, separator: string): string {
  const parts = path.split(separator);
  const kept: string[] = [];
  parts.forEach((part, i) => {
    if (part === '.' || (part === '' && i > 0 && i < parts.length - 1)) return;
    if (part === '..' && kept.length > 1) {
      kept.pop();
      return;
    }
    kept.push(part);
  });
  return kept.join(separator);
}

// The entry as an absolute path in normal form C, or null for a web address.
export function resolve(playlistPath: string, location: string): string | null {
  if (/^file:/i.test(location)) return localPathOf(location);
  if (/^[A-Za-z][A-Za-z0-9+.-]+:\/\//.test(location)) return null;
  if (isAbsolute(location)) return location.normalize('NFC');
  const windows = playlistPath.includes('\\') && !playlistPath.startsWith('/');
  const separator = windows ? '\\' : '/';
  const cut = Math.max(playlistPath.lastIndexOf('/'), playlistPath.lastIndexOf('\\'));
  const folder = cut >= 0 ? playlistPath.slice(0, cut) : '';
  return collapse(folder + separator + location.replaceAll(windows ? '/' : '\\', separator), separator).normalize('NFC');
}

function split(display: string | null): { artist: string; title: string | null } {
  if (!display || !display.trim()) return { artist: '', title: null };
  const at = display.indexOf(' - ');
  return at > 0 ? { artist: display.slice(0, at).trim(), title: display.slice(at + 3).trim() } : { artist: '', title: display.trim() };
}

export function readPlaylistFiles(files: readonly { path: string; bytes: Uint8Array }[]): SourceLibrary {
  const tracks: SourceTrack[] = [];
  const seen = new Set<string>();
  const playlists: SourcePlaylist[] = [];
  const skipped: SourceSkip[] = [];

  for (const file of files) {
    const text = decode(file.path, file.bytes);
    const entries = extension(file.path) === '.pls' ? readPls(text) : readM3u(text);
    const trackIds: string[] = [];
    const unresolved: string[] = [];
    for (const entry of entries) {
      const path = resolve(file.path, entry.location);
      if (path === null) {
        unresolved.push(entry.location);
        skipped.push({ what: entry.display ?? entry.location, reasonKey: SkipReason.NotAFile });
        continue;
      }
      trackIds.push(path);
      if (seen.has(path)) continue;
      seen.add(path);
      const { artist, title } = split(entry.display);
      tracks.push({
        sourceId: path,
        file: { kind: 'local', path },
        title: title ?? stem(path),
        artist,
        album: '',
        albumArtist: '',
        trackNumber: 0,
        discNumber: 0,
        durationSeconds: entry.seconds,
        sizeBytes: 0,
        rating: 0,
        favorite: false,
        plays: 0,
        lastPlayed: null,
        added: null,
      });
    }
    const playlistPath = file.path.normalize('NFC');
    playlists.push({ sourceId: playlistPath, name: stem(playlistPath), folder: [], smart: false, trackIds, unresolved });
  }
  return { kind: 'playlistfiles', libraryId: '', name: '', tracks, playlists, skipped };
}
