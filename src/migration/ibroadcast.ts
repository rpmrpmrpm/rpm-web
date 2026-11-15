// iBroadcast: the device code sign-in (the person approves rpm on iBroadcast's site; rpm never sees the
// password), the token holder, and reading the library and its files. It is RPM.Core/Migration/IBroadcast.cs
// and IBroadcastSignIn.cs of the desktop app. Thumbs up is a favourite; iBroadcast has no star ratings for
// songs and does not keep when a song was last played. Every request only reads.

import { type RemoteFile, SkipReason, type SourceLibrary, type SourcePlaylist, type SourceSkip, type SourceTrack } from './model';
import { arr, extensionOf, type Fetch, HttpStatus, type MediaServer, num, obj, ServerBlocked, SignInExpired, SignInFailed, str } from './server';

// rpm's app as registered with iBroadcast. Public: a device code sign-in has no secret.
export const IBROADCAST_CLIENT_ID = '813e6017e13311f1b50eb49691aa2236';

const SCOPES = 'user.library:read user.account:read';
const OAUTH = 'https://oauth.ibroadcast.com/';
const API = 'https://api.ibroadcast.com/';
const LIBRARY = 'https://library.ibroadcast.com/';
const STREAMING = 'https://streaming.ibroadcast.com';
const VERSION: string = import.meta.env.VITE_RPM_VERSION ?? '0.0.0';
// A 128 kbps MP3 is 16,000 bytes a second, the size of a free account's copy.
const FREE_BYTES_PER_SECOND = 16_000;
const MOST_BUSY_ANSWERS = 3;

// A sign-in code. The person opens `page` (the code is filled in) and approves rpm there. `intervalMs` is how
// long to wait before asking again.
export interface IBroadcastCode {
  deviceCode: string;
  userCode: string;
  page: string;
  intervalMs: number;
  expiresAt: number; // ms
}

// The tokens of a sign-in. A renewal replaces both: after it, the old access token and the old refresh token
// are refused.
export interface IBroadcastGrant {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // ms
}

// The signed-in account. A free account gets 128 kbps MP3 copies instead of the original files.
export interface IBroadcastAccount {
  userId: string;
  userName: string;
  premium: boolean;
}

// The answer to "was the code approved?". 'pending' carries the code to ask with next: its interval is longer
// when the server asked rpm to slow down.
export type IBroadcastPoll = { kind: 'pending'; code: IBroadcastCode } | { kind: 'approved'; grant: IBroadcastGrant } | { kind: 'expired' };

async function send(fetcher: Fetch, url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetcher(url, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ServerBlocked();
  }
}

// Sends a form to the sign-in server and reads its JSON answer, whatever the status. An answer that is not JSON
// (the revoke answers "OK") reads as an empty object.
async function form(fetcher: Fetch, path: string, fields: Record<string, string>, signal?: AbortSignal): Promise<{ status: number; answer: Record<string, unknown> }> {
  const response = await send(fetcher, OAUTH + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
    signal,
  });
  let answer: Record<string, unknown> = {};
  try {
    answer = obj(JSON.parse(await response.text()));
  } catch {
    // Not JSON.
  }
  return { status: response.status, answer };
}

const grantOf = (answer: Record<string, unknown>, refreshToken: string | null, now: number): IBroadcastGrant => ({
  accessToken: str(answer['access_token']),
  refreshToken: str(answer['refresh_token']) || refreshToken || '',
  expiresAt: now + (num(answer['expires_in']) > 0 ? num(answer['expires_in']) : 3600) * 1000,
});

export async function ibroadcastStart(fetcher: Fetch): Promise<IBroadcastCode> {
  const response = await send(fetcher, `${OAUTH}device/code?client_id=${IBROADCAST_CLIENT_ID}&scope=${encodeURIComponent(SCOPES)}`);
  if (!response.ok) throw new HttpStatus(response.status);
  const answer = obj(await response.json());
  const seconds = num(answer['expires_in']);
  return {
    deviceCode: str(answer['device_code']),
    userCode: str(answer['user_code']),
    page: str(answer['verification_uri_complete']) || 'https://oauth.ibroadcast.com/device',
    intervalMs: Math.max(1, num(answer['interval'])) * 1000,
    expiresAt: Date.now() + (seconds > 0 ? seconds : 180) * 1000,
  };
}

