// The signed-in account. The refresh token is in a cookie that scripts cannot read, and the access
// token is held in memory only, so a script injected into the page has nothing to take away.

import { ApiError, type TokenSource } from './http';

export interface User {
  userId: string;
  email: string;
  displayName: string;
  supporter: boolean;
  tester: boolean;
}

// unreachable means the service gave no answer. It is not the same as signed out: the session may be
// fine, and showing the sign-in form would be wrong.
export type SessionState = 'restoring' | 'signed-in' | 'signed-out' | 'unreachable';

// The strings.json key to show, or null when the step worked.
export type Outcome = string | null;

const SESSION_HEADER = { 'X-RPM-Session': 'cookie' };
const REFRESH_MARGIN_SECONDS = 180;
const SOCIAL_KEY = 'rpm-social-sign-in';
const REFRESH_LOCK = 'rpm-session-refresh';
const POLL_ATTEMPTS = 4;
const POLL_WAIT_MS = 500;

interface Environment {
  fetcher: typeof fetch;
  now: () => number;
  // One refresh at a time across tabs.
  lock: <T>(run: () => Promise<T>) => Promise<T>;
  // Tells the other tabs about a sign-out.
  announce: () => void;
  wait: (ms: number) => Promise<void>;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  go: (url: string) => void;
}

function browserEnvironment(onSignedOutElsewhere: () => void): Environment {
  const channel = new BroadcastChannel('rpm-session');
  channel.onmessage = onSignedOutElsewhere;
  return {
    fetcher: (...args) => fetch(...args),
    now: () => Date.now() / 1000,
    lock: (run) => navigator.locks.request(REFRESH_LOCK, run) as ReturnType<typeof run>,
    announce: () => channel.postMessage('signed-out'),
    wait: (ms) => new Promise((done) => setTimeout(done, ms)),
    storage: sessionStorage,
    go: (url) => location.assign(url),
  };
}

const SIGN_UP_REFUSALS: Record<string, string> = {
  already_registered: 'SignUp_AlreadyRegistered',
  social_account: 'SignUp_SocialAccount',
  weak_password: 'SignUp_WeakPassword',
  invalid_email: 'SignUp_InvalidEmail',
  invalid_name: 'SignUp_InvalidName',
  invalid_code: 'SignUp_InvalidCode',
  code_expired: 'SignUp_CodeResent',
  code_resent: 'SignUp_CodeResent',
  too_many: 'SignUp_TooMany',
};

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// The hash the server keeps of a poll secret: base64url SHA-256 of its UTF-8 bytes, without padding.
export async function pollHash(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return base64Url(new Uint8Array(digest));
}

export class Session implements TokenSource {
  state: SessionState = 'restoring';
  user: User | null = null;

  private token: string | null = null;
  private expiresAt = 0;
  private refreshing: Promise<string | null> | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly environment: Environment;

