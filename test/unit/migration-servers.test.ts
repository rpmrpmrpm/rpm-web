import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { finishQuickConnect, jellyfinWithPassword, JellyfinServer, startQuickConnect, type JellyfinSession } from '../../src/migration/jellyfin';
import { md5 } from '../../src/migration/md5';
import { plexFinish, plexPickConnection, PlexServer, plexServers, plexStart, type PlexServerChoice } from '../../src/migration/plex';
import { reachable, SignInExpired, SignInFailed, type Fetch } from '../../src/migration/server';
import { subsonicCheck, SubsonicServer } from '../../src/migration/subsonic';
import { expected, fixture, shape } from './migration-fixture';

interface Seen {
  url: URL;
  init: RequestInit | undefined;
}

function fake(answer: (url: URL, init: RequestInit | undefined) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const fetcher: Fetch = async (url, init) => {
    const parsed = new URL(url);
    seen.push({ url: parsed, init });
    return answer(parsed, init);
  };
  return { fetcher, seen };
}

const sample = (path: string) => new Response(fixture(path), { status: 200, headers: { 'Content-Type': 'application/json' } });
const status = (code: number) => new Response('', { status: code });
const bytes = (data: number[]) => new Response(new Uint8Array(data));
const header = (init: RequestInit | undefined, name: string) => new Headers(init?.headers).get(name);

