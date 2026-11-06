import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Api } from '../../src/api/http';
import { captureCrashes, sendFeedback, sendHeldCrashes, setCrashConsent } from '../../src/report/report';

const memory = new Map<string, string>();
const listeners = new Map<string, (event: unknown) => void>();

vi.stubGlobal('localStorage', {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, value),
});
vi.stubGlobal('addEventListener', (name: string, listener: (event: unknown) => void) => listeners.set(name, listener));
vi.stubGlobal('navigator', { userAgent: 'test' });

const crash = (error: Error) => listeners.get('error')!({ error });

function api(call = vi.fn(async () => new Response())) {
  return { api: { call } as unknown as Api, call };
}

beforeEach(() => {
  memory.clear();
  captureCrashes();
});

describe('feedback', () => {
  it('sends what the server reads, and says it arrived', async () => {
    const { api: client, call } = api();
    expect(await sendFeedback(client, { kind: 'idea', area: 'library', message: 'hello' })).toBe(true);
    const [path, options] = call.mock.calls[0] as unknown as [string, { body: Record<string, unknown> }];
    expect(path).toBe('errors/feedback');
    expect(options.body).toMatchObject({ kind: 'idea', message: 'hello', head: 'web', scope: 'full' });
    expect(options.body.atUtcTicks).toBeGreaterThan(6.3e17);
  });

  it('says so when it could not be sent, so the text stays on screen', async () => {
    const { api: client } = api(vi.fn(async () => { throw new Error('offline'); }));
    expect(await sendFeedback(client, { kind: 'problem', area: 'other', message: 'x' })).toBe(false);
  });
});

describe('crashes', () => {
  it('sends nothing without consent', async () => {
    crash(new Error('boom'));
    const { api: client, call } = api();
    await sendHeldCrashes(client);
    expect(call).not.toHaveBeenCalled();
  });

  it('sends with consent, in the id shape the server accepts, once', async () => {
    setCrashConsent(true);
    crash(new Error('boom'));
    const { api: client, call } = api();
    await sendHeldCrashes(client);
    await sendHeldCrashes(client);
    expect(call).toHaveBeenCalledTimes(1);
    const body = (call.mock.calls[0] as unknown as [string, { body: { crashId: string; exception: string } }])[1].body;
    expect(body.crashId).toMatch(/^crash_[0-9a-f]{24}$/);
    expect(body.exception).toContain('boom');
  });

  it('keeps a crash that could not be sent', async () => {
    setCrashConsent(true);
    crash(new Error('boom'));
    await sendHeldCrashes(api(vi.fn(async () => { throw new Error('offline'); })).api);
    const { api: client, call } = api();
    await sendHeldCrashes(client);
    expect(call).toHaveBeenCalledTimes(1);
  });
});
