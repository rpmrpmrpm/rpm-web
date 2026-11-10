// What the web app's media server readers share: the contract, the sign-in errors, and the requests.
// It is RPM.Core/Migration/MediaServer.cs of the desktop app.

import { AUDIO_EXTENSIONS } from '../import/queue';
import type { RemoteFile, SourceKind, SourceLibrary } from './model';

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface MediaServer {
  kind: SourceKind;
  // Reads the whole library. found is told the number of tracks read so far.
  read(found: (count: number) => void, signal?: AbortSignal): Promise<SourceLibrary>;
  // The original file of a track.
  open(file: RemoteFile, signal?: AbortSignal): Promise<Blob>;
}

// The server no longer accepts the sign-in (401, or Subsonic error 40 or 41). The import stops and asks
// the person to sign in again; the tracks it had not reached stay waiting.
export class SignInExpired extends Error {
  constructor() {
    super('The media server no longer accepts the sign-in.');
  }
}

// The server refused a sign-in: a wrong user name or password, or a code not approved.
export class SignInFailed extends Error {
  constructor(readonly serverMessage: string | null = null) {
    super(serverMessage ?? 'The media server refused the sign-in.');
  }
}

// The browser could not reach the server: a plain http address from this https page (mixed content), a
// server that does not allow requests from another site (CORS), or a server that is not there. A page
// cannot tell these apart.
export class ServerBlocked extends Error {
  constructor() {
    super('The browser cannot reach this server.');
  }
}

export const base = (server: string): string => (server.endsWith('/') ? server : server + '/');

// Whether this page may try the server at all. A page on https cannot load from plain http, except from
// the computer itself.
export function reachable(server: string, pageProtocol: string = globalThis.location?.protocol ?? 'https:'): 'ok' | 'blocked' {
  let url: URL;
  try {
    url = new URL(server);
  } catch {
    return 'blocked';
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  return pageProtocol === 'https:' && url.protocol === 'http:' && !local ? 'blocked' : 'ok';
}

async function send(fetcher: Fetch, url: string, init: RequestInit | undefined): Promise<Response> {
  try {
    return await fetcher(url, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ServerBlocked();
  }
}

// The JSON answer. 401 is SignInExpired; any other failure an Error that names the status.
export async function json(fetcher: Fetch, url: string, init?: RequestInit): Promise<unknown> {
  const response = await send(fetcher, url, init);
  if (response.status === 401) throw new SignInExpired();
  if (!response.ok) throw new HttpStatus(response.status);
  return response.json();
}

export async function blob(fetcher: Fetch, url: string, init?: RequestInit): Promise<Blob> {
  const response = await send(fetcher, url, init);
  if (response.status === 401) throw new SignInExpired();
  if (!response.ok) throw new HttpStatus(response.status);
  return response.blob();
}

export class HttpStatus extends Error {
  constructor(readonly status: number) {
    super(`The media server answered ${status}.`);
  }
}

// The file type of a server's track, as the extension rpm reads ('.m4a'), or '' when it is not audio rpm reads.
// The extension of the file's own name comes first, because it is what the file is. Without a name, the
// server's container name is mapped: Plex says "mp4" for .m4a files, and Jellyfin may give ffprobe's list
// ("mov,mp4,m4a,3gp,3g2,mj2"). It is RPM.Core/Migration/MediaServer.cs ExtensionOf of the desktop app.
export function extensionOf(path: string, container: string): string {
  const named = /\.[^./\\]+$/.exec(path)?.[0]?.toLowerCase() ?? '';
  if (named.length > 1 && AUDIO_EXTENSIONS.has(named)) return named;
  for (const name of container.split(',').map((n) => n.trim().toLowerCase()).filter((n) => n.length > 0)) {
    const mapped =
      name === 'mp4' || name === 'm4a' || name === 'm4b' || name === 'mov' || name === 'alac' ? '.m4a'
      : name === 'mpeg' || name === 'mp3' ? '.mp3'
      : name === 'aif' || name === 'aiff' ? '.aiff'
      : name === 'asf' || name === 'wma' ? '.wma'
      : name === 'ogg' || name === 'oga' || name === 'vorbis' ? '.ogg'
      : '.' + name;
    if (AUDIO_EXTENSIONS.has(mapped)) return mapped;
  }
  return '';
}

// Notices a server that ignores the page it is asked for and sends its first page again, as some do with an
// offset they do not support. Without this, a reader that waits for a short page would ask for ever, and one
// that counts to the total would list every track again. It is MediaServerHttp.FirstPage of the desktop app.
export class FirstPage {
  private first: string | null = null;

  // True when items is the first page again, from the second page on.
  again(items: unknown): boolean {
    const text = JSON.stringify(items ?? null);
    if (this.first === null) {
      this.first = text;
      return false;
    }
    return text === this.first;
  }
}

// Reading the loose JSON the servers answer with.
type Loose = Record<string, unknown>;
export const obj = (value: unknown): Loose => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Loose) : {});
export const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const str = (value: unknown): string => (typeof value === 'string' ? value : '');
export const num = (value: unknown): number => (typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) || 0 : 0);
