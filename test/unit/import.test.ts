import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Api } from '../../src/api/http';
import { bestPreset, parseFilename } from '../../src/import/filename-tags';
import { answerChallenge, buildSidecar, catalogueTags, classify, Importer, normalizeMime, type Transfers } from '../../src/import/importer';
import type { ImportMedia } from '../../src/import/media';
import { relativePath, sanitizeSegment } from '../../src/import/naming';
import { allImported, ImportQueue } from '../../src/import/queue';

const file = (name: string, size = 10) => new File([new Uint8Array(size)], name);

function queueOf(...paths: string[]) {
  const queue = new ImportQueue();
  const rows = queue.add(paths.map((path) => ({ file: file(path.split('/').pop()!), path })));
  for (const row of rows) if (row.state === 'reading') row.state = 'ready';
  return { queue, rows };
}

describe('filing a track', () => {
  const facts = { Artist: 'Radiohead', Album: 'OK Computer', Title: 'Paranoid Android', TrackNumber: 2 };

  it('uses the default pattern', () => {
    expect(relativePath(facts, 'x.flac', '.flac')).toBe('Radiohead/OK Computer/02 - Paranoid Android.flac');
  });

  it('prefers the album artist for the folder', () => {
    expect(relativePath({ ...facts, Artist: 'Snap!', AlbumArtist: 'Various' }, 'x.mp3', '.mp3')).toBe('Various/OK Computer/02 - Paranoid Android.mp3');
  });

  it('files a track with no album one level up, not in an Unknown folder', () => {
    expect(relativePath({ ...facts, Album: '' }, 'x.mp3', '.mp3')).toBe('Radiohead/02 - Paranoid Android.mp3');
  });

  it('drops the number and its separator when there is none', () => {
    expect(relativePath({ ...facts, TrackNumber: 0 }, 'x.mp3', '.mp3')).toBe('Radiohead/OK Computer/Paranoid Android.mp3');
  });

  it('falls back to the file name and to an unknown artist', () => {
    expect(relativePath({}, 'My Song.flac', '.flac')).toBe('Unknown Artist/My Song.flac');
  });

  it('cleans a segment', () => {
    expect(sanitizeSegment('AC/DC: Back?  In*Black.')).toBe('AC DC Back InBlack');
    expect(sanitizeSegment('CON')).toBe('CON_');
    expect(sanitizeSegment('   ')).toBe('Unknown');
    expect(sanitizeSegment('x'.repeat(200))).toHaveLength(120);
  });
});

describe('tags from a file name', () => {
  it('reads a numbered track and leaves the extension out', () => {
    expect(parseFilename('Album/03 - On My Way Home.flac', '{track} - {title}')).toEqual({ track: '03', title: 'On My Way Home' });
  });

  it('breaks at the first dash', () => {
    expect(parseFilename('Simon - Garfunkel - The Boxer.mp3', '{artist} - {title}')).toEqual({ artist: 'Simon', title: 'Garfunkel - The Boxer' });
  });

  it('reads the folders a pattern asks for', () => {
    expect(parseFilename('M/Abba/Gold (1992)/01 - SOS.flac', '{artist}/{album} ({year})/{track} - {title}')).toEqual({
      artist: 'Abba', album: 'Gold', year: '1992', track: '01', title: 'SOS',
    });
  });

  it('answers nothing when the name does not fit', () => {
    expect(parseFilename('no dash here.mp3', '{track} - {title}')).toBeNull();
  });

  it('finds the preset most files match', () => {
    expect(bestPreset(['01. One.mp3', '02. Two.mp3'])).toBe(1);
  });
});

