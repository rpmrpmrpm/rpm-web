import { describe, expect, it } from 'vitest';

import { Api } from '../../src/api/http';
import type { ImportMedia } from '../../src/import/media';
import { ImportQueue, needsName, type ImportRow } from '../../src/import/queue';
import { clipStart, nameOf, Recogniser, type Report } from '../../src/import/recognise';

const AVICII = { title: 'Wake Me Up', artist: 'Avicii', album: 'True', year: 2013, score: 0.9, mbRecordingId: null };
const matched = (source: string, track: object = AVICII) => ({ status: 'matched', source, track });
const UNKNOWN = { status: 'unknown', source: null, track: null };

interface Stage {
  rows: ImportRow[];
  queue: ImportQueue;
  asked: { path: string; body: Record<string, unknown> }[];
  clips: { start: number; seconds: number }[];
  run: (advanced: boolean, signal?: AbortSignal) => Promise<Report>;
}

// answers: what each call to a path says, in order. A number is a status to fail with.
function stage(names: string[], answers: Record<string, (object | number)[]>, unreadable: string[] = []): Stage {
  const queue = new ImportQueue();
  const rows = queue.add(names.map((name) => ({ file: new File(['x'], name), path: name })));
  for (const row of rows) row.state = 'ready';

  const asked: Stage['asked'] = [];
  const clips: Stage['clips'] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    const path = String(url).replace('/api/', '');
    asked.push({ path, body: JSON.parse(String(init.body)) });
    const next = answers[path]!.shift()!;
    if (typeof next === 'number') return new Response('{}', { status: next });
    return new Response(JSON.stringify(next), { status: 200 });
  }) as typeof fetch;
  const api = new Api('/api/', { accessToken: async () => 'token' }, fetcher, async () => {});

  const media = {
    fingerprint: async (file: File) => {
      if (unreadable.includes(file.name)) throw new Error('Invalid data found');
      return { text: `print-${file.name}`, raw: [1, -2], seconds: 240 };
    },
    clip: async (_file: File, _kilobits: number, start: number, seconds: number) => {
      clips.push({ start, seconds });
      return new Uint8Array([1, 2, 3]);
    },
  } as unknown as ImportMedia;

  const recogniser = new Recogniser(api, media, queue);
  const run = (advanced: boolean, signal = new AbortController().signal) =>
    recogniser.run(rows, advanced, { started() {}, landed() {} }, signal);
  return { rows, queue, asked, clips, run };
}

describe('the clip', () => {
  it('starts a third of the way in, past an intro', () => {
    expect(clipStart(240)).toBe(80);
  });

  it('stays inside a short track', () => {
    expect(clipStart(30)).toBe(10);
    expect(clipStart(20)).toBe(4);
  });

  it('starts at the beginning of a track shorter than a clip', () => {
    expect(clipStart(10)).toBe(0);
  });
});

describe('a name', () => {
  it('shows what exists', () => {
    expect(nameOf('Avicii', 'Wake Me Up')).toBe('Avicii · Wake Me Up');
    expect(nameOf(null, 'Wake Me Up')).toBe('Wake Me Up');
    expect(nameOf('Avicii', '  ')).toBe('Avicii');
    expect(nameOf(' ', null)).toBeNull();
  });
});