export async function ibroadcastPoll(fetcher: Fetch, code: IBroadcastCode): Promise<IBroadcastPoll> {
  const { status, answer } = await form(fetcher, 'token', { grant_type: 'device_code', device_code: code.deviceCode, client_id: IBROADCAST_CLIENT_ID });
  if (status === 200) return { kind: 'approved', grant: grantOf(answer, null, Date.now()) };
  switch (str(answer['error'])) {
    case 'authorization_pending': return { kind: 'pending', code };
    // The device code standard (RFC 8628) asks for 5 seconds more from then on.
    case 'slow_down': return { kind: 'pending', code: { ...code, intervalMs: code.intervalMs + 5000 } };
    case 'expired_token': return { kind: 'expired' };
    case 'access_denied': throw new SignInFailed(str(answer['error_description']) || null);
    default: throw new HttpStatus(status);
  }
}

// The account the session belongs to: its id, its name, and whether it is Premium.
export async function ibroadcastAccount(fetcher: Fetch, session: IBroadcastSession, signal?: AbortSignal): Promise<IBroadcastAccount> {
  const user = obj((await post(fetcher, session, API + 'status', 'status', signal))['user']);
  return {
    userId: str(user['id']) || String(num(user['id'])),
    userName: str(user['username']),
    premium: user['premium'] === true || num(user['premium']) === 1,
  };
}

// Ends the sign-in on iBroadcast's side. The refresh token is refused afterwards.
export async function ibroadcastRevoke(fetcher: Fetch, refreshToken: string): Promise<void> {
  await form(fetcher, 'revoke', { refresh_token: refreshToken, client_id: IBROADCAST_CLIENT_ID });
}

// The tokens of one sign-in while an import uses them. It is the only way to get an access token, so a renewal
// happens in one place: two requests that find the token refused at the same time renew it once. A renewal
// replaces the refresh token too, and the old one is refused afterwards, so `renewed` is told every new grant.
export class IBroadcastSession {
  private current: IBroadcastGrant;
  private renewing: Promise<string> | null = null;

  constructor(
    private readonly fetcher: Fetch,
    grant: IBroadcastGrant,
    private readonly renewed: (grant: IBroadcastGrant) => void = () => {},
    private readonly now: () => number = Date.now,
  ) {
    this.current = grant;
  }

  get grant(): IBroadcastGrant {
    return this.current;
  }

  // An access token to send. A token with less than a minute left is renewed first.
  async token(signal?: AbortSignal): Promise<string> {
    return this.current.expiresAt - this.now() > 60_000 ? this.current.accessToken : this.renew(this.current.accessToken, signal);
  }

  // Renews the tokens after iBroadcast refused `stale`. When another request renewed them meanwhile, or is
  // renewing them now, its token is used: a second renewal would send a refresh token the first one spent.
  async renew(stale: string, signal?: AbortSignal): Promise<string> {
    if (this.current.accessToken !== stale) return this.current.accessToken;
    if (!this.renewing) {
      this.renewing = this.refresh(signal).finally(() => {
        this.renewing = null;
      });
    }
    return this.renewing;
  }

  private async refresh(signal?: AbortSignal): Promise<string> {
    const { status, answer } = await form(this.fetcher, 'token', { grant_type: 'refresh_token', refresh_token: this.current.refreshToken, client_id: IBROADCAST_CLIENT_ID }, signal);
    if (status === 200 && str(answer['access_token'])) {
      this.current = grantOf(answer, this.current.refreshToken, this.now());
      this.renewed(this.current);
      return this.current.accessToken;
    }
    const error = str(answer['error']);
    if (error === 'invalid_grant' || error === 'invalid_token') throw new SignInExpired();
    throw new HttpStatus(status);
  }
}

// A JSON request to the API or library server. An expired token is answered with HTTP 200 and
// "authenticated": false: it is renewed once and the request sent again; a second refusal is SignInExpired.
async function post(fetcher: Fetch, session: IBroadcastSession, url: string, mode: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  let token = await session.token(signal);
  for (let attempt = 0; ; attempt++) {
    const response = await send(fetcher, url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ client: 'rpm', version: VERSION, device_name: 'rpm', user_agent: globalThis.navigator?.userAgent || 'rpm', mode }),
      signal,
    });
    const refused = response.status === 401;
    if (!refused && !response.ok) throw new HttpStatus(response.status);
    const answer = refused ? {} : obj(await response.json());
    if (refused || answer['authenticated'] === false) {
      if (attempt > 0) throw new SignInExpired();
      token = await session.renew(token, signal);
      continue;
    }
    if (answer['result'] === false) throw new Error(str(answer['message']) || `iBroadcast refused ${mode}.`);
    return answer;
  }
}