  constructor(
    private readonly base: string,
    environment?: Environment,
  ) {
    this.environment = environment ?? browserEnvironment(() => this.forget());
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(state: SessionState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  private forget() {
    this.token = null;
    this.expiresAt = 0;
    this.user = null;
    this.set('signed-out');
  }

  private post(path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
    return this.environment.fetcher(`${this.base}${path}`, {
      method: 'POST',
      headers: { ...SESSION_HEADER, 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  // Opens with the cookie, if there is one. Runs once when the app starts.
  async restore(): Promise<void> {
    try {
      const token = await this.refresh();
      if (!token) return this.forget();
      await this.loadUser();
      this.set('signed-in');
    } catch {
      this.set('unreachable');
    }
  }

  private adopt(answer: { accessToken?: string; expiresIn?: number }) {
    if (!answer.accessToken) throw new ApiError(200, 'The sign-in answer has no token.');
    this.token = answer.accessToken;
    this.expiresAt = this.environment.now() + (answer.expiresIn ?? 3600);
  }

  // Null when the service says there is no session. A failure throws, because a sign-out must come
  // from the service refusing and never from a dropped request.
  private refresh(): Promise<string | null> {
    this.refreshing ??= this.environment
      .lock(async () => {
        const response = await this.post('auth/refresh');
        if (response.status === 400 || response.status === 401) return null;
        if (!response.ok) throw new ApiError(response.status, 'The session could not be refreshed.');
        this.adopt(await response.json());
        return this.token;
      })
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  async accessToken(options?: { renew: boolean }): Promise<string | null> {
    const fresh = this.token && this.expiresAt - this.environment.now() > REFRESH_MARGIN_SECONDS;
    if (fresh && !options?.renew) return this.token;
    if (this.state === 'signed-out') return null;

    const token = await this.refresh();
    if (!token) this.forget();
    return token;
  }

  private async loadUser() {
    const response = await this.environment.fetcher(`${this.base}auth/me`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!response.ok) throw new ApiError(response.status, 'The account could not be read.');
    const me = await response.json();
    this.user = {
      userId: me.userId,
      email: me.email ?? '',
      displayName: me.displayName ?? '',
      supporter: me.grSupporter === true,
      tester: me.grTester === true,
    };
  }

  async signIn(email: string, password: string): Promise<Outcome> {
    try {
      const response = await this.post('auth/login', { email: email.trim(), password });
      if (response.status === 401) return 'Login_WrongPassword';
      if (response.status === 400) return 'Login_NotConfirmed';
      if (!response.ok) return 'Login_Unable';
      this.adopt(await response.json());
      await this.loadUser();
      this.set('signed-in');
      return null;
    } catch {
      return 'Login_Unable';
    }
  }

  private async signUpStep(path: string, body: unknown): Promise<Outcome> {
    try {
      const response = await this.post(path, body);
      if (response.ok) return null;
      if (response.status >= 500) return 'SignUp_Failed';
      const said = await response.json().catch(() => ({}));
      return SIGN_UP_REFUSALS[said.code] ?? 'SignUp_Failed';
    } catch {
      return 'SignUp_Failed';
    }
  }

  signUp(name: string, email: string, password: string): Promise<Outcome> {
    return this.signUpStep('auth/register', { name: name.trim(), email: email.trim(), password });
  }

  confirmSignUp(email: string, code: string): Promise<Outcome> {
    return this.signUpStep('auth/confirm', { email: email.trim(), code: code.trim() });
  }

  resendCode(email: string): Promise<Outcome> {
    return this.signUpStep('auth/resend-code', { email: email.trim() });
  }

  // Takes the code from a beta mail. The account is read again, because that is what says it is in.
  async redeemCode(code: string): Promise<Outcome> {
    try {
      const token = await this.accessToken();
      const response = await this.post('auth/beta-code', { code: code.trim() }, { Authorization: `Bearer ${token}` });
      if (response.status === 400) return 'Web_CodeRefused';
      if (response.status === 429) return 'SignUp_TooMany';
      if (!response.ok) return 'Web_CodeFailed';
      await this.loadUser();
      this.set('signed-in');
      return null;
    } catch {
      return 'Web_CodeFailed';
    }
  }

  // Leaves for the provider's page. The browser comes back to finishSocialSignIn.
  async startSocialSignIn(provider: 'Apple' | 'Google'): Promise<Outcome> {
    const secret = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    try {
      const response = await this.post('auth/social-login', {
        provider,
        appId: 'RPM',
        pollHash: await pollHash(secret),
        returnTo: 'webapp',
      });
      if (!response.ok) return 'Login_Unable';
      const { sessionId, loginUrl } = await response.json();
      this.environment.storage.setItem(SOCIAL_KEY, JSON.stringify({ sessionId, secret }));
      this.environment.go(loginUrl);
      return null;
    } catch {
      return 'Login_Unable';
    }
  }

  // fragment is the part of the address after the #, with the one-time code in it.
  async finishSocialSignIn(fragment: string): Promise<Outcome> {
    const stored = this.environment.storage.getItem(SOCIAL_KEY);
    this.environment.storage.removeItem(SOCIAL_KEY);
    const code = new URLSearchParams(fragment).get('code');
    if (!stored || !code) return 'Login_Unable';

    const { sessionId, secret } = JSON.parse(stored);
    const headers = { ...SESSION_HEADER, 'X-Poll-Secret': secret, 'X-Sign-In-Code': code };

    try {
      for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
        const response = await this.environment.fetcher(
          `${this.base}auth/poll-session?sessionId=${encodeURIComponent(sessionId)}`, { headers });
        if (!response.ok) return 'Login_Unable';
        const answer = await response.json();
        if (answer.status === 'complete') {
          this.adopt(answer);
          await this.loadUser();
          this.set('signed-in');
          return null;
        }
        await this.environment.wait(POLL_WAIT_MS);
      }
    } catch {
      return 'Login_Unable';
    }
    return 'Login_BrowserTimedOut';
  }

  // The session ends here at once. The service is told as well, and a failure there does not keep
  // anyone signed in.
  async signOut(): Promise<void> {
    this.forget();
    this.environment.announce();
    try {
      await this.post('auth/revoke');
    } catch {
      // Nothing more can be done from here. The access token ends by itself within the hour.
    }
  }
}
