import { describe, expect, it, vi } from 'vitest';

import { pollHash, Session } from '../../src/api/session';

const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const me = { userId: 'u1', email: 'a@b.c', displayName: 'A', grSupporter: false, grTester: true };

function make(routes: (path: string, init?: RequestInit) => Response | Promise<Response>, now = { value: 1000 }) {
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => routes(String(url).replace('/accounts/', ''), init));
  const storage = new Map<string, string>();
  const go = vi.fn();
  const session = new Session('/accounts/', {
    fetcher: fetcher as unknown as typeof fetch,
    now: () => now.value,
    lock: (run) => run(),
    announce: vi.fn(),
    wait: async () => {},
    storage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => void storage.set(key, value),
      removeItem: (key) => void storage.delete(key),
    },
    go,
  });
  return { session, fetcher, go, storage };
}

const signedIn = (path: string) => {
  if (path === 'auth/refresh') return json(200, { accessToken: 'token', expiresIn: 3600 });
  if (path === 'auth/me') return json(200, me);
  return json(404);
};

describe('opening with a session', () => {
  it('signs in from the cookie', async () => {
    const { session } = make(signedIn);
    await session.restore();
    expect(session.state).toBe('signed-in');
    expect(session.user).toMatchObject({ email: 'a@b.c', tester: true });
  });

  it('shows the sign-in form when there is no cookie', async () => {
    const { session } = make(() => json(400));
    await session.restore();
    expect(session.state).toBe('signed-out');
  });

  it('shows the sign-in form when the service refuses the token', async () => {
    const { session } = make(() => json(401));
    await session.restore();
    expect(session.state).toBe('signed-out');
  });

  it('does not sign anyone out because the service failed', async () => {
    const { session } = make(() => json(503));
    await session.restore();
    expect(session.state).toBe('unreachable');
  });

  it('does not sign anyone out because there is no network', async () => {
    const { session } = make(() => { throw new TypeError('offline'); });
    await session.restore();
    expect(session.state).toBe('unreachable');
  });
});

