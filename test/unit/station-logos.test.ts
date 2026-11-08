import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../src/api/http';
import { StationLogos } from '../../src/radio/station-logos';

const UUID = '2bf82625-6e78-445d-afff-e51e53c369a9';

function setUp(answer: (path: string) => Promise<Response>) {
  let stamp = '7';
  let made = 0;
  const call = vi.fn(answer);
  const logos = new StationLogos({ call }, () => stamp, () => `blob:${++made}`);
  return { logos, call, setStamp: (value: string) => (stamp = value) };
}

const picture = async () => new Response(new Blob(['webp']));
const refused = (status: number) => async (): Promise<Response> => {
  throw new ApiError(status, 'refused');
};

describe('rpm\'s own station logos', () => {
  it('reads the logo through the API, under the stamp, and keeps the address', async () => {
    const { logos, call } = setUp(picture);
    expect(logos.known(UUID)).toBeUndefined();
    expect(await logos.url(UUID.toUpperCase())).toBe('blob:1');
    expect(call).toHaveBeenCalledWith(`radio/logo/${UUID}?v=7`);
    expect(logos.known(UUID)).toBe('blob:1');
    expect(await logos.url(UUID)).toBe('blob:1');
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('asks once for a station that several wells show at the same time', async () => {
    const { logos, call } = setUp(picture);
    const [first, second] = await Promise.all([logos.url(UUID), logos.url(UUID)]);
    expect(first).toBe('blob:1');
    expect(second).toBe('blob:1');
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('keeps a 404 as no logo, and does not ask again', async () => {
    const { logos, call } = setUp(refused(404));
    expect(await logos.url(UUID)).toBeNull();
    expect(logos.known(UUID)).toBeNull();
    expect(await logos.url(UUID)).toBeNull();
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('does not keep a failure as no logo, and asks again next time', async () => {
    const { logos, call } = setUp(refused(401));
    await expect(logos.url(UUID)).rejects.toThrow(ApiError);
    expect(logos.known(UUID)).toBeUndefined();
    call.mockImplementation(picture);
    expect(await logos.url(UUID)).toBe('blob:1');
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('asks again when the logos change', async () => {
    const { logos, call, setStamp } = setUp(picture);
    await logos.url(UUID);
    setStamp('8');
    expect(logos.known(UUID)).toBeUndefined();
    expect(await logos.url(UUID)).toBe('blob:2');
    expect(call).toHaveBeenLastCalledWith(`radio/logo/${UUID}?v=8`);
  });

  it('gives an answer read under an older stamp to the one who asked, but does not keep it', async () => {
    let arrive: (response: Response) => void = () => {};
    const { logos, setStamp } = setUp(() => new Promise((done) => (arrive = done)));
    const asking = logos.url(UUID);
    setStamp('8');
    expect(logos.known(UUID)).toBeUndefined();
    arrive(new Response(new Blob(['webp'])));
    expect(await asking).toBe('blob:1');
    expect(logos.known(UUID)).toBeUndefined();
  });

  it('asks without a stamp before the rules have been read', async () => {
    const { logos, call, setStamp } = setUp(picture);
    setStamp('');
    await logos.url(UUID);
    expect(call).toHaveBeenCalledWith(`radio/logo/${UUID}`);
  });
});
