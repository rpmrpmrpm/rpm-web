import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { finishQuickConnect, jellyfinWithPassword, JellyfinServer, startQuickConnect, type JellyfinSession } from '../../src/migration/jellyfin';
import { ibroadcastAccount, ibroadcastApproval, IBROADCAST_CLIENT_ID, ibroadcastPoll, ibroadcastRevoke, IBroadcastServer, IBroadcastSession, ibroadcastStart,
  type IBroadcastAccount, type IBroadcastCode, type IBroadcastGrant } from '../../src/migration/ibroadcast';
import { md5 } from '../../src/migration/md5';
import { tagRule, type RemoteFile } from '../../src/migration/model';
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

  it('takes the file type from the path, and reads a container list as one type', async () => {
    const items = { TotalRecordCount: 3, Items: [
      { Id: 'j1', Name: 'A', MediaSources: [{ Container: 'mov,mp4,m4a,3gp,3g2,mj2', Path: '/media/music/a.m4a', Size: 10 }] },
      { Id: 'j2', Name: 'B', MediaSources: [{ Container: 'mov,mp4,m4a,3gp,3g2,mj2', Size: 10 }] },
      { Id: 'j3', Name: 'Clip', AlbumArtist: 'Band', MediaSources: [{ Container: 'matroska,webm', Path: '/media/music/clip.mkv', Size: 10 }] },
    ] };
    const { fetcher } = fake((url) => (url.searchParams.get('IncludeItemTypes') === 'Audio' ? new Response(JSON.stringify(items), { status: 200 }) : jellyfinAnswer(url)));
    const library = await new JellyfinServer(fetcher, session, 'dev').read(() => {});
    expect(library.tracks.map((t) => [t.sourceId, t.file.kind === 'remote' ? t.file.extension : ''])).toEqual([['j1', '.m4a'], ['j2', '.m4a']]);
    expect(library.skipped).toEqual([{ what: 'Band - Clip', reasonKey: 'Migration_SkipNotMusic' }]);
  });

  it('gives each track once from a server that ignores the start index', async () => {
    const { fetcher } = fake((url) => (url.searchParams.get('IncludeItemTypes') === 'Audio' ? sample('jellyfin/items-0.json') : jellyfinAnswer(url)));
    const library = await new JellyfinServer(fetcher, session, 'dev').read(() => {}, AbortSignal.timeout(5000));
    expect(library.tracks.map((t) => t.sourceId)).toEqual([...new Set(library.tracks.map((t) => t.sourceId))]);
    expect(library.tracks).toHaveLength(2);
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

  it('takes the file type from the file name, reads an mp4 container as m4a, and lists what it skips', async () => {
    const tracks = { MediaContainer: { totalSize: 4, Metadata: [
      { ratingKey: '601', title: 'A', Media: [{ container: 'mp4', Part: [{ key: '/library/parts/1/a.m4a', file: '/data/music/a.m4a', size: 10 }] }] },
      { ratingKey: '602', title: 'B', Media: [{ container: 'mp4', Part: [{ key: '/library/parts/2/file', size: 10 }] }] },
      { ratingKey: '603', title: 'Clip', grandparentTitle: 'Band', Media: [{ container: 'mkv', Part: [{ key: '/library/parts/3/file', file: '/data/music/clip.mkv', size: 10 }] }] },
      { ratingKey: '604', title: 'Stream', grandparentTitle: 'Band', Media: [{ container: 'mp3' }] },
    ] } };
    const { fetcher } = fake((url) => (url.pathname === '/library/sections/3/all' ? new Response(JSON.stringify(tracks), { status: 200 }) : plexAnswer(url)));
    const library = await new PlexServer(fetcher, choice, connection).read(() => {});
    expect(library.tracks.map((t) => [t.sourceId, t.file.kind === 'remote' ? t.file.extension : ''])).toEqual([['601', '.m4a'], ['602', '.m4a']]);
    expect(library.skipped).toEqual([{ what: 'Band - Clip', reasonKey: 'Migration_SkipNotMusic' }, { what: 'Band - Stream', reasonKey: 'Migration_SkipNotAFile' }]);
  });

  it('gives each track once from a server that ignores the container start', async () => {
    const { fetcher } = fake((url) => (url.pathname === '/library/sections/3/all' ? sample('plex/tracks-0.json') : plexAnswer(url)));
    const library = await new PlexServer(fetcher, choice, connection).read(() => {});
    expect(library.tracks).toHaveLength(2);
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

  it('reads a server that ignores paging once, instead of for ever', async () => {
    const { fetcher } = fake((url) => (url.pathname === '/rest/search3' ? sample('subsonic/search3-all.json') : subsonicAnswer(url)));
    const library = await new SubsonicServer(fetcher, login, 2).read(() => {}, AbortSignal.timeout(5000));
    expect(library.tracks.map((t) => t.sourceId)).toEqual(['s1', 's2', 's3']);
  });

  it('takes the file type from the path before the suffix', async () => {
    const page = { 'subsonic-response': { status: 'ok', searchResult3: { song: [{ id: 'n1', title: 'A', suffix: 'mp4', path: 'Band/Record/01 A.m4a', size: 10 }] } } };
    const { fetcher } = fake((url) => (url.pathname === '/rest/search3' ? new Response(JSON.stringify(page), { status: 200 }) : subsonicAnswer(url)));
    const library = await new SubsonicServer(fetcher, login, 2).read(() => {});
    expect(library.tracks.map((t) => (t.file.kind === 'remote' ? t.file.extension : ''))).toEqual(['.m4a']);
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

describe('iBroadcast', () => {
  const premium: IBroadcastAccount = { userId: '7654321', userName: 'testlistener', premium: true };
  const free: IBroadcastAccount = { ...premium, premium: false };
  const noon = Date.parse('2026-01-01T12:00:00Z');
  const opening: RemoteFile = { kind: 'remote', key: '101|/orig/a1b/c2d/101', extension: '.flac', size: 0 };
  const json200 = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const jsonStatus = (code: number, body: unknown) => new Response(JSON.stringify(body), { status: code, headers: { 'Content-Type': 'application/json' } });
  const form = (init: RequestInit | undefined) => new URLSearchParams(String(init?.body ?? ''));
  const code = (intervalMs = 1000): IBroadcastCode => ({ deviceCode: 'd-code', userCode: 'TESTCODE', page: 'https://oauth.ibroadcast.com/device?user_code=testcode', intervalMs, expiresAt: noon + 180_000 });

  function answer(url: URL): Response {
    if (url.host === 'library.ibroadcast.com') return sample('ibroadcast/library.json');
    if (url.host === 'oauth.ibroadcast.com') return sample('ibroadcast/token-refreshed.json');
    if (url.host === 'streaming.ibroadcast.com') return bytes([1, 2, 3]);
    return status(404);
  }

  function server(fetcher: Fetch, account: IBroadcastAccount, renewed: (grant: IBroadcastGrant) => void = () => {}) {
    const session = new IBroadcastSession(fetcher, { accessToken: 'access-token-0001', refreshToken: 'refresh-token-0001', expiresAt: Date.now() + 3_600_000 }, renewed);
    const waits: number[] = [];
    return { server: new IBroadcastServer(fetcher, session, account, 'Tags', async (ms) => { waits.push(ms); }), waits, session };
  }

  it('asks for a code with both scopes and the client id', async () => {
    const { fetcher, seen } = fake((url) => (url.pathname === '/device/code' ? sample('ibroadcast/device-code.json') : status(404)));
    const before = Date.now();
    const started = await ibroadcastStart(fetcher);
    expect(seen[0]!.url.searchParams.get('client_id')).toBe(IBROADCAST_CLIENT_ID);
    expect(seen[0]!.url.searchParams.get('scope')).toBe('user.library:read user.account:read');
    expect(started).toMatchObject({ userCode: 'TESTCODE', page: 'https://oauth.ibroadcast.com/device?user_code=testcode', intervalMs: 1000 });
    expect(started.expiresAt).toBeGreaterThanOrEqual(before + 179_000);
    expect(IBROADCAST_CLIENT_ID).toMatch(/^[0-9a-f]{32}$/);
  });

  it('gives the code to ask with next while it waits, with 5 seconds more after slow down', async () => {
    let error = 'authorization_pending';
    const { fetcher, seen } = fake(() => jsonStatus(error === 'slow_down' ? 429 : 400, { error }));
    expect(await ibroadcastPoll(fetcher, code())).toEqual({ kind: 'pending', code: code() });
    error = 'slow_down';
    expect(await ibroadcastPoll(fetcher, code())).toEqual({ kind: 'pending', code: code(6000) });
    expect(Object.fromEntries(form(seen[0]!.init))).toEqual({ grant_type: 'device_code', device_code: 'd-code', client_id: IBROADCAST_CLIENT_ID });
  });

  it('says when the code ran out, gives the grant once approved, and refuses a declined code', async () => {
    expect(await ibroadcastPoll(fake(() => jsonStatus(400, { error: 'expired_token' })).fetcher, code())).toEqual({ kind: 'expired' });
    const before = Date.now();
    const approved = await ibroadcastPoll(fake(() => sample('ibroadcast/token.json')).fetcher, code());
    expect(approved.kind === 'approved' && approved.grant).toMatchObject({ accessToken: 'access-token-0001', refreshToken: 'refresh-token-0001' });
    expect(approved.kind === 'approved' && approved.grant.expiresAt).toBeGreaterThanOrEqual(before + 3_599_000);
    await expect(ibroadcastPoll(fake(() => jsonStatus(400, { error: 'access_denied', error_description: 'The user denied the request' })).fetcher, code()))
      .rejects.toThrowError(SignInFailed);
  });

  it('reads the account id, name and premium', async () => {
    for (const [file, isPremium] of [['ibroadcast/status.json', true], ['ibroadcast/status-free.json', false]] as const) {
      const { fetcher, seen } = fake((url) => (url.href === 'https://api.ibroadcast.com/status' ? sample(file) : status(404)));
      const { session } = server(fetcher, premium);
      expect(await ibroadcastAccount(fetcher, session)).toEqual({ userId: '7654321', userName: 'testlistener', premium: isPremium });
      expect(header(seen[0]!.init, 'Authorization')).toBe('Bearer access-token-0001');
    }
  });

  it('renews once for two callers and hands the new grant to the keeper', async () => {
    const kept: IBroadcastGrant[] = [];
    const { fetcher, seen } = fake(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return sample('ibroadcast/token-refreshed.json');
    });
    const session = new IBroadcastSession(fetcher, { accessToken: 'access-token-0001', refreshToken: 'refresh-token-0001', expiresAt: noon + 3_600_000 }, (g) => kept.push(g), () => noon);
    expect(await Promise.all([session.renew('access-token-0001'), session.renew('access-token-0001')])).toEqual(['access-token-0002', 'access-token-0002']);
    expect(seen).toHaveLength(1);
    expect(Object.fromEntries(form(seen[0]!.init))).toEqual({ grant_type: 'refresh_token', refresh_token: 'refresh-token-0001', client_id: IBROADCAST_CLIENT_ID });
    expect(kept).toEqual([{ accessToken: 'access-token-0002', refreshToken: 'refresh-token-0002', expiresAt: noon + 3_599_000 }]);
    expect(session.grant).toEqual(kept[0]);
  });

  it('keeps the refresh token when a renewal sends none, renews a minute early, and stops on a refused renewal', async () => {
    const quiet = fake(() => json200({ access_token: 'access-token-0002', expires_in: 3599 }));
    const kept = new IBroadcastSession(quiet.fetcher, { accessToken: 'access-token-0001', refreshToken: 'refresh-token-0001', expiresAt: noon + 59_000 }, () => {}, () => noon);
    expect(await kept.token()).toBe('access-token-0002');
    expect(kept.grant.refreshToken).toBe('refresh-token-0001');
    const fresh = new IBroadcastSession(quiet.fetcher, { accessToken: 'access-token-0001', refreshToken: 'refresh-token-0001', expiresAt: noon + 61_000 }, () => {}, () => noon);
    expect(await fresh.token()).toBe('access-token-0001');
    for (const error of ['invalid_grant', 'invalid_token']) {
      const refused = new IBroadcastSession(fake(() => jsonStatus(400, { error })).fetcher, { accessToken: 'a', refreshToken: 'r', expiresAt: noon }, () => {}, () => noon);
      await expect(refused.renew('a')).rejects.toThrowError(SignInExpired);
    }
    const broken = new IBroadcastSession(fake(() => status(502)).fetcher, { accessToken: 'a', refreshToken: 'r', expiresAt: noon }, () => {}, () => noon);
    await expect(broken.renew('a')).rejects.not.toThrowError(SignInExpired);
  });

  it('revokes with the refresh token', async () => {
    const { fetcher, seen } = fake(() => new Response('OK'));
    await ibroadcastRevoke(fetcher, 'refresh-token-0002');
    expect(seen[0]!.url.pathname).toBe('/revoke');
    expect(Object.fromEntries(form(seen[0]!.init))).toEqual({ refresh_token: 'refresh-token-0002', client_id: IBROADCAST_CLIENT_ID });
  });

  it('matches the expected result for the sample', async () => {
    const { fetcher } = fake(answer);
    expect(shape(await server(fetcher, premium).server.read(() => {}))).toEqual(expected('ibroadcast'));
  });

  it('asks the library server with the client named in the body', async () => {
    const { fetcher, seen } = fake(answer);
    const library = await server(fetcher, premium).server.read(() => {});
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url.href).toBe('https://library.ibroadcast.com/');
    expect(seen[0]!.init?.method).toBe('POST');
    expect(header(seen[0]!.init, 'Authorization')).toBe('Bearer access-token-0001');
    const body = JSON.parse(String(seen[0]!.init?.body)) as Record<string, string>;
    expect(body).toMatchObject({ mode: 'library', client: 'rpm', device_name: 'rpm' });
    expect(body['version']).toBeTruthy();
    expect(body['user_agent']).toBeTruthy();
    expect([library.kind, tagRule(library.kind)]).toEqual(['ibroadcast', 'source']);
  });

  it('reads a free account as 128 kbps MP3 copies of unknown size', async () => {
    const library = await server(fake(answer).fetcher, free).server.read(() => {});
    for (const track of library.tracks) {
      expect(track.file.kind === 'remote' && track.file.key).toContain('|/128/');
      expect(track.file).toMatchObject({ extension: '.mp3', size: 0 });
      expect(track.sizeBytes).toBe(Math.round(track.durationSeconds * 16_000));
    }
    expect(library.tracks[0]!.sizeBytes).toBe(3_856_000);
  });

  it('opens a file with the signature, file and user in the address only', async () => {
    const { fetcher, seen } = fake(answer);
    const file = await server(fetcher, premium).server.open(opening);
    expect(seen).toHaveLength(1);
    const url = seen[0]!.url;
    expect([url.origin, url.pathname]).toEqual(['https://streaming.ibroadcast.com', '/orig/a1b/c2d/101']);
    expect(['Signature', 'file_id', 'user_id', 'platform'].map((n) => url.searchParams.get(n))).toEqual(['access-token-0001', '101', '7654321', 'rpm']);
    expect(url.searchParams.get('version')).toBeTruthy();
    expect(seen[0]!.init?.headers).toBeUndefined();
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('renews once when a file is refused, then stops', async () => {
    for (const refusal of [401, 403]) {
      const { fetcher, seen } = fake((url) => (url.host === 'streaming.ibroadcast.com' ? status(refusal) : answer(url)));
      await expect(server(fetcher, premium).server.open(opening)).rejects.toThrowError(SignInExpired);
      expect(seen.filter((s) => s.url.host === 'oauth.ibroadcast.com')).toHaveLength(1);
      expect(seen.filter((s) => s.url.host === 'streaming.ibroadcast.com').map((s) => s.url.searchParams.get('Signature'))).toEqual(['access-token-0001', 'access-token-0002']);
    }
  });

  it('waits when the streaming server is busy, then fails for later', async () => {
    const busy = fake(() => new Response('', { status: 429, headers: { 'Retry-After': '7' } }));
    const first = server(busy.fetcher, premium);
    await expect(first.server.open(opening)).rejects.toMatchObject({ status: 429 });
    expect(busy.seen).toHaveLength(3);
    expect(first.waits).toEqual([7000, 7000]);

    let once = true;
    const later = fake((url) => {
      if (!once) return answer(url);
      once = false;
      return status(429);
    });
    const second = server(later.fetcher, premium);
    await second.server.open(opening);
    expect(second.waits).toEqual([30_000]);
  });

  it('waits until the date a busy answer gives, and on a 503 that says when to come back', async () => {
    const at = new Date(Date.now() + 40_000).toUTCString();
    let first = true;
    const dated = fake((url) => {
      if (!first) return answer(url);
      first = false;
      return new Response('', { status: 429, headers: { 'Retry-After': at } });
    });
    const one = server(dated.fetcher, premium);
    await one.server.open(opening);
    expect(one.waits).toHaveLength(1);
    expect(one.waits[0]).toBeGreaterThanOrEqual(35_000);
    expect(one.waits[0]).toBeLessThanOrEqual(41_000);

    let down = true;
    const unavailable = fake((url) => {
      if (!down) return answer(url);
      down = false;
      return new Response('', { status: 503, headers: { 'Retry-After': '12' } });
    });
    const two = server(unavailable.fetcher, premium);
    await two.server.open(opening);
    expect(two.waits).toEqual([12_000]);
  });

  it('finishes a renewal that was sent when the caller aborts', async () => {
    const kept: IBroadcastGrant[] = [];
    let sent!: () => void;
    const sending = new Promise<void>((done) => (sent = done));
    const fetcher: Fetch = async (_url, init) => {
      sent();
      await new Promise((done) => setTimeout(done, 50));
      if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return sample('ibroadcast/token-refreshed.json');
    };
    const session = new IBroadcastSession(fetcher, { accessToken: 'access-token-0001', refreshToken: 'refresh-token-0001', expiresAt: noon }, (g) => kept.push(g), () => noon);
    const stop = new AbortController();
    const renewing = session.renew('access-token-0001', stop.signal).catch(() => null);
    await sending;
    stop.abort();
    await renewing;
    expect(kept.map((g) => g.refreshToken)).toEqual(['refresh-token-0002']);
    expect(session.grant.refreshToken).toBe('refresh-token-0002');
  });

  it('waits for approval, shows each new code, and gives the grant', async () => {
    let polls = 0;
    let codes = 0;
    const { fetcher } = fake((url) => {
      if (url.pathname === '/device/code') {
        codes++;
        return sample('ibroadcast/device-code.json');
      }
      polls++;
      return polls === 1 ? jsonStatus(400, { error: 'expired_token' }) : polls === 2 ? jsonStatus(400, { error: 'authorization_pending' }) : sample('ibroadcast/token.json');
    });
    const shown: string[] = [];
    const grant = await ibroadcastApproval(fetcher, new AbortController().signal, (c) => shown.push(c.userCode), async () => {});
    expect(grant?.accessToken).toBe('access-token-0001');
    expect([codes, shown]).toEqual([2, ['TESTCODE', 'TESTCODE']]);
  });

  it('stops waiting for approval when aborted, and asks for nothing more', async () => {
    const stop = new AbortController();
    const { fetcher, seen } = fake((url) => (url.pathname === '/device/code' ? sample('ibroadcast/device-code.json') : jsonStatus(400, { error: 'expired_token' })));
    const shown: string[] = [];
    const grant = await ibroadcastApproval(fetcher, stop.signal, (c) => shown.push(c.userCode), async () => {
      stop.abort();
    });
    expect(grant).toBeNull();
    expect(shown).toEqual(['TESTCODE']);
    expect(seen.map((s) => s.url.pathname)).toEqual(['/device/code']);
  });

  it('renews when the library answers unauthenticated, then stops', async () => {
    const { fetcher, seen } = fake((url) => (url.host === 'library.ibroadcast.com' ? json200({ message: 'Error, user authentication failed', result: false, authenticated: false }) : answer(url)));
    await expect(server(fetcher, premium).server.read(() => {})).rejects.toThrowError(SignInExpired);
    expect(seen.filter((s) => s.url.host === 'oauth.ibroadcast.com')).toHaveLength(1);
    expect(seen.filter((s) => s.url.host === 'library.ibroadcast.com')).toHaveLength(2);
  });

  it('reads rows written as objects the same as rows read through the map', async () => {
    const { fetcher } = fake(() => json200({ result: true, library: {
      tracks: { 5: { title: 'Song', album_id: 7, artist_id: 8, track: 2, year: 1990, genre: 'Pop', length: 100, type: 'audio/flac', file: '/128/x/5', size: 1000, plays: 4, rating: 5, trashed: false, uploaded_on: '2020-02-03', uploaded_time: '04:05:06' } },
      albums: { 7: { name: 'Album', artist_id: 8, disc: 1, year: 1990, trashed: false, tracks: [5] } },
      artists: { 8: { name: 'Singer', tracks: [5], trashed: false } },
      playlists: { map: null }, tags: { map: null },
    } }));
    const [track] = (await server(fetcher, premium).server.read(() => {})).tracks;
    expect(track).toEqual({
      sourceId: '5', file: { kind: 'remote', key: '5|/orig/x/5', extension: '.flac', size: 0 }, title: 'Song', artist: 'Singer', album: 'Album', albumArtist: 'Singer',
      trackNumber: 2, discNumber: 1, year: 1990, genre: 'Pop', durationSeconds: 100, sizeBytes: 1000, rating: 0, favorite: true, plays: 4, lastPlayed: null,
      added: new Date('2020-02-03T04:05:06Z'),
    });
  });
});
