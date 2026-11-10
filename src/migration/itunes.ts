// The iTunes library XML: the file Apple Music writes with File > Library > Export Library, Windows
// iTunes writes when sharing is on, and MusicBee writes when "Save a copy of the library tags as an
// iTunes formatted XML file" is on. It is RPM.Core/Migration/ITunesLibraryReader.cs of the desktop app.
//
// The file is an Apple property list. It is read with a small tokenizer over the text, not a DOM (the
// tests run in node, and a 40 MB DOM is slow): dict, array, key and value elements, in one pass.

import type { PickedFile } from '../import/queue';
import { shortHash, SkipReason, type SourceLibrary, type SourcePlaylist, type SourceSkip, type SourceTrack, what } from './model';

type Value = string | number | boolean | Date | null | Value[] | { [key: string]: Value };
type Dict = { [key: string]: Value };

const TOKEN = /<(\/?)(dict|array|key|string|integer|real|date|true|false|data)(\/?)>|<\?[^>]*\?>|<!DOCTYPE[^>]*>|<\/?plist[^>]*>/g;

const ENTITY = /&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g;
const decode = (text: string): string =>
  text.includes('&')
    ? text.replace(ENTITY, (_, e: string) =>
        e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
        : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[e]!)
    : text;

function parsePlist(xml: string): Value {
  TOKEN.lastIndex = 0;
  const stack: (Value[] | Dict)[] = [];
  const keys: (string | null)[] = [];
  let root: Value = null;
  let textStart = 0;

  const put = (value: Value) => {
    const top = stack[stack.length - 1];
    if (top === undefined) {
      root = value;
    } else if (Array.isArray(top)) {
      top.push(value);
    } else {
      const key = keys[keys.length - 1];
      if (key !== null && key !== undefined) top[key] = value;
      keys[keys.length - 1] = null;
    }
  };

  for (let m = TOKEN.exec(xml); m !== null; m = TOKEN.exec(xml)) {
    const [, closing, name, empty] = m;
    if (!name) continue;
    if (!closing) {
      if (name === 'dict' || name === 'array') {
        const node: Value[] | Dict = name === 'array' ? [] : {};
        if (empty) {
          put(node);
        } else {
          stack.push(node);
          keys.push(null);
        }
      } else if (name === 'true' || name === 'false') {
        put(name === 'true');
      } else if (empty) {
        put(name === 'string' || name === 'key' ? '' : null);
      } else {
        textStart = TOKEN.lastIndex;
      }
      continue;
    }

    if (name === 'dict' || name === 'array') {
      const node = stack.pop()!;
      keys.pop();
      put(node);
      continue;
    }

    const text = xml.slice(textStart, m.index);
    switch (name) {
      case 'key': {
        keys[keys.length - 1] = decode(text);
        break;
      }
      case 'string': put(decode(text)); break;
      case 'integer': put(Number.parseInt(text, 10) || 0); break;
      case 'real': put(Number.parseFloat(text) || 0); break;
      case 'date': {
        const at = new Date(text.trim());
        put(Number.isNaN(at.getTime()) ? null : at);
        break;
      }
      default: put(null); // <data>: smart playlist rules, not needed
    }
  }
  return root;
}

const str = (d: Dict, key: string): string | null => (typeof d[key] === 'string' ? (d[key] as string) : null);
const num = (d: Dict, key: string): number => (typeof d[key] === 'number' ? (d[key] as number) : 0);
const flag = (d: Dict, key: string): boolean => d[key] === true;
const date = (d: Dict, key: string): Date | null => (d[key] instanceof Date ? (d[key] as Date) : null);
const isDict = (v: Value | undefined): v is Dict => typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);