describe('the queue', () => {
  it('ticks what it can import and refuses what the store cannot hold', () => {
    const { rows } = queueOf('A/1.flac', 'A/2.ape');
    expect(rows[0]).toMatchObject({ ticked: true, state: 'ready' });
    expect(rows[1]).toMatchObject({ ticked: false, state: 'refused', note: 'Web_ImportCannotStore' });
  });

  it('skips what is not audio, keeps a folder cover, and does not add a file twice', () => {
    const queue = new ImportQueue();
    const song = { file: file('1.flac'), path: 'A/1.flac' };
    queue.add([song, { file: file('notes.txt'), path: 'A/notes.txt' }, { file: file('cover.jpg'), path: 'A/cover.jpg' }, { file: file('._1.flac'), path: 'A/._1.flac' }]);
    queue.add([song]);
    expect(queue.rows).toHaveLength(1);
    expect(queue.covers.get('A')?.name).toBe('cover.jpg');
  });

  it('acts on the ticks, or on the row under the pointer when nothing is ticked', () => {
    const { queue, rows } = queueOf('A/1.flac', 'A/2.flac');
    queue.setAllTicks(false);
    expect(queue.acting(rows[1])).toEqual([rows[1]]);
    queue.setTick(rows[0]!, true);
    expect(queue.acting(rows[1])).toEqual([rows[0]]);
  });

  it('does not change a track number when a row is dragged', () => {
    const { queue, rows } = queueOf('A/1.flac', 'A/2.flac', 'A/3.flac');
    rows[0]!.tags.TrackNumber = 1;
    queue.move([rows[2]!], rows[0]!);
    expect(queue.rows.map((r) => r.path)).toEqual(['A/3.flac', 'A/1.flac', 'A/2.flac']);
    expect(rows[0]!.tags.TrackNumber).toBe(1);
  });

  it('numbers in the order the rows stand, per disc, when asked', () => {
    const { queue, rows } = queueOf('A/a.flac', 'A/b.flac', 'A/c.flac');
    rows[2]!.tags.DiscNumber = 2;
    queue.move([rows[1]!], rows[0]!);
    queue.numberTracks(rows);
    expect(rows.map((r) => r.tags.TrackNumber)).toEqual([2, 1, 1]);
    expect(rows[0]!.tags.TrackCount).toBe(2);
  });

  it('gives a row dragged onto another record that record, and keeps its own title', () => {
    const { queue, rows } = queueOf('A/1.flac', 'B/2.flac');
    Object.assign(rows[0]!.tags, { Album: 'One', AlbumArtist: 'A', Year: 2000, Title: 'mine' });
    Object.assign(rows[1]!.tags, { Album: 'Two', AlbumArtist: 'B', Year: 1990, Title: 'theirs' });
    const target = queue.groups().find((group) => group.album === 'Two')!;
    queue.move([rows[0]!], null, target);
    expect(rows[0]!.tags).toMatchObject({ Album: 'Two', AlbumArtist: 'B', Year: 1990, Title: 'mine' });
  });

  it('groups by record before and after the tags are read', () => {
    const { queue, rows } = queueOf('A/X/1.flac', 'A/X/2.flac', 'B/Y/1.flac');
    expect(queue.groups().map((g) => g.album)).toEqual(['X', 'Y']);
    rows[2]!.tags.Album = 'X';
    expect(queue.groups()).toHaveLength(1);
  });

  it('counts the whole queue', () => {
    const { queue, rows } = queueOf('A/1.flac', 'A/2.flac');
    queue.setTick(rows[0]!, false);
    expect(queue.counts()).toMatchObject({ total: 2, ticked: 1, missing: 2 });
  });
});

describe('what goes to the store', () => {
  const row = () => queueOf('A/1.flac').rows[0]!;

  it('names the sidecar as the desktop reads it and leaves empty fields out', () => {
    const track = row();
    Object.assign(track.tags, { Title: 'T', Genre: '', Year: 0, TrackNumber: 3 });
    const sidecar = buildSidecar(track, 'id-1', 'A/T.flac', { bytes: new Uint8Array([1, 2]), mime: 'image/png' });
    expect(sidecar).toMatchObject({ Version: 5, RelativePath: 'A/T.flac', Extension: '.flac', Title: 'T', TrackNumber: 3, RpmId: 'id-1', Art: 'AQI=', ArtMime: 'image/png' });
    expect(sidecar).not.toHaveProperty('Genre');
    expect(sidecar).not.toHaveProperty('Year');
  });

  it('sends the catalogue fields under the wire names', () => {
    const track = row();
    Object.assign(track.tags, { DurationSeconds: 12.5, TrackNumber: 1, Composers: 'C' });
    expect(catalogueTags(track)).toMatchObject({ durationSeconds: 12.5, trackNumber: 1, extension: '.flac', composer: 'C' });
  });

  it('answers a challenge over the nonce and the exact bytes', async () => {
    const bytes = Uint8Array.from([0, 1, 2, 3, 4, 5]);
    const nonce = Uint8Array.from([9, 9]);
    const [answer] = await answerChallenge(bytes, nonce, [{ offset: 2, length: 3 }]);
    expect(answer).toBe(createHash('sha256').update(Buffer.from([9, 9, 2, 3, 4])).digest('hex'));
  });

  it('refuses a range outside the file', async () => {
    await expect(answerChallenge(new Uint8Array(4), new Uint8Array(1), [{ offset: 3, length: 4 }])).rejects.toThrow();
  });

  it('keeps cover types to those the server signs for', () => {
    expect(normalizeMime('image/png')).toBe('image/png');
    expect(normalizeMime('image/gif')).toBe('image/jpeg');
  });

  it('gives up on what the same bytes would meet again, and not on the rest', () => {
    expect(classify('Invalid data found when processing input')).toEqual({ key: 'Cloud_FailUnreadable', permanent: true });
    expect(classify('Rematrix is needed')).toMatchObject({ key: 'Cloud_FailChannels', permanent: true });
    expect(classify('The upload was interrupted.')).toEqual({ key: 'Cloud_FailUnknown', permanent: false });
  });
});