// The container name extensionOf reads, for a media type such as "audio/x-m4a".
export function containerOf(mediaType: string): string {
  const sub = (mediaType.split('/')[1] ?? '').trim().toLowerCase();
  switch (sub) {
    case 'flac': case 'x-flac': return 'flac';
    case 'mpeg': case 'mp3': case 'mpeg3': case 'x-mpeg3': return 'mp3';
    case 'mp4': case 'x-m4a': case 'm4a': return 'm4a';
    case 'ogg': case 'vorbis': return 'ogg';
    case 'x-ms-wma': return 'wma';
    case 'wav': case 'x-wav': case 'wave': return 'wav';
    case 'aiff': case 'x-aiff': return 'aiff';
    case 'ape': case 'x-ape': return 'ape';
    case 'x-wavpack': return 'wv';
    default: return sub;
  }
}

// One row of a library table: a list read through the table's map (field name to column), or an object read by
// field name.
class Row {
  constructor(readonly id: number, private readonly row: unknown, private readonly columns: Map<string, number>) {}

  private field(name: string): unknown {
    if (Array.isArray(this.row)) {
      const column = this.columns.get(name);
      return column === undefined ? undefined : this.row[column];
    }
    return obj(this.row)[name];
  }

  text(name: string): string {
    return str(this.field(name));
  }

  number(name: string): number {
    const value = num(this.field(name));
    return Number.isFinite(value) ? Math.trunc(value) : 0;
  }

  flag(name: string): boolean {
    const value = this.field(name);
    return value === true || value === 1;
  }

  ids(name: string): number[] {
    return arr(this.field(name)).filter((v): v is number => typeof v === 'number' && Number.isInteger(v));
  }
}

// One table of the library, its rows in the order of their ids, so the desktop and the web app list a library
// the same way.
function table(value: unknown): { rows: Row[]; find: (id: number) => Row | undefined } {
  const raw = obj(value);
  const columns = new Map<string, number>();
  for (const [name, column] of Object.entries(obj(raw['map']))) if (typeof column === 'number') columns.set(name, column);
  const rows = Object.entries(raw)
    .filter(([key, row]) => /^\d+$/.test(key) && typeof row === 'object' && row !== null)
    .map(([key, row]) => new Row(Number(key), row, columns))
    .sort((a, b) => a.id - b.id);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return { rows, find: (id) => byId.get(id) };
}

// The upload date and time. iBroadcast does not say the zone; they are read as UTC.
function uploaded(day: string, time: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const clock = /^(\d{2}):(\d{2}):(\d{2})$/.exec(time || '00:00:00');
  if (!match || !clock) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(clock[1]), Number(clock[2]), Number(clock[3])));
}

const QUALITY = /^\/(?:96|128|192|256|320|orig)\//;

// Reads an iBroadcast library: tracks with their play counts, thumbs up and upload dates, the person's playlists,
// and the tags (each becomes a playlist in the folder `tagsFolder`). Files come from the streaming server: the
// original for a Premium account, a 128 kbps MP3 for a free one.
export class IBroadcastServer implements MediaServer {
  readonly kind = 'ibroadcast' as const;