describe('a run', () => {
  it('sends both forms of the fingerprint and the length', async () => {
    const { asked, run } = stage(['a.flac'], { identify: [matched('acoustid')] });
    await run(false);
    expect(asked).toEqual([{ path: 'identify', body: { fingerprint: 'print-a.flac', rawFingerprint: [1, -2], durationSeconds: 240 } }]);
  });

  it('writes the answer on the row', async () => {
    const { rows, run } = stage(['a.flac'], { identify: [matched('own-db')] });
    rows[0]!.tags.Title = 'Track 04';
    const report = await run(false);
    expect(rows[0]!.tags).toMatchObject({ Title: 'Wake Me Up', Artist: 'Avicii', Album: 'True', Year: 2013 });
    expect(report.outcomes[0]).toMatchObject({ source: 'own-db', score: 0.9, wasTitle: 'Track 04' });
    expect(report.recognised).toBe(1);
  });

  it('keeps the album and year the file has when the answer has none', async () => {
    const { rows, run } = stage(['a.flac'], { identify: [matched('own-db', { ...AVICII, album: null, year: 0 })] });
    rows[0]!.tags.Album = 'Mine';
    rows[0]!.tags.Year = 1999;
    await run(false);
    expect(rows[0]!.tags).toMatchObject({ Title: 'Wake Me Up', Album: 'Mine', Year: 1999 });
  });

  it('does not take an answer it is not sure of', async () => {
    const { rows, run } = stage(['a.flac'], { identify: [matched('acoustid', { ...AVICII, score: 0.49 })] });
    const report = await run(false);
    expect(rows[0]!.tags.Title).toBeUndefined();
    expect(report.outcomes[0]!.answer).toBeNull();
    expect(report.recognised).toBe(0);
  });

  it('counts a track nobody knows as a miss, not a failure', async () => {
    const { run } = stage(['a.flac'], { identify: [UNKNOWN] });
    const report = await run(false);
    expect(report.outcomes[0]).toMatchObject({ answer: null, failed: false });
    expect(report.stopped).toBeNull();
  });

  it('carries on past a file that cannot be read', async () => {
    const { rows, run } = stage(['bad.flac', 'good.flac'], { identify: [matched('own-db')] }, ['bad.flac']);
    const report = await run(false);
    expect(report.outcomes.map((outcome) => outcome.failed)).toEqual([true, false]);
    expect(rows[1]!.tags.Title).toBe('Wake Me Up');
  });

  it('carries on past a call that failed for one track', async () => {
    const { run } = stage(['a.flac', 'b.flac'], { identify: [429, matched('own-db')] });
    const report = await run(false);
    expect(report.outcomes.map((outcome) => outcome.failed)).toEqual([true, false]);
  });

  it.each([502, 503])('stops when the service answers %i, because every track would fail the same way', async (status) => {
    const { asked, run } = stage(['a.flac', 'b.flac'], { identify: [status] });
    const report = await run(false);
    expect(asked).toHaveLength(1);
    expect(report.stopped).toBe('Recognize_Unavailable');
    expect(report.outcomes).toEqual([]);
  });

  it('stops between tracks when cancelled, and keeps the names it found', async () => {
    const stop = new AbortController();
    const queue = stage(['a.flac', 'b.flac'], { identify: [matched('own-db'), matched('own-db')] });
    const report = await new Recogniser(
      new Api('/api/', { accessToken: async () => 'token' }, (async () => new Response(JSON.stringify(matched('own-db')))) as typeof fetch, async () => {}),
      { fingerprint: async () => ({ text: 'p', raw: [1], seconds: 240 }) } as unknown as ImportMedia,
      queue.queue,
    ).run(queue.rows, false, { started() {}, landed: () => stop.abort() }, stop.signal);
    expect(report.outcomes).toHaveLength(1);
    expect(report.stopped).toBe('Review_RecognizeCancelled');
    expect(queue.rows[0]!.tags.Title).toBe('Wake Me Up');
    expect(queue.rows[1]!.tags.Title).toBeUndefined();
  });

  it('counts what it attempted, so a stopped run reads as one', async () => {
    const { run } = stage(['a.flac', 'b.flac'], { identify: [503] });
    expect((await run(false)).attempted).toBe(2);
  });
});

