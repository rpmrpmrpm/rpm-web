// Calls to the rpm services. The site reaches them on its own address, under /api and /accounts.

// A call that failed. An error is not an empty answer: a caller must never treat this as "no tracks"
// or "no results", and must not store it as one.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  // No answer from the service, or an answer that says to try again.
  get transient(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export interface TokenSource {
  // The access token, refreshed if it is about to expire. Null when nobody is signed in. renew asks
  // for a new token, because the service has refused the current one.
  accessToken(options?: { renew: boolean }): Promise<string | null>;
}

export interface CallOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

const ATTEMPTS = 3;
const FIRST_WAIT_MS = 400;

type Fetcher = typeof fetch;

export class Api {
  constructor(
    private readonly base: string,
    private readonly tokens: TokenSource,
    private readonly fetcher: Fetcher = (...args) => fetch(...args),
    private readonly wait: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
  ) {}

  async call(path: string, options: CallOptions = {}): Promise<Response> {
    const method = options.method ?? 'GET';

    // Only a read is repeated. Repeating a write that reached the service could do it twice.
    const attempts = method === 'GET' ? ATTEMPTS : 1;

    for (let attempt = 1; ; attempt++) {
      try {
        return await this.send(path, method, options);
      } catch (error) {
        const again = error instanceof ApiError && error.transient && attempt < attempts;
        if (!again) throw error;
        await this.wait(FIRST_WAIT_MS * 2 ** (attempt - 1));
      }
    }
  }

  async json<T>(path: string, read: (raw: unknown) => T, options: CallOptions = {}): Promise<T> {
    const response = await this.call(path, options);
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new ApiError(response.status, `The answer from ${path} is not JSON.`);
    }
    return read(raw);
  }

  private async send(path: string, method: string, options: CallOptions): Promise<Response> {
    const first = await this.once(path, method, options, await this.tokens.accessToken());
    if (first.status !== 401) return this.checked(path, first);

    // The token may have ended while the request travelled. One new token, one more try.
    const token = await this.tokens.accessToken({ renew: true });
    if (!token) return this.checked(path, first);
    return this.checked(path, await this.once(path, method, options, token));
  }

  private async once(path: string, method: string, options: CallOptions, token: string | null): Promise<Response> {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    try {
      return await this.fetcher(`${this.base}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new ApiError(0, `No answer from ${path}.`);
    }
  }

  private checked(path: string, response: Response): Response {
    if (response.ok) return response;
    throw new ApiError(response.status, `${path} answered ${response.status}.`);
  }
}
