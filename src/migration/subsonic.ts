// Navidrome, or any server that speaks the Subsonic API. It is RPM.Core/Migration/Subsonic.cs of the
// desktop app: the rating (1 to 5) is doubled to rpm's 0 to 10, a star is a favourite, and the password
// is never sent, only the MD5 of it with a fresh salt, as the protocol defines.

import { md5 } from './md5';
import { isoDate, type RemoteFile, shortHash, SkipReason, type SourceLibrary, type SourcePlaylist, type SourceSkip, type SourceTrack } from './model';
import { arr, base, blob, extensionOf, type Fetch, FirstPage, json, type MediaServer, num, obj, SignInExpired, SignInFailed, str } from './server';

export interface SubsonicLogin {
  server: string;
  user: string;
  password: string;
}

class SubsonicError extends Error {
  constructor(readonly code: number, readonly serverMessage: string) {
    super(serverMessage);
  }
}

export function subsonicUrl(login: SubsonicLogin, method: string, query: string): string {
  const salt = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const auth = `u=${encodeURIComponent(login.user)}&t=${md5(login.password + salt)}&s=${salt}&v=1.16.1&c=rpm&f=json`;
  return `${base(login.server)}rest/${method}?${auth}${query ? '&' + query : ''}`;
}

async function call(fetcher: Fetch, login: SubsonicLogin, method: string, query: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const answer = obj(obj(await json(fetcher, subsonicUrl(login, method, query), { signal }))['subsonic-response']);
  if (str(answer['status']) !== 'ok') {
    const error = obj(answer['error']);
    throw new SubsonicError(num(error['code']), str(error['message']));
  }
  return answer;
}

// Checks a login before an import starts; a refusal carries the server's own message.
export async function subsonicCheck(fetcher: Fetch, login: SubsonicLogin): Promise<void> {
  try {
    await call(fetcher, login, 'ping', '');
  } catch (error) {
    if (error instanceof SubsonicError && (error.code === 40 || error.code === 41)) throw new SignInFailed(error.serverMessage);
    if (error instanceof SignInExpired) throw new SignInFailed();
    throw error;
  }
}

export class SubsonicServer implements MediaServer {
  readonly kind = 'navidrome' as const;

  constructor(private readonly fetcher: Fetch, private readonly login: SubsonicLogin, private readonly pageSize = 500) {}

  private async call(method: string, query: string, signal?: AbortSignal) {
    try {
      return await call(this.fetcher, this.login, method, query, signal);
    } catch (error) {
      if (error instanceof SubsonicError && (error.code === 40 || error.code === 41)) throw new SignInExpired();
      throw error;
    }
  }

  async read(found: (count: number) => void, signal?: AbortSignal): Promise<SourceLibrary> {
    const tracks: SourceTrack[] = [];
    const skipped: SourceSkip[] = [];
    const seen = new Set<string>();
    const first = new FirstPage();
    for (let offset = 0; ; offset += this.pageSize) {
      // An empty query lists every song, in pages. The API has no total, so a short page is the end.
      const page = await this.call('search3', `query=&artistCount=0&albumCount=0&songCount=${this.pageSize}&songOffset=${offset}`, signal);
      if (first.again(obj(page['searchResult3'])['song'])) break;
      const songs = arr(obj(page['searchResult3'])['song']).map(obj);
      for (const song of songs) {
        const track = trackOf(song);
        if ('what' in track) skipped.push(track);
        else if (!seen.has(track.sourceId)) {
          seen.add(track.sourceId);
          tracks.push(track);
        }
      }
      found(tracks.length);
      if (songs.length < this.pageSize) break;
    }

    const known = new Set(tracks.map((t) => t.sourceId));
    const playlists: SourcePlaylist[] = [];
    const lists = arr(obj((await this.call('getPlaylists', '', signal))['playlists'])['playlist']).map(obj);
    for (const playlist of lists) {
      const id = str(playlist['id']);
      const full = obj((await this.call('getPlaylist', 'id=' + encodeURIComponent(id), signal))['playlist']);
      const trackIds: string[] = [];
      const unresolved: string[] = [];
      for (const entry of arr(full['entry']).map(obj)) {
        const entryId = str(entry['id']);
        (known.has(entryId) ? trackIds : unresolved).push(entryId);
      }
      playlists.push({ sourceId: id, name: str(playlist['name']), folder: [], smart: false, trackIds, unresolved });
    }

    const server = this.login.server.replace(/\/+$/, '');
    return { kind: 'navidrome', libraryId: await shortHash(`${server}|${this.login.user}`), name: new URL(server).host, tracks, playlists, skipped };
  }

  // "download" gives the original file; "stream" could transcode and count as a play. A refused download still
  // has status 200: the body is a subsonic-response error, not the file.
  async open(file: RemoteFile, signal?: AbortSignal): Promise<Blob> {
    const body = await blob(this.fetcher, subsonicUrl(this.login, 'download', 'id=' + encodeURIComponent(file.key)), { signal });
    if (!/^(application\/json|text\/xml|application\/xml)\b/.test(body.type)) return body;
    let error: Record<string, unknown> = {};
    try {
      error = obj(obj(obj(JSON.parse(await body.text()))['subsonic-response'])['error']);
    } catch {
      throw new Error('The server answered the download with text instead of the file.');
    }
    const code = num(error['code']);
    if (code === 40 || code === 41) throw new SignInExpired();
    throw new Error(`The server refused the download: ${code} ${str(error['message'])}`.trim());
  }
}

// The track, or why it is not imported: a file that is not audio rpm reads.
function trackOf(song: Record<string, unknown>): SourceTrack | SourceSkip {
  const id = str(song['id']);
  const extension = extensionOf(str(song['path']), str(song['suffix']));
  if (!extension) return { what: str(song['artist']) ? `${str(song['artist'])} - ${str(song['title'])}` : str(song['title']), reasonKey: SkipReason.NotMusic };
  const size = num(song['size']);
  return {
    sourceId: id,
    file: { kind: 'remote', key: id, extension, size },
    title: str(song['title']),
    artist: str(song['artist']),
    album: str(song['album']),
    albumArtist: str(song['displayAlbumArtist']),
    trackNumber: num(song['track']),
    discNumber: num(song['discNumber']),
    durationSeconds: num(song['duration']),
    sizeBytes: size,
    rating: Math.min(10, Math.max(0, num(song['userRating']) * 2)),
    favorite: str(song['starred']).length > 0,
    plays: num(song['playCount']),
    lastPlayed: isoDate(str(song['played'])),
    added: isoDate(str(song['created'])),
  };
}
