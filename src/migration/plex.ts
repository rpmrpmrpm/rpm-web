// Plex: the plex.tv PIN sign-in (the person signs in on plex.tv; rpm never sees the password), the
// account's servers, and reading a server's music. It is RPM.Core/Migration/Plex.cs of the desktop app.
// Plex rates out of 10, the same scale as rpm, and has no favourites.

import { type RemoteFile, SkipReason, type SourceLibrary, type SourcePlaylist, type SourceSkip, type SourceTrack } from './model';
import { arr, base, blob, extensionOf, type Fetch, json, type MediaServer, num, obj, str } from './server';

export interface PlexPin {
  id: number;
  code: string;
  authPage: string;
}

export interface PlexServerChoice {
  name: string;
  machineId: string;
  accessToken: string;
  connections: string[]; // best first
}

const PLEX_TV = 'https://plex.tv/';
const PAGE = 500;

const headers = (clientId: string | null, token: string | null): HeadersInit => ({
  Accept: 'application/json',
  'X-Plex-Product': 'rpm',
  ...(clientId ? { 'X-Plex-Client-Identifier': clientId } : {}),
  ...(token ? { 'X-Plex-Token': token } : {}),
});

export async function plexStart(fetcher: Fetch, clientId: string): Promise<PlexPin> {
  const pin = obj(await json(fetcher, PLEX_TV + 'api/v2/pins?strong=true', { method: 'POST', headers: headers(clientId, null) }));
  const code = str(pin['code']);
  return {
    id: num(pin['id']),
    code,
    authPage: `https://app.plex.tv/auth#?clientID=${encodeURIComponent(clientId)}&code=${encodeURIComponent(code)}&context%5Bdevice%5D%5Bproduct%5D=rpm`,
  };
}

// The account token once the person approved the code, or null while they have not.
export async function plexFinish(fetcher: Fetch, clientId: string, pin: PlexPin): Promise<string | null> {
  const answer = obj(await json(fetcher, PLEX_TV + `api/v2/pins/${pin.id}?code=${encodeURIComponent(pin.code)}`, { headers: headers(clientId, null) }));
  return str(answer['authToken']) || null;
}

// The servers the account can use, connections best first: https (a web page can only use https), then
// direct before relayed, then on the home network before the internet.
export async function plexServers(fetcher: Fetch, clientId: string, accountToken: string): Promise<PlexServerChoice[]> {
  const resources = arr(await json(fetcher, PLEX_TV + 'api/v2/resources?includeHttps=1&includeRelay=1', { headers: headers(clientId, accountToken) })).map(obj);
  const rank = (c: Record<string, unknown>) => (str(c['protocol']) === 'https' ? 0 : 4) + (c['relay'] === true ? 2 : 0) + (c['local'] === true ? 0 : 1);
  return resources
    .filter((r) => str(r['provides']).split(',').includes('server'))
    .map((r) => ({
      name: str(r['name']),
      machineId: str(r['clientIdentifier']),
      accessToken: str(r['accessToken']),
      connections: arr(r['connections']).map(obj).sort((a, b) => rank(a) - rank(b)).map((c) => str(c['uri'])).filter((u) => u.length > 0),
    }));
}

// The first connection that answers within a few seconds, or null.
export async function plexPickConnection(fetcher: Fetch, server: PlexServerChoice, timeoutMs = 5000): Promise<string | null> {
  for (const connection of server.connections) {
    try {
      const identity = obj(obj(await json(fetcher, base(connection) + 'identity', { headers: headers(null, server.accessToken), signal: AbortSignal.timeout(timeoutMs) }))['MediaContainer']);
      if (str(identity['machineIdentifier']) === server.machineId) return connection;
    } catch {
      // Not reachable from here: try the next address.
    }
  }
  return null;
}

export class PlexServer implements MediaServer {
  readonly kind = 'plex' as const;

  constructor(private readonly fetcher: Fetch, private readonly server: PlexServerChoice, private readonly connection: string) {}

  private get(path: string, signal?: AbortSignal) {
    return json(this.fetcher, base(this.connection) + path, { headers: headers(null, this.server.accessToken), signal });
  }