// A file: URL as a path on disk, or null when it is not one. Windows drive paths come back with
// backslashes, network shares as \\server\share, and the rest as POSIX paths, in normal form C.
export function localPathOf(location: string): string | null {
  if (!/^file:\/\//i.test(location)) return null;
  let rest = location.slice('file://'.length);
  if (/^localhost\//i.test(rest)) rest = rest.slice('localhost'.length);
  let path: string;
  try {
    path = decodeURIComponent(rest);
  } catch {
    path = rest;
  }
  if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1).replaceAll('/', '\\');
  else if (!path.startsWith('/')) path = '\\\\' + path.replaceAll('/', '\\');
  return path.length > 0 ? path.normalize('NFC') : null;
}

function readTrack(t: Dict, trackId: string): SourceTrack | SourceSkip {
  const title = str(t, 'Name') ?? '';
  const artist = str(t, 'Artist') ?? '';
  const label = what(artist, title);

  if (['Podcast', 'Has Video', 'Movie', 'TV Show', 'iTunesU', 'Audiobook'].some((k) => flag(t, k))) {
    return { what: label, reasonKey: SkipReason.NotMusic };
  }
  const type = str(t, 'Track Type');
  const location = str(t, 'Location');
  if (type === 'URL' || (location !== null && !/^file:/i.test(location))) return { what: label, reasonKey: SkipReason.NotAFile };
  const path = location === null || type === 'Remote' ? null : localPathOf(location);
  if (path === null) return { what: label, reasonKey: SkipReason.NotOnThisComputer };

  return {
    sourceId: str(t, 'Persistent ID') || trackId,
    file: { kind: 'local', path },
    title,
    artist,
    album: str(t, 'Album') ?? '',
    albumArtist: str(t, 'Album Artist') ?? '',
    trackNumber: num(t, 'Track Number'),
    discNumber: num(t, 'Disc Number'),
    durationSeconds: num(t, 'Total Time') / 1000,
    sizeBytes: num(t, 'Size'),
    rating: flag(t, 'Rating Computed') ? 0 : Math.min(10, Math.max(0, Math.round(num(t, 'Rating') / 10))),
    favorite: flag(t, 'Loved') || flag(t, 'Favorited'),
    plays: num(t, 'Play Count'),
    lastPlayed: date(t, 'Play Date UTC'),
    added: date(t, 'Date Added'),
  };
}

function readPlaylists(list: Value[], idOfTrack: Map<string, string>): SourcePlaylist[] {
  const dicts = list.filter(isDict);
  const folders = new Map<string, { name: string; parent: string | null }>();
  for (const p of dicts) {
    const id = str(p, 'Playlist Persistent ID');
    if (flag(p, 'Folder') && id) folders.set(id, { name: str(p, 'Name') ?? '', parent: str(p, 'Parent Persistent ID') });
  }

  const chain = (start: string | null): string[] => {
    const names: string[] = [];
    const seen = new Set<string>();
    for (let parent = start; parent !== null && !seen.has(parent); ) {
      seen.add(parent);
      const folder = folders.get(parent);
      if (!folder) break;
      names.unshift(folder.name);
      parent = folder.parent;
    }
    return names;
  };

  const playlists: SourcePlaylist[] = [];
  for (const p of dicts) {
    // The whole library, the built-in lists (Music, Movies, Downloaded) and folders are not playlists
    // anybody made.
    if (flag(p, 'Master') || 'Distinguished Kind' in p || flag(p, 'Folder')) continue;
    const trackIds: string[] = [];
    const unresolved: string[] = [];
    const items = p['Playlist Items'];
    if (Array.isArray(items)) {
      for (const item of items.filter(isDict)) {
        if (typeof item['Track ID'] !== 'number') continue;
        const id = String(item['Track ID']);
        const sourceId = idOfTrack.get(id);
        if (sourceId) trackIds.push(sourceId);
        else unresolved.push(id);
      }
    }
    playlists.push({
      sourceId: str(p, 'Playlist Persistent ID') ?? (typeof p['Playlist ID'] === 'number' ? String(p['Playlist ID']) : str(p, 'Name') ?? ''),
      name: str(p, 'Name') ?? '',
      folder: chain(str(p, 'Parent Persistent ID')),
      smart: 'Smart Info' in p || 'Genius Track ID' in p,
      trackIds,
      unresolved,
    });
  }
  return playlists;
}

export async function readITunesLibrary(xml: string, kind: 'musicbee' | 'itunes'): Promise<SourceLibrary> {
  const root = parsePlist(xml);
  if (!isDict(root)) throw new Error('The file is not an iTunes library.');

  const tracks: SourceTrack[] = [];
  const skipped: SourceSkip[] = [];
  const idOfTrack = new Map<string, string>();
  const trackDict = root['Tracks'];
  if (isDict(trackDict)) {
    for (const [key, value] of Object.entries(trackDict)) {
      if (!isDict(value)) continue;
      const trackId = typeof value['Track ID'] === 'number' ? String(value['Track ID']) : key;
      const read = readTrack(value, trackId);
      if ('sourceId' in read) {
        tracks.push(read);
        idOfTrack.set(trackId, read.sourceId);
      } else {
        skipped.push(read);
      }
    }
  }

  const list = root['Playlists'];
  const persistent = str(root, 'Library Persistent ID');
  const folder = str(root, 'Music Folder');
  return {
    kind,
    libraryId: persistent || (folder ? await shortHash(folder) : ''),
    name: kind === 'musicbee' ? 'MusicBee' : 'iTunes',
    tracks,
    playlists: Array.isArray(list) ? readPlaylists(list, idOfTrack) : [],
    skipped,
  };
}

// The picked file for each local track: the one whose path ends with the longest part of the track's
// path, at least its folder and file name. A page cannot open a path from the library file, so the
// person picks the music folder and the tracks are found in it.
export function matchPicked(library: SourceLibrary, picked: readonly PickedFile[]): Map<string, PickedFile> {
  const parts = (path: string) => path.split(/[/\\]/).filter((p) => p.length > 0).map((p) => p.normalize('NFC').toLowerCase());
  const byName = new Map<string, { file: PickedFile; parts: string[] }[]>();
  for (const file of picked) {
    const p = parts(file.path);
    const name = p[p.length - 1];
    if (name === undefined) continue;
    const list = byName.get(name) ?? [];
    list.push({ file, parts: p });
    byName.set(name, list);
  }

  const found = new Map<string, PickedFile>();
  for (const track of library.tracks) {
    if (track.file.kind !== 'local') continue;
    const want = parts(track.file.path);
    const candidates = byName.get(want[want.length - 1] ?? '') ?? [];
    let best: PickedFile | null = null;
    let bestLength = 1;
    for (const candidate of candidates) {
      let same = 0;
      while (same < want.length && same < candidate.parts.length && want[want.length - 1 - same] === candidate.parts[candidate.parts.length - 1 - same]) same++;
      if (same > bestLength) {
        best = candidate.file;
        bestLength = same;
      }
    }
    if (best) found.set(track.sourceId, best);
  }
  return found;
}
