import { describe, expect, it, vi } from 'vitest';

import { HeadClips } from '../../src/audio/heads';

const clip = (rpmId: string, audio: string | null) => ({ rpmId, audio });
const settled = () => new Promise((done) => setTimeout(done));

describe('head clips', () => {
  it('holds what came back, as bytes', async () => {
    const headClips = vi.fn(async () => [clip('a', btoa('abc'))]);
    const heads = new HeadClips({ headClips });
    heads.warm(['a']);
    await settled();
    expect([...heads.held('a')!]).toEqual([97, 98, 99]);
  });

  it('has nothing for a track with no clip yet, and asks about it once', async () => {
    const headClips = vi.fn(async () => [clip('a', null)]);
    const heads = new HeadClips({ headClips });
    heads.warm(['a']);
    await settled();
    heads.warm(['a']);
    await settled();
    expect(heads.held('a')).toBeNull();
    expect(headClips).toHaveBeenCalledTimes(1);
  });

  it('never asks for more than the server takes', async () => {
    const headClips = vi.fn(async () => []);
    new HeadClips({ headClips }).warm(Array.from({ length: 120 }, (_, index) => String(index)));
    await settled();
    expect(headClips.mock.calls[0]).toHaveLength(1);
    expect((headClips.mock.calls[0] as unknown as string[][])[0]).toHaveLength(50);
  });

  it('asks again after a failure, which is not the same as no clip', async () => {
    let tries = 0;
    const headClips = vi.fn(async () => {
      if (++tries === 1) throw new Error('offline');
      return [clip('a', btoa('x'))];
    });
    const heads = new HeadClips({ headClips });
    heads.warm(['a']);
    await settled();
    heads.warm(['a']);
    await settled();
    expect(heads.held('a')).not.toBeNull();
  });

  it('lets the oldest go', async () => {
    const ids = Array.from({ length: 210 }, (_, index) => String(index));
    const headClips = vi.fn(async (asked: readonly string[]) => asked.map((id) => clip(id, btoa('x'))));
    const heads = new HeadClips({ headClips });
    for (let at = 0; at < ids.length; at += 50) {
      heads.warm(ids.slice(at, at + 50));
      await settled();
    }
    expect(heads.held('0')).toBeNull();
    expect(heads.held('209')).not.toBeNull();
  });
});