const session: JellyfinSession = { server: 'http://192.168.1.20:8096/', serverId: 'f1e2d3c4b5a69788', userId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', token: 'jellyfin-token-0001' };

function jellyfinAnswer(url: URL): Response {
  const types = url.searchParams.get('IncludeItemTypes');
  if (url.pathname === '/System/Info/Public') return sample('jellyfin/public-info.json');
  if (url.pathname === `/Users/${session.userId}/Items` && types === 'Playlist') return sample('jellyfin/playlists.json');
  if (url.pathname === `/Users/${session.userId}/Items` && types === 'Audio') return sample(url.searchParams.get('StartIndex') === '2' ? 'jellyfin/items-2.json' : 'jellyfin/items-0.json');
  if (url.pathname === '/Playlists/00000000000000000000000000000pl1/Items') return sample('jellyfin/playlist-items.json');
  return status(404);
}

describe('Jellyfin', () => {
  it('matches the expected result for the sample', async () => {
    const { fetcher } = fake(jellyfinAnswer);
    expect(shape(await new JellyfinServer(fetcher, session, 'dev').read(() => {}))).toEqual(expected('jellyfin'));
  });

  it('reads every page and sends the token each time', async () => {
    const { fetcher, seen } = fake(jellyfinAnswer);
    await new JellyfinServer(fetcher, session, 'dev').read(() => {});
    expect(seen.filter((s) => s.url.searchParams.get('IncludeItemTypes') === 'Audio').map((s) => s.url.searchParams.get('StartIndex'))).toEqual(['0', '2']);
    for (const s of seen) expect(header(s.init, 'Authorization')).toContain('Token="jellyfin-token-0001"');
  });

  it('falls back to the static stream when downloads are not allowed', async () => {
    const { fetcher } = fake((url) => (url.pathname === '/Items/j1/Download' ? status(403) : url.pathname === '/Audio/j1/stream' && url.searchParams.get('static') === 'true' ? bytes([1, 2, 3]) : status(404)));
    const file = await new JellyfinServer(fetcher, session, 'dev').open({ kind: 'remote', key: 'j1', extension: '.flac', size: 3 });
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it('throws SignInExpired on 401', async () => {
    const { fetcher } = fake(() => status(401));
    await expect(new JellyfinServer(fetcher, session, 'dev').read(() => {})).rejects.toBeInstanceOf(SignInExpired);
  });

  it('signs in with a password, sending the names as Jellyfin writes them', async () => {
    const { fetcher, seen } = fake((url, init) => (url.pathname === '/Users/AuthenticateByName' && init?.method === 'POST' ? sample('jellyfin/authenticate.json') : status(404)));
    expect(await jellyfinWithPassword(fetcher, 'http://192.168.1.20:8096', 'dev', 'test', 'secret')).toEqual(session);
    expect(String(seen[0]!.init?.body)).toBe('{"Username":"test","Pw":"secret"}');
    expect(header(seen[0]!.init, 'Authorization')).toContain('Client="rpm"');
  });

  it('turns a refused password into SignInFailed', async () => {
    const { fetcher } = fake(() => status(401));
    await expect(jellyfinWithPassword(fetcher, session.server, 'dev', 'test', 'wrong')).rejects.toBeInstanceOf(SignInFailed);
  });

  it('waits for a Quick Connect approval', async () => {
    let approved = false;
    const { fetcher } = fake((url) => {
      if (url.pathname === '/QuickConnect/Initiate') return sample('jellyfin/quickconnect-initiate.json');
      if (url.pathname === '/QuickConnect/Connect') return sample(approved ? 'jellyfin/quickconnect-approved.json' : 'jellyfin/quickconnect-pending.json');
      if (url.pathname === '/Users/AuthenticateWithQuickConnect') return sample('jellyfin/authenticate.json');
      return status(404);
    });
    const { code, secret } = await startQuickConnect(fetcher, session.server, 'dev');
    expect(code).toBe('123456');
    expect(await finishQuickConnect(fetcher, session.server, 'dev', secret)).toBeNull();
    approved = true;
    expect(await finishQuickConnect(fetcher, session.server, 'dev', secret)).toEqual(session);
  });
});

const connection = 'https://192-168-1-10.0123456789abcdef.plex.direct:32400';
const choice: PlexServerChoice = { name: 'Home Plex', machineId: 'machine-1234', accessToken: 'plex-server-token', connections: [connection] };

function plexAnswer(url: URL): Response {
  switch (url.pathname) {
    case '/identity': return sample('plex/identity.json');
    case '/library/sections': return sample('plex/sections.json');
    case '/library/sections/3/all': return sample(url.searchParams.get('X-Plex-Container-Start') === '2' ? 'plex/tracks-2.json' : 'plex/tracks-0.json');
    case '/playlists': return sample('plex/playlists.json');
    case '/playlists/700/items': return sample('plex/playlist-700.json');
    case '/playlists/701/items': return sample('plex/playlist-701.json');
    default: return status(404);
  }
}

describe('Plex', () => {
  it('matches the expected result for the sample', async () => {
    const { fetcher } = fake(plexAnswer);
    expect(shape(await new PlexServer(fetcher, choice, connection).read(() => {}))).toEqual(expected('plex'));
  });

  it('gets the account token once the code is approved', async () => {
    let linked = false;
    const { fetcher, seen } = fake((url, init) =>
      url.pathname === '/api/v2/pins' && init?.method === 'POST' ? sample('plex/pin-new.json')
      : url.pathname === '/api/v2/pins/12345' ? sample(linked ? 'plex/pin-linked.json' : 'plex/pin-new.json')
      : status(404));
    const pin = await plexStart(fetcher, 'rpm-test-client');
    expect(pin.authPage).toContain('clientID=rpm-test-client');
    expect(pin.authPage).toContain('code=abcd1234efgh');
    expect(header(seen[0]!.init, 'X-Plex-Client-Identifier')).toBe('rpm-test-client');
    expect(await plexFinish(fetcher, 'rpm-test-client', pin)).toBeNull();
    linked = true;
    expect(await plexFinish(fetcher, 'rpm-test-client', pin)).toBe('plex-account-token');
  });

  it('lists servers with https, direct and local connections first', async () => {
    const { fetcher } = fake((url) => (url.pathname === '/api/v2/resources' ? sample('plex/resources.json') : status(404)));
    const servers = await plexServers(fetcher, 'rpm-test-client', 'plex-account-token');
    expect(servers).toHaveLength(1);
    expect(servers[0]!.connections).toEqual([
      'https://192-168-1-10.0123456789abcdef.plex.direct:32400',
      'https://1-2-3-4.0123456789abcdef.plex.direct:32400',
      'https://5-6-7-8.0123456789abcdef.plex.direct:8443',
      'http://192.168.1.10:32400',
    ]);
  });

  it('puts a direct connection before a relayed one', async () => {
    const resources = [{ name: 'S', provides: 'server', clientIdentifier: 'm', accessToken: 't', connections: [
      { protocol: 'https', uri: 'https://relay.plex.direct:8443', local: false, relay: true },
      { protocol: 'https', uri: 'https://direct.plex.direct:32400', local: false, relay: false },
    ] }];
    const { fetcher } = fake(() => new Response(JSON.stringify(resources)));
    const [server] = await plexServers(fetcher, 'c', 't');
    expect(server!.connections).toEqual(['https://direct.plex.direct:32400', 'https://relay.plex.direct:8443']);
  });

  it('picks the first connection that answers', async () => {
    const remote = 'https://1-2-3-4.0123456789abcdef.plex.direct:32400';
    const { fetcher } = fake((url) => {
      if (url.host.startsWith('1-2-3-4')) return sample('plex/identity.json');
      throw new TypeError('unreachable');
    });
    expect(await plexPickConnection(fetcher, { ...choice, connections: [connection, remote] })).toBe(remote);
  });

  it('downloads the part with the download flag', async () => {
    const { fetcher } = fake((url) => (url.pathname === '/library/parts/9001/1500000000/file.flac' && url.searchParams.get('download') === '1' ? bytes([7, 8]) : status(404)));
    const file = await new PlexServer(fetcher, choice, connection).open({ kind: 'remote', key: '/library/parts/9001/1500000000/file.flac', extension: '.flac', size: 2 });
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([7, 8]);
  });
});

const login = { server: 'http://nas.local:4533', user: 'test', password: 'secret' };

function subsonicAnswer(url: URL): Response {
  switch (url.pathname) {
    case '/rest/ping': return sample('subsonic/ping.json');
    case '/rest/search3': {
      const offset = url.searchParams.get('songOffset');
      return sample(offset === '0' ? 'subsonic/search3-0.json' : offset === '2' ? 'subsonic/search3-2.json' : 'subsonic/search3-end.json');
    }
    case '/rest/getPlaylists': return sample('subsonic/getPlaylists.json');
    case '/rest/getPlaylist': return url.searchParams.get('id') === 'p1' ? sample('subsonic/getPlaylist-p1.json') : status(404);
    default: return status(404);
  }
}

describe('Navidrome and Subsonic', () => {
  it('matches the expected result for the sample', async () => {
    const { fetcher } = fake(subsonicAnswer);
    expect(shape(await new SubsonicServer(fetcher, login, 2).read(() => {}))).toEqual(expected('navidrome'));
  });

  it('sends the MD5 of the password and a fresh salt, never the password', async () => {
    const { fetcher, seen } = fake(subsonicAnswer);
    await new SubsonicServer(fetcher, login, 2).read(() => {});
    const salts = new Set<string>();
    for (const { url } of seen) {
      const salt = url.searchParams.get('s')!;
      salts.add(salt);
      expect(url.searchParams.get('t')).toBe(createHash('md5').update('secret' + salt).digest('hex'));
      expect(url.toString()).not.toContain('secret');
    }
    expect(salts.size).toBe(seen.length);
  });

  it('pages until a short page', async () => {
    const { fetcher, seen } = fake(subsonicAnswer);
    await new SubsonicServer(fetcher, login, 2).read(() => {});
    expect(seen.filter((s) => s.url.pathname === '/rest/search3').map((s) => s.url.searchParams.get('songOffset'))).toEqual(['0', '2']);
  });

  it('turns a download refused with error 40 into SignInExpired, not a file', async () => {
    // Subsonic servers answer a refused download with status 200 and an error as the body.
    const { fetcher } = fake(() => sample('subsonic/error-40.json'));
    await expect(new SubsonicServer(fetcher, login, 2).open({ kind: 'remote', key: 's1', extension: '.flac', size: 3 })).rejects.toBeInstanceOf(SignInExpired);
  });

  it('turns a download refused with another error into a failure, not a file', async () => {
    const refusal = { 'subsonic-response': { status: 'failed', error: { code: 70, message: 'Song not found' } } };
    const { fetcher } = fake(() => new Response(JSON.stringify(refusal), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } }));
    await expect(new SubsonicServer(fetcher, login, 2).open({ kind: 'remote', key: 's1', extension: '.flac', size: 3 })).rejects.toThrow('Song not found');
  });

  it('turns error 40 into SignInExpired during a read and SignInFailed at the check', async () => {
    const { fetcher } = fake(() => sample('subsonic/error-40.json'));
    await expect(new SubsonicServer(fetcher, login, 2).read(() => {})).rejects.toBeInstanceOf(SignInExpired);
    await expect(subsonicCheck(fetcher, login)).rejects.toMatchObject({ serverMessage: 'Wrong username or password' });
  });
});

describe('MD5', () => {
  it('matches node for short, long and accented text', () => {
    for (const text of ['', 'a', 'secret' + 'ab12cd34', 'é'.repeat(100), 'x'.repeat(1000)]) {
      expect(md5(text)).toBe(createHash('md5').update(text).digest('hex'));
    }
  });
});

describe('reaching a server from the page', () => {
  it('blocks plain http from an https page, except this computer', () => {
    expect(reachable('http://192.168.1.20:8096', 'https:')).toBe('blocked');
    expect(reachable('https://music.example.com', 'https:')).toBe('ok');
    expect(reachable('http://localhost:8096', 'https:')).toBe('ok');
    expect(reachable('http://192.168.1.20:8096', 'http:')).toBe('ok');
  });
});