  constructor(
    private readonly fetcher: Fetch,
    private readonly session: IBroadcastSession,
    private readonly account: IBroadcastAccount,
    private readonly tagsFolder: string,
    private readonly delay: (ms: number, signal?: AbortSignal) => Promise<void> = (ms, signal) =>
      new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
      }),
  ) {}

  async read(found: (count: number) => void, signal?: AbortSignal): Promise<SourceLibrary> {
    const library = obj((await post(this.fetcher, this.session, LIBRARY, 'library', signal))['library']);
    const tracks = table(library['tracks']);
    const albums = table(library['albums']);
    const artists = table(library['artists']);
    const inTrash = new Set(table(library['trash']).rows.flatMap((row) => row.ids('tracks')));
    const artistName = (id: number) => artists.find(id)?.text('name') ?? '';

    const read: SourceTrack[] = [];
    const skipped: SourceSkip[] = [];
    const names = new Map<number, string>();
    for (const row of tracks.rows) {
      const album = albums.find(row.number('album_id'));
      const title = row.text('title');
      const artist = artistName(row.number('artist_id'));
      const what = artist ? `${artist} - ${title}` : title;
      names.set(row.id, what);

      const file = row.text('file');
      const extension = this.account.premium ? extensionOf('', containerOf(row.text('type'))) : '.mp3';
      if (row.flag('trashed') || album?.flag('trashed') || inTrash.has(row.id)) skipped.push({ what, reasonKey: SkipReason.InTrash });
      else if (!file.startsWith('/')) skipped.push({ what, reasonKey: SkipReason.NotAFile });
      else if (!extension) skipped.push({ what, reasonKey: SkipReason.NotMusic });
      else read.push(this.trackOf(row, album, title, artist, album ? artistName(album.number('artist_id')) : '', file, extension));
    }
    found(read.length);

    const ids = new Set(read.map((t) => t.sourceId));
    const listOf = (sourceId: string, name: string, folder: string[], row: Row): SourcePlaylist => {
      const entries = row.ids('tracks');
      return {
        sourceId, name, folder, smart: false,
        trackIds: entries.map(String).filter((id) => ids.has(id)),
        unresolved: entries.filter((id) => !ids.has(String(id))).map((id) => names.get(id) ?? String(id)),
      };
    };
    // A list iBroadcast fills itself ("Most Recent Uploads", "Thumbs Up") has a type, or is marked as made by the
    // system. Only the lists the person made come along.
    const playlists = [
      ...table(library['playlists']).rows.filter((r) => !r.flag('system_created') && !r.text('type')).map((r) => listOf(String(r.id), r.text('name'), [], r)),
      ...table(library['tags']).rows.filter((r) => !r.flag('archived')).map((r) => listOf(`tag:${r.id}`, r.text('name'), [this.tagsFolder], r)),
    ];
    return { kind: 'ibroadcast', libraryId: this.account.userId, name: this.account.userName, tracks: read, playlists, skipped };
  }

  async open(file: RemoteFile, signal?: AbortSignal): Promise<Blob> {
    const split = file.key.indexOf('|');
    if (split <= 0) throw new Error('Not an iBroadcast file key.');
    const fileId = file.key.slice(0, split);
    const path = file.key.slice(split + 1);
    let token = await this.session.token(signal);
    let renewed = false;
    for (let busy = 1; ; ) {
      // The query carries everything, so the browser sends the request without asking the server first.
      const query = new URLSearchParams({ Signature: token, file_id: fileId, user_id: this.account.userId, platform: 'rpm', version: VERSION });
      const response = await send(this.fetcher, `${STREAMING}${path}?${query.toString()}`, signal ? { signal } : undefined);
      if (response.status === 401 || response.status === 403) {
        if (renewed) throw new SignInExpired();
        token = await this.session.renew(token, signal);
        renewed = true;
        continue;
      }
      if (response.status === 429) {
        const seconds = Number(response.headers.get('Retry-After'));
        if (busy++ >= MOST_BUSY_ANSWERS) throw new HttpStatus(429);
        await this.delay(Math.min(300, Math.max(1, Number.isFinite(seconds) && seconds > 0 ? seconds : 30)) * 1000, signal);
        continue;
      }
      if (!response.ok) throw new HttpStatus(response.status);
      return response.blob();
    }
  }

  private trackOf(row: Row, album: Row | undefined, title: string, artist: string, albumArtist: string, file: string, extension: string): SourceTrack {
    const seconds = row.number('length');
    const year = row.number('year');
    return {
      sourceId: String(row.id),
      // The size is not known: the streamed file can differ from the size the library gives.
      file: { kind: 'remote', key: `${row.id}|${QUALITY.test(file) ? file.replace(QUALITY, this.account.premium ? '/orig/' : '/128/') : file}`, extension, size: 0 },
      title,
      artist,
      album: album?.text('name') ?? '',
      albumArtist,
      trackNumber: row.number('track'),
      discNumber: album?.number('disc') ?? 0,
      year: year > 0 ? year : album?.number('year') ?? 0,
      genre: row.text('genre'),
      durationSeconds: seconds,
      sizeBytes: this.account.premium ? row.number('size') : Math.round(seconds * FREE_BYTES_PER_SECOND),
      rating: 0,
      favorite: row.number('rating') === 5,
      plays: row.number('plays'),
      lastPlayed: null,
      added: uploaded(row.text('uploaded_on'), row.text('uploaded_time')),
    };
  }
}
