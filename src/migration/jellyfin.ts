// Jellyfin: signing in, and reading a user's music. It is RPM.Core/Migration/Jellyfin.cs of the
// desktop app. Jellyfin has no star ratings, so the rating is always 0.

import { isoDate, type RemoteFile, SkipReason, type SourceLibrary, type SourcePlaylist, type SourceSkip, type SourceTrack } from './model';
import { arr, base, blob, extensionOf, type Fetch, HttpStatus, json, type MediaServer, num, obj, SignInExpired, SignInFailed, str } from './server';

export interface JellyfinSession {
  server: string;
  serverId: string;
  userId: string;
  token: string;
}

const PAGE = 500;

function headers(deviceId: string, token: string | null): HeadersInit {
  const auth = `MediaBrowser Client="rpm", Device="rpm web", DeviceId="${deviceId}", Version="web"` + (token ? `, Token="${token}"` : '');
  return { Authorization: auth, 'Content-Type': 'application/json' };
}

const sessionOf = (server: string, answer: unknown): JellyfinSession => {
  const a = obj(answer);
  const user = obj(a['User']);
  return { server: base(server), serverId: str(a['ServerId']) || str(user['ServerId']), userId: str(user['Id']), token: str(a['AccessToken']) };
};

async function signInJson(fetcher: Fetch, url: string, init: RequestInit): Promise<unknown> {
  try {
    return await json(fetcher, url, init);
  } catch (error) {
    if (error instanceof SignInExpired || (error instanceof HttpStatus && error.status === 403)) throw new SignInFailed();
    throw error;
  }
}

export async function jellyfinWithPassword(fetcher: Fetch, server: string, deviceId: string, user: string, password: string): Promise<JellyfinSession> {
  const answer = await signInJson(fetcher, base(server) + 'Users/AuthenticateByName', {
    method: 'POST',
    headers: headers(deviceId, null),
    body: JSON.stringify({ Username: user, Pw: password }),
  });
  return sessionOf(server, answer);
}

export async function startQuickConnect(fetcher: Fetch, server: string, deviceId: string): Promise<{ code: string; secret: string }> {
  const a = obj(await signInJson(fetcher, base(server) + 'QuickConnect/Initiate', { method: 'POST', headers: headers(deviceId, null) }));
  return { code: str(a['Code']), secret: str(a['Secret']) };
}

// The session once the code is approved in another Jellyfin app, or null while it is not.
export async function finishQuickConnect(fetcher: Fetch, server: string, deviceId: string, secret: string): Promise<JellyfinSession | null> {
  const state = obj(await signInJson(fetcher, base(server) + `QuickConnect/Connect?secret=${encodeURIComponent(secret)}`, { headers: headers(deviceId, null) }));
  if (state['Authenticated'] !== true) return null;
  const answer = await signInJson(fetcher, base(server) + 'Users/AuthenticateWithQuickConnect', {
    method: 'POST',
    headers: headers(deviceId, null),
    body: JSON.stringify({ Secret: secret }),
  });
  return sessionOf(server, answer);
}

export class JellyfinServer implements MediaServer {
  readonly kind = 'jellyfin' as const;

  constructor(private readonly fetcher: Fetch, private readonly session: JellyfinSession, private readonly deviceId: string) {}

  private get(path: string, signal?: AbortSignal) {
    return json(this.fetcher, base(this.session.server) + path, { headers: headers(this.deviceId, this.session.token), signal });
  }

  private async *pages(path: string, signal?: AbortSignal, progress?: (count: number) => void): AsyncGenerator<Record<string, unknown>> {
    let start = 0;
    for (;;) {
      const page = obj(await this.get(`${path}${path.includes('?') ? '&' : '?'}StartIndex=${start}&Limit=${PAGE}`, signal));
      const items = arr(page['Items']).map(obj);
      for (const item of items) yield item;
      start += items.length;
      progress?.(start);
      if (items.length === 0 || start >= num(page['TotalRecordCount'])) return;
    }
  }

  async read(found: (count: number) => void, signal?: AbortSignal): Promise<SourceLibrary> {
    const name = str(obj(await this.get('System/Info/Public', signal))['ServerName']);
    const user = this.session.userId;

    const tracks: SourceTrack[] = [];
    const skipped: SourceSkip[] = [];
    for await (const item of this.pages(`Users/${user}/Items?IncludeItemTypes=Audio&Recursive=true&Fields=DateCreated,MediaSources,Path&EnableUserData=true`, signal, found)) {
      const track = trackOf(item);
      if ('what' in track) skipped.push(track);
      else tracks.push(track);
    }

    const known = new Set(tracks.map((t) => t.sourceId));
    const playlists: SourcePlaylist[] = [];
    for await (const playlist of this.pages(`Users/${user}/Items?IncludeItemTypes=Playlist&Recursive=true`, signal)) {
      const id = str(playlist['Id']);
      const trackIds: string[] = [];
      const unresolved: string[] = [];
      for await (const entry of this.pages(`Playlists/${id}/Items?userId=${user}`, signal)) {
        const entryId = str(entry['Id']);
        (known.has(entryId) ? trackIds : unresolved).push(entryId);
      }
      playlists.push({ sourceId: id, name: str(playlist['Name']), folder: [], smart: false, trackIds, unresolved });
    }
    return { kind: 'jellyfin', libraryId: this.session.serverId, name, tracks, playlists, skipped };
  }

  async open(file: RemoteFile, signal?: AbortSignal): Promise<Blob> {
    const id = encodeURIComponent(file.key);
    const init = { headers: headers(this.deviceId, this.session.token), signal };
    try {
      return await blob(this.fetcher, base(this.session.server) + `Items/${id}/Download`, init);
    } catch (error) {
      // Not allowed to download: the static stream is the same original file, open to every user who may
      // play the track.
      if (error instanceof HttpStatus && error.status === 403) return blob(this.fetcher, base(this.session.server) + `Audio/${id}/stream?static=true`, init);
      throw error;
    }
  }
}

// The track, or why it is not imported: a file that is not audio rpm reads.
function trackOf(item: Record<string, unknown>): SourceTrack | SourceSkip {
  const id = str(item['Id']);
  const source = obj(arr(item['MediaSources'])[0]);
  const albumArtist = str(item['AlbumArtist']);
  const artist = arr(item['Artists']).map(str).find((a) => a.length > 0) ?? albumArtist;
  const extension = extensionOf(str(source['Path']) || str(item['Path']), str(source['Container']) || str(item['Container']));
  if (!extension) return { what: artist ? `${artist} - ${str(item['Name'])}` : str(item['Name']), reasonKey: SkipReason.NotMusic };
  const size = num(source['Size']);
  const user = obj(item['UserData']);
  return {
    sourceId: id,
    file: { kind: 'remote', key: id, extension, size },
    title: str(item['Name']),
    artist,
    album: str(item['Album']),
    albumArtist,
    trackNumber: num(item['IndexNumber']),
    discNumber: num(item['ParentIndexNumber']),
    durationSeconds: num(item['RunTimeTicks']) / 10_000_000,
    sizeBytes: size,
    rating: 0,
    favorite: user['IsFavorite'] === true,
    plays: num(user['PlayCount']),
    lastPlayed: isoDate(str(user['LastPlayedDate'])),
    added: isoDate(str(item['DateCreated'])),
  };
}