describe('the upload sequence', () => {
  let calls: string[];
  let held: Map<string, string>;
  let answers: Record<string, () => Response>;

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  const media: ImportMedia = {
    tags: async () => ({ tags: {}, hasArt: false }),
    art: async () => null,
    canonical: async () => ({ bytes: new Uint8Array([1, 2, 3]), sha256: 'a'.repeat(64) }),
    renditions: async () => ({ head: new Uint8Array(1), rendition: new Uint8Array(2) }),
    loudness: async () => ({ lufs: -14.5, truePeak: 0.9 }),
    fingerprint: async () => ({ text: 'print', raw: [1], seconds: 1 }),
    clip: async () => new Uint8Array(1),
  };

  function importer(queue: ImportQueue, overrides: Partial<ImportMedia> = {}) {
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url).replace('/api/', '').split('?')[0]!;
      calls.push(`${init?.method ?? 'GET'} ${path}`);
      const key = Object.keys(answers).find((name) => path.startsWith(name));
      return key ? answers[key]!() : json({});
    });
    const api = new Api('/api/', { accessToken: async () => 't' }, fetcher as unknown as typeof fetch, async () => {});
    const transfers: Transfers = {
      put: vi.fn(async (url) => {
        calls.push(`PUT ${url}`);
      }),
    };
    return new Importer(api, { ...media, ...overrides }, transfers, { idOf: (sha) => held.get(sha) }, queue, () => 'new-id');
  }

  beforeEach(() => {
    calls = [];
    held = new Map();
    answers = {
      'cloud/quota': () => json({ usedBytes: 0, quotaBytes: 1000, fileCount: 0 }),
      'cloud/upload/init': () => json({ status: 'upload', sidecarUrl: 'sidecar', blobUrl: 'blob', checksumSha256: 'sum' }),
      'cloud/upload/complete': () => json({ usedBytes: 3, quotaBytes: 1000, fileCount: 1 }),
      'cloud/rendition/new-id/upload': () => json({ url: 'rendition' }),
    };
  });

  it('runs in the desktop order and marks the row done at complete', async () => {
    const { queue, rows } = queueOf('A/1.flac');
    await importer(queue).run(rows, 1, () => {});
    expect(rows[0]!.state).toBe('done');
    const order = ['POST cloud/upload/init', 'PUT sidecar', 'PUT blob', 'POST cloud/upload/complete'];
    expect(calls.filter((call) => order.includes(call))).toEqual(order);
    expect(calls.filter((call) => call === 'PUT rendition')).toHaveLength(2);
  });

  it('sends the date added with complete: now for a normal import', async () => {
    const spy = vi.spyOn(JSON, 'stringify');
    const { queue, rows } = queueOf('A/1.flac');
    const before = Math.floor(Date.now() / 1000);
    await importer(queue).run(rows, 1, () => {});
    const sent = spy.mock.calls.map(([value]) => value as { addedAt?: number }).find((value) => value && typeof value === 'object' && 'addedAt' in value);
    spy.mockRestore();
    expect(sent?.addedAt).toBeGreaterThanOrEqual(before);
  });

  it('imports one row with a given date and returns the new id', async () => {
    const spy = vi.spyOn(JSON, 'stringify');
    const { queue, rows } = queueOf('A/1.flac');
    const id = await importer(queue).importOne(rows[0]!, 1_262_304_000);
    const sent = spy.mock.calls.map(([value]) => value as { addedAt?: number }).find((value) => value && typeof value === 'object' && 'addedAt' in value);
    spy.mockRestore();
    expect(id).toBe('new-id');
    expect(sent?.addedAt).toBe(1_262_304_000);
    expect(rows[0]!.state).toBe('done');
  });

  it('imports one row the account already holds and returns that id', async () => {
    held.set('a'.repeat(64), 'known-id');
    answers['cloud/verify'] = () => json({ files: [{ rpmId: 'known-id', ok: true }] });
    const { queue, rows } = queueOf('A/1.flac');
    expect(await importer(queue).importOne(rows[0]!, 1_262_304_000)).toBe('known-id');
    expect(rows[0]!.state).toBe('known');
  });

  it('returns null for a row that failed for good', async () => {
    answers['cloud/upload/init'] = () => new Response('Invalid data found when processing input', { status: 400 });
    const { queue, rows } = queueOf('A/1.flac');
    expect(await importer(queue).importOne(rows[0]!, 1)).toBeNull();
    expect(rows[0]!.state).toBe('failed');
  });

  it('counts each row that is through, in every lane', async () => {
    const { queue, rows } = queueOf('A/1.flac', 'A/2.flac', 'A/3.flac');
    const finished = vi.fn();
    await importer(queue).run(rows, 2, finished);
    expect(finished.mock.calls.map(([count]) => count)).toEqual([1, 2, 3]);
  });

  it('counts a row that met a full store as through', async () => {
    answers['cloud/upload/init'] = () => new Response('{}', { status: 507 });
    const { queue, rows } = queueOf('A/1.flac', 'A/2.flac');
    const finished = vi.fn();
    expect(await importer(queue).run(rows, 1, finished)).toBe('full');
    expect(finished.mock.calls.map(([count]) => count)).toEqual([1]);
    expect(rows[1]!.state).toBe('ready');
  });

  it('knows when every row in the list has reached the cloud', () => {
    const { rows } = queueOf('A/1.flac', 'A/2.flac');
    expect(allImported([])).toBe(false);
    rows[0]!.state = 'done';
    expect(allImported(rows)).toBe(false);
    rows[1]!.state = 'known';
    expect(allImported(rows)).toBe(true);
    rows[1]!.state = 'failed';
    expect(allImported(rows)).toBe(false);
  });

  it('sends a disc label under its own key, once per album', async () => {
    answers['cloud/art/'] = () => json({ url: 'art' });
    const { queue, rows } = queueOf('A/1.flac', 'A/2.flac');
    queue.applyTags(rows, { Artist: 'ABBA', Album: 'Arrival' });
    const label = { bytes: new Uint8Array([1]), mime: 'image/png' };
    queue.setDisc(rows, label);
    await importer(queue).run(rows, 1, () => {});
    expect(calls).toContain('POST cloud/art/f245c4a44d16d5ca62f1abdf5da5458d');
    expect(calls.filter((call) => call === 'POST cloud/art/f245c4a44d16d5ca62f1abdf5da5458d')).toHaveLength(1);
  });

  it('sends nothing for a disc when none was picked', async () => {
    const { queue, rows } = queueOf('A/1.flac');
    queue.applyTags(rows, { Artist: 'ABBA', Album: 'Arrival' });
    await importer(queue).run(rows, 1, () => {});
    expect(calls).not.toContain('POST cloud/art/f245c4a44d16d5ca62f1abdf5da5458d');
  });

  it('still sends a disc picked for a track the account already holds', async () => {
    held.set('a'.repeat(64), 'known-id');
    answers['cloud/verify'] = () => json({ files: [{ rpmId: 'known-id', ok: true }] });
    answers['cloud/art/'] = () => json({ url: 'art' });
    const { queue, rows } = queueOf('A/1.flac');
    queue.applyTags(rows, { Artist: 'ABBA', Album: 'Arrival' });
    queue.setDisc(rows, { bytes: new Uint8Array([1]), mime: 'image/png' });
    await importer(queue).run(rows, 1, () => {});
    expect(rows[0]!.state).toBe('known');
    expect(calls).toContain('POST cloud/art/f245c4a44d16d5ca62f1abdf5da5458d');
  });

  it('does not fail a track over a disc label that will not upload', async () => {
    answers['cloud/art/'] = () => json({}, 500);
    const { queue, rows } = queueOf('A/1.flac');
    queue.setDisc(rows, { bytes: new Uint8Array([1]), mime: 'image/png' });
    await importer(queue).run(rows, 1, () => {});
    expect(rows[0]!.state).toBe('done');
  });

  it('proves possession instead of uploading when the store has the bytes', async () => {
    answers['cloud/upload/init'] = () =>
      json({ status: 'challenge', sidecarUrl: 'sidecar', challengeId: 'c', nonce: 'AQ==', ranges: [{ offset: 0, length: 2 }] });
    const { queue, rows } = queueOf('A/1.flac');
    await importer(queue).run(rows, 1, () => {});
    expect(calls).toContain('POST cloud/upload/prove');
    expect(calls).not.toContain('PUT blob');
    expect(rows[0]!.state).toBe('done');
  });

  it('does not store audio the account already holds, after checking the store has it', async () => {
    held.set('a'.repeat(64), 'old-id');
    answers['cloud/verify'] = () => json({ files: [{ rpmId: 'old-id', ok: true }] });
    const { queue, rows } = queueOf('A/1.flac');
    await importer(queue).run(rows, 1, () => {});
    expect(rows[0]).toMatchObject({ state: 'known', note: 'Web_ImportAlreadyThere' });
    expect(calls).not.toContain('POST cloud/upload/init');
  });

  it('uploads when the catalogue is out of date and the store no longer has it', async () => {
    held.set('a'.repeat(64), 'old-id');
    answers['cloud/verify'] = () => json({ files: [{ rpmId: 'old-id', ok: false }] });
    const { queue, rows } = queueOf('A/1.flac');
    await importer(queue).run(rows, 1, () => {});
    expect(rows[0]!.state).toBe('done');
  });

  it('counts a track as imported even if its renditions fail', async () => {
    const { queue, rows } = queueOf('A/1.flac');
    await importer(queue, { renditions: async () => { throw new Error('encoder'); } }).run(rows, 1, () => {});
    expect(rows[0]!.state).toBe('done');
  });

  it('marks an unreadable file failed at once, without retrying', async () => {
    const canonical = vi.fn(async () => { throw new Error('Invalid data found when processing input'); });
    const { queue, rows } = queueOf('A/1.flac');
    await importer(queue, { canonical }).run(rows, 1, () => {});
    expect(rows[0]).toMatchObject({ state: 'failed', note: 'Cloud_FailUnreadable' });
    expect(canonical).toHaveBeenCalledTimes(1);
  });

  it('tries a dropped upload again', async () => {
    let first = true;
    answers['cloud/upload/init'] = () => {
      if (first) {
        first = false;
        return json({}, 500);
      }
      return json({ status: 'upload', sidecarUrl: 'sidecar', blobUrl: 'blob' });
    };
    const { queue, rows } = queueOf('A/1.flac');
    await importer(queue).run(rows, 1, () => {});
    expect(rows[0]!.state).toBe('done');
  });

  it('stops the run when the quota is full, and leaves the rest ready', async () => {
    answers['cloud/quota'] = () => json({ usedBytes: 999, quotaBytes: 1000, fileCount: 0 });
    const { queue, rows } = queueOf('A/1.flac', 'A/2.flac');
    expect(await importer(queue).run(rows, 1, () => {})).toBe('full');
    expect(rows[0]).toMatchObject({ state: 'failed', note: 'Rpm_Error_StorageFull' });
    expect(rows[1]!.state).toBe('ready');
  });

  it('treats an unlimited account as having room', async () => {
    answers['cloud/quota'] = () => json({ usedBytes: 999, quotaBytes: 1000, fileCount: 0, unlimited: true });
    const { queue, rows } = queueOf('A/1.flac');
    expect(await importer(queue).run(rows, 1, () => {})).toBe('done');
  });

  it('keeps an id already in the file', async () => {
    const { queue, rows } = queueOf('A/1.flac');
    rows[0]!.tags.RpmId = '072008A6-107F-4773-9DE7-EEC47E22C83F';
    const importing = importer(queue);
    await importing.run(rows, 1, () => {});
    expect(calls.join()).not.toContain('new-id/upload');
  });

});