describe('the access token', () => {
  it('is kept until it is near its end', async () => {
    const { session, fetcher } = make(signedIn);
    await session.restore();
    fetcher.mockClear();
    expect(await session.accessToken()).toBe('token');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('is refreshed three minutes before its end', async () => {
    const now = { value: 1000 };
    const { session, fetcher } = make(signedIn, now);
    await session.restore();
    fetcher.mockClear();
    now.value += 3600 - 179;
    await session.accessToken();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('is refreshed once when several calls ask together', async () => {
    const now = { value: 1000 };
    const { session, fetcher } = make(signedIn, now);
    await session.restore();
    fetcher.mockClear();
    now.value += 4000;
    await Promise.all([session.accessToken(), session.accessToken(), session.accessToken()]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('ends the session when the service refuses the refresh', async () => {
    let refused = false;
    const { session } = make((path) => (refused ? json(401) : signedIn(path)));
    await session.restore();
    refused = true;
    expect(await session.accessToken({ renew: true })).toBeNull();
    expect(session.state).toBe('signed-out');
  });

  it('keeps the session when a refresh meets an outage', async () => {
    let down = false;
    const { session } = make((path) => (down ? json(503) : signedIn(path)));
    await session.restore();
    down = true;
    await expect(session.accessToken({ renew: true })).rejects.toBeTruthy();
    expect(session.state).toBe('signed-in');
  });
});

describe('signing in and up', () => {
  it('asks for the cookie and keeps no refresh token', async () => {
    const { session, fetcher } = make((path) =>
      path === 'auth/login' ? json(200, { accessToken: 't', refreshToken: null, expiresIn: 3600 }) : json(200, me));
    expect(await session.signIn(' a@b.c ', 'pw')).toBeNull();
    const [, init] = fetcher.mock.calls[0]!;
    expect((init?.headers as Record<string, string>)['X-RPM-Session']).toBe('cookie');
    expect(JSON.parse(init?.body as string).email).toBe('a@b.c');
    expect(session.state).toBe('signed-in');
  });

  it('names the reason a sign-in failed', async () => {
    expect(await make(() => json(401)).session.signIn('a', 'b')).toBe('Login_WrongPassword');
    expect(await make(() => json(400)).session.signIn('a', 'b')).toBe('Login_NotConfirmed');
    expect(await make(() => json(503)).session.signIn('a', 'b')).toBe('Login_Unable');
  });

  it('reads a sign-up refusal by its code and not its sentence', async () => {
    const { session } = make(() => json(400, { error: 'Some English', code: 'weak_password' }));
    expect(await session.signUp('A', 'a@b.c', 'x')).toBe('SignUp_WeakPassword');
  });

  it('falls back to a general message for a code it does not know', async () => {
    const { session } = make(() => json(400, { code: 'something_new' }));
    expect(await session.signUp('A', 'a@b.c', 'x')).toBe('SignUp_Failed');
  });
});

describe('social sign-in', () => {
  it('sends the same hash the server computes', async () => {
    // base64url SHA-256 of "app-secret", as PollSecret.HashOf gives it.
    const { createHash } = await import('node:crypto');
    const expected = createHash('sha256').update('app-secret').digest('base64url');
    expect(await pollHash('app-secret')).toBe(expected);
  });

  it('asks to come back to the web app, then goes to the provider', async () => {
    const { session, fetcher, go } = make(() => json(200, { sessionId: 's1', loginUrl: 'https://x/start' }));
    expect(await session.startSocialSignIn('Apple')).toBeNull();
    expect(JSON.parse(fetcher.mock.calls[0]![1]?.body as string).returnTo).toBe('webapp');
    expect(go).toHaveBeenCalledWith('https://x/start');
  });

  it('collects the sign-in with the secret and the code', async () => {
    const { session, fetcher, storage } = make((path) =>
      path.startsWith('auth/poll-session')
        ? json(200, { status: 'complete', accessToken: 't', expiresIn: 3600 })
        : json(200, me));
    storage.set('rpm-social-sign-in', JSON.stringify({ sessionId: 's1', secret: 'sec' }));
    expect(await session.finishSocialSignIn('sessionId=s1&code=one')).toBeNull();
    const headers = fetcher.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(headers['X-Poll-Secret']).toBe('sec');
    expect(headers['X-Sign-In-Code']).toBe('one');
    expect(storage.size).toBe(0);
    expect(session.state).toBe('signed-in');
  });

  it('refuses a return it did not start', async () => {
    const { session, fetcher } = make(() => json(200));
    expect(await session.finishSocialSignIn('sessionId=s1&code=one')).toBe('Login_Unable');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('signing out', () => {
  it('ends the session here even when the service cannot be reached', async () => {
    let down = false;
    const { session } = make((path) => {
      if (down) throw new TypeError('offline');
      return signedIn(path);
    });
    await session.restore();
    down = true;
    await session.signOut();
    expect(session.state).toBe('signed-out');
    expect(await session.accessToken()).toBeNull();
  });
});

describe('the code from a beta mail', () => {
  const newcomer = { ...me, grSupporter: false, grTester: false };

  function withCode(answer: Response) {
    let accepted = false;
    return make((path) => {
      if (path === 'auth/beta-code') {
        accepted = answer.ok;
        return answer;
      }
      if (path === 'auth/me') return json(200, accepted ? { ...me, grSupporter: true } : newcomer);
      return signedIn(path);
    });
  }

  it('reads the account again, and says so, once the code is taken', async () => {
    const { session } = withCode(json(200, { status: 'tester' }));
    await session.restore();
    expect(session.user?.supporter).toBe(false);
    const heard = vi.fn();
    session.onChange(heard);

    expect(await session.redeemCode(' K7QM-2XPD ')).toBeNull();

    expect(session.user?.supporter).toBe(true);
    expect(heard).toHaveBeenCalled();
  });

  it('sends the signed-in token and the code without spaces', async () => {
    const { session, fetcher } = withCode(json(200));
    await session.restore();

    await session.redeemCode(' K7QM-2XPD ');

    const [, init] = fetcher.mock.calls.find(([url]) => String(url).endsWith('auth/beta-code'))!;
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token');
    expect(JSON.parse(String(init?.body))).toEqual({ code: 'K7QM-2XPD' });
  });

  it.each([
    [400, 'Web_CodeRefused'],
    [429, 'SignUp_TooMany'],
    [500, 'Web_CodeFailed'],
  ])('a %i leaves the account as it was and says %s', async (status, key) => {
    const { session } = withCode(json(status));
    await session.restore();

    expect(await session.redeemCode('WRONGONE')).toBe(key);

    expect(session.user?.supporter).toBe(false);
    expect(session.state).toBe('signed-in');
  });

  it('a dropped request is a failure to check, never a refused code', async () => {
    const { session } = make((path) => {
      if (path === 'auth/beta-code') throw new TypeError('network');
      return path === 'auth/me' ? json(200, newcomer) : signedIn(path);
    });
    await session.restore();

    expect(await session.redeemCode('K7QM2XPD')).toBe('Web_CodeFailed');
    expect(session.state).toBe('signed-in');
  });
});