  private async *pages(path: string, signal?: AbortSignal): AsyncGenerator<Record<string, unknown>> {
    let start = 0;
    for (;;) {
      const page = obj(obj(await this.get(`${path}${path.includes('?') ? '&' : '?'}X-Plex-Container-Start=${start}&X-Plex-Container-Size=${PAGE}`, signal))['MediaContainer']);
      const items = arr(page['Metadata']).map(obj);
      for (const item of items) yield item;
      start += items.length;
      const total = num(page['totalSize']);
      if (items.length === 0 || (total > 0 && start >= total) || (total === 0 && items.length < PAGE)) return;
    }
  }

  async read(found: (count: number) => void, signal?: AbortSignal): Promise<SourceLibrary> {
    const sections = arr(obj(obj(await this.get('library/sections', signal))['MediaContainer'])['Directory']).map(obj);
    const tracks: SourceTrack[] = [];
    const skipped: SourceSkip[] = [];
    for (const section of sections.filter((d) => str(d['type']) === 'artist')) {
      for await (const item of this.pages(`library/sections/${encodeURIComponent(str(section['key']))}/all?type=10`, signal)) {
        const track = trackOf(item);
        if ('what' in track) skipped.push(track);
        else tracks.push(track);
      }
      found(tracks.length);
    }

    const known = new Set(tracks.map((t) => t.sourceId));
    const playlists: SourcePlaylist[] = [];
    const lists = arr(obj(obj(await this.get('playlists?playlistType=audio', signal))['MediaContainer'])['Metadata']).map(obj);
    for (const playlist of lists) {
      const key = str(playlist['ratingKey']);
      const trackIds: string[] = [];
      const unresolved: string[] = [];
      for await (const entry of this.pages(`playlists/${encodeURIComponent(key)}/items`, signal)) {
        const entryKey = str(entry['ratingKey']);
        (known.has(entryKey) ? trackIds : unresolved).push(entryKey);
      }
      playlists.push({ sourceId: key, name: str(playlist['title']), folder: [], smart: playlist['smart'] === true, trackIds, unresolved });
    }
    return { kind: 'plex', libraryId: this.server.machineId, name: this.server.name, tracks, playlists, skipped };
  }

  open(file: RemoteFile, signal?: AbortSignal): Promise<Blob> {
    const path = file.key.replace(/^\//, '') + (file.key.includes('?') ? '&' : '?') + 'download=1';
    return blob(this.fetcher, base(this.connection) + path, { headers: headers(null, this.server.accessToken), signal });
  }
}

// The track, or why it is not imported: no file part (a stream from an online service), or a file that is not
// audio rpm reads.
function trackOf(item: Record<string, unknown>): SourceTrack | SourceSkip {
  const media = obj(arr(item['Media'])[0]);
  const part = obj(arr(media['Part'])[0]);
  const key = str(part['key']);
  const albumArtist = str(item['grandparentTitle']);
  const artist = str(item['originalTitle']) || albumArtist;
  const what = artist ? `${artist} - ${str(item['title'])}` : str(item['title']);
  if (!key) return { what, reasonKey: SkipReason.NotAFile };
  const extension = extensionOf(str(part['file']), str(part['container']) || str(media['container']));
  if (!extension) return { what, reasonKey: SkipReason.NotMusic };
  const size = num(part['size']);
  const lastViewed = num(item['lastViewedAt']);
  const added = num(item['addedAt']);
  return {
    sourceId: str(item['ratingKey']),
    file: { kind: 'remote', key, extension, size },
    title: str(item['title']),
    artist,
    album: str(item['parentTitle']),
    albumArtist,
    trackNumber: num(item['index']),
    discNumber: num(item['parentIndex']),
    durationSeconds: num(item['duration']) / 1000,
    sizeBytes: size,
    rating: Math.min(10, Math.max(0, Math.round(num(item['userRating'])))),
    favorite: false,
    plays: num(item['viewCount']),
    lastPlayed: lastViewed > 0 ? new Date(lastViewed * 1000) : null,
    added: added > 0 ? new Date(added * 1000) : null,
  };
}