describe('the advanced layer', () => {
  it('is not asked when the basic layers name the track', async () => {
    const { asked, clips, run } = stage(['a.flac'], { identify: [matched('own-db')] });
    await run(true);
    expect(asked.map((call) => call.path)).toEqual(['identify']);
    expect(clips).toEqual([]);
  });

  it('is not asked for an account that does not have it', async () => {
    const { asked, run } = stage(['a.flac'], { identify: [UNKNOWN] });
    await run(false);
    expect(asked.map((call) => call.path)).toEqual(['identify']);
  });

  it('hears a clip of what the basic layers could not name', async () => {
    const { asked, clips, rows, run } = stage(['a.flac'], { identify: [UNKNOWN], 'identify-clip': [matched('audd', { ...AVICII, score: 0.95 })] });
    const report = await run(true);
    expect(clips).toEqual([{ start: 80, seconds: 15 }]);
    expect(asked[1]).toEqual({ path: 'identify-clip', body: { clipBase64: 'AQID', rawFingerprint: [1, -2], durationSeconds: 240 } });
    expect(rows[0]!.tags.Title).toBe('Wake Me Up');
    expect(report).toMatchObject({ sentToAudD: 1, identifiedByAudD: 1 });
  });

  it('counts a miss as sent, and not as identified', async () => {
    const { run } = stage(['a.flac'], { identify: [UNKNOWN], 'identify-clip': [{ status: 'unknown', source: 'audd', track: null }] });
    expect(await run(true)).toMatchObject({ sentToAudD: 1, identifiedByAudD: 0 });
  });

  it('does not count a clip the rpm database answered, because AudD never heard it', async () => {
    const { run } = stage(['a.flac'], { identify: [UNKNOWN], 'identify-clip': [matched('own-db')] });
    expect(await run(true)).toMatchObject({ sentToAudD: 0, identifiedByAudD: 0, recognised: 1 });
  });

  it.each([[403], [402]])('being refused (%i) leaves the rest of the run on the basic layers', async (status) => {
    const { asked, run } = stage(['a.flac', 'b.flac'], { identify: [UNKNOWN, UNKNOWN], 'identify-clip': [status] });
    const report = await run(true);
    expect(asked.map((call) => call.path)).toEqual(['identify', 'identify-clip', 'identify']);
    expect(report.note).toBe('Recognize_AdvancedRefused');
    expect(report.stopped).toBeNull();
    expect(report.outcomes.map((outcome) => outcome.failed)).toEqual([false, false]);
  });

  it.each([[502], [503]])('failing (%i) leaves the rest of the run on the basic layers', async (status) => {
    const { asked, rows, run } = stage(['a.flac', 'b.flac'], { identify: [UNKNOWN, matched('own-db')], 'identify-clip': [status] });
    const report = await run(true);
    expect(asked.map((call) => call.path)).toEqual(['identify', 'identify-clip', 'identify']);
    expect(report.note).toBe('Recognize_AdvancedDown');
    expect(report.stopped).toBeNull();
    expect(rows[1]!.tags.Title).toBe('Wake Me Up');
  });

  it('failing in any other way fails that track and keeps the layer for the next', async () => {
    const { asked, run } = stage(['a.flac', 'b.flac'], { identify: [UNKNOWN, UNKNOWN], 'identify-clip': [500, { status: 'unknown', source: 'audd', track: null }] });
    const report = await run(true);
    expect(asked.map((call) => call.path)).toEqual(['identify', 'identify-clip', 'identify', 'identify-clip']);
    expect(report.outcomes.map((outcome) => outcome.failed)).toEqual([true, false]);
    expect(report.note).toBeNull();
  });
});

describe('which rows need a name', () => {
  const rows = () => stage(['a.flac'], {}).rows;

  it('is a row with no artist or no title', () => {
    const [row] = rows();
    expect(needsName(row!)).toBe(true);
    row!.tags.Title = 'A';
    expect(needsName(row!)).toBe(true);
    row!.tags.Artist = 'B';
    expect(needsName(row!)).toBe(false);
  });

  it('is a row named from its file name, until something better names it', () => {
    const { queue, rows: [row] } = stage(['Avicii - Wake Me Up.flac'], {});
    queue.tagsFromFilename([row!], '{artist} - {title}');
    expect(row!.tags.Title).toBe('Wake Me Up');
    expect(needsName(row!)).toBe(true);
    queue.applyRecognition(row!, AVICII);
    expect(needsName(row!)).toBe(false);
  });

  it('is not a row the person named themselves', () => {
    const { queue, rows: [row] } = stage(['Avicii - Wake Me Up.flac'], {});
    queue.tagsFromFilename([row!], '{artist} - {title}');
    queue.applyTags([row!], { Title: 'Typed' });
    expect(needsName(row!)).toBe(false);
  });
});
