import { describe, expect, it, vi } from 'vitest';

import { CloudClient } from '../../src/api/cloud';
import { Api, ApiError, type TokenSource } from '../../src/api/http';

const tokens = (token: string | null = 'first'): TokenSource => ({
  accessToken: vi.fn(async (options) => (options?.renew ? 'second' : token)),
});

const answer = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const noWait = async () => {};

describe('calls to the services', () => {
  it('sends the token', async () => {
    const fetcher = vi.fn(async () => answer(200));
    await new Api('/api/', tokens(), fetcher as typeof fetch, noWait).call('cloud/quota');
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/cloud/quota');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer first');
  });

  it('gets a new token once on a 401, and tries once more', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(answer(401)).mockResolvedValueOnce(answer(200));
    const source = tokens();
    await new Api('/api/', source, fetcher, noWait).call('cloud/quota');
    expect(source.accessToken).toHaveBeenCalledWith({ renew: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('repeats a read that met a passing failure', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(answer(503)).mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(answer(200));
    await new Api('/api/', tokens(), fetcher, noWait).call('cloud/list');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('does not repeat a write, which might have reached the service', async () => {
    const fetcher = vi.fn(async () => answer(503));
    const api = new Api('/api/', tokens(), fetcher as typeof fetch, noWait);
    await expect(api.call('cloud/upload/complete', { method: 'POST', body: {} })).rejects.toBeInstanceOf(ApiError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('stops after three tries and says it failed', async () => {
    const fetcher = vi.fn(async () => answer(500));
    await expect(new Api('/api/', tokens(), fetcher as typeof fetch, noWait).call('x')).rejects.toMatchObject({ status: 500 });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('does not repeat a refusal', async () => {
    const fetcher = vi.fn(async () => answer(404));
    await expect(new Api('/api/', tokens(), fetcher as typeof fetch, noWait).call('x')).rejects.toMatchObject({ status: 404 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('reading the library', () => {
  it('follows the cursor through every page', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(answer(200, { files: [{ rpmId: 'a' }], cursor: 'next page' }))
      .mockResolvedValueOnce(answer(200, { files: [{ rpmId: 'b' }], cursor: null }));
    const cloud = new CloudClient(new Api('/api/', tokens(), fetcher, noWait));
    const tracks = await cloud.list();
    expect(tracks.map((t) => t.rpmId)).toEqual(['a', 'b']);
    expect(fetcher.mock.calls[1]?.[0]).toContain('cursor=next%20page');
  });

  it('fails as a whole when a later page fails, so a part is not taken for the library', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(answer(200, { files: [{ rpmId: 'a' }], cursor: 'next' }))
      .mockResolvedValue(answer(404));
    const cloud = new CloudClient(new Api('/api/', tokens(), fetcher, noWait));
    await expect(cloud.list()).rejects.toBeInstanceOf(ApiError);
  });
});
