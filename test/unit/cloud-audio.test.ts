import { describe, expect, it, vi } from 'vitest';

import type { CloudTrack } from '../../src/api/wire';
import { CloudAudio } from '../../src/import/cloud-audio';

const track: CloudTrack = { rpmId: 'r1', sha256: 's', relativePath: 'A/B/01 Song.flac', originalSize: 1, title: 'Song', artist: 'A', album: 'B', addedAt: 1, updatedAt: 1, tags: null };

describe('the audio of a cloud track, for Recognise', () => {
  function stage(ok = true) {
    const cloud = { stream: vi.fn(async () => ({ url: 'https://store.test/r1', kilobits: 0, live: false })) };
    const media = { fingerprint: vi.fn(async (file: File) => ({ text: file.name, raw: [], seconds: file.size })), clip: vi.fn(async (_file: File, _kilobits: number, _start: number, _seconds: number) => new Uint8Array([1])) };
    const fetcher = vi.fn(async () => (ok ? new Response(new Uint8Array([1, 2, 3])) : new Response('', { status: 403 })));
    return { cloud, media, fetcher, audio: new CloudAudio(cloud, media as never, fetcher as never) };
  }

  it('stands in a file named as the track, and fetches the original once for the fingerprint and the clip', async () => {
    const { cloud, media, fetcher, audio } = stage();
    const standIn = audio.standIn(track);
    expect(standIn.name).toBe('01 Song.flac');

    await audio.fingerprint(standIn);
    await audio.clip(standIn, 128, 10, 15);

    expect(cloud.stream).toHaveBeenCalledTimes(1);
    expect(cloud.stream).toHaveBeenCalledWith('r1', 0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const read = media.fingerprint.mock.calls[0]![0];
    expect(read.size).toBe(3);
    expect(media.clip.mock.calls[0]![0]).toBe(read);
  });

  it('fails the track when the audio cannot be fetched, and asks again next time', async () => {
    const { fetcher, audio } = stage(false);
    const standIn = audio.standIn(track);
    await expect(audio.fingerprint(standIn)).rejects.toThrow();
    await expect(audio.fingerprint(standIn)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
