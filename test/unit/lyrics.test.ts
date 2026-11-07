import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../src/api/http';
import type { CloudTrack } from '../../src/api/wire';
import { Lyrics } from '../../src/lyrics/lookup';
import { isRest, partAt, REST_SECONDS, scoreOf, sectionAt } from '../../src/lyrics/score';
import { isSynced, isWordless, lineAt, parseSheet, unstamp } from '../../src/lyrics/sheet';

const rests = (lrc: string) =>
  scoreOf(parseSheet(lrc)).flatMap((part) => (isRest(part.piece) ? [[part.piece.from, part.piece.until]] : []));
const score = (lrc: string) => scoreOf(parseSheet(lrc));

describe('an LRC, read', () => {
  it('does not take plain lyrics for a sheet', () => {
    expect(isSynced(parseSheet("Hello darkness my old friend\nI've come to talk"))).toBe(false);
    expect(isSynced(parseSheet(''))).toBe(false);
    expect(isSynced(parseSheet(null))).toBe(false);
  });

  it('times a line, and its words are its own', () => {
    const sheet = parseSheet('[00:12.30]Hello darkness\n[00:15.00]My old friend');
    expect(sheet.lines).toHaveLength(2);
    expect(sheet.lines[0]!.seconds).toBeCloseTo(12.3);
    expect(sheet.lines[0]!.text).toBe('Hello darkness');
    expect(sheet.lines[1]!.seconds).toBe(15);
  });

  it('reads the scale from the digits of the fraction', () => {
    expect(parseSheet('[00:01.5]a').lines[0]!.seconds).toBeCloseTo(1.5);
    expect(parseSheet('[00:01.05]a').lines[0]!.seconds).toBeCloseTo(1.05);
    expect(parseSheet('[00:01.005]a').lines[0]!.seconds).toBeCloseTo(1.005);
    expect(parseSheet('[00:01:50]a').lines[0]!.seconds).toBeCloseTo(1.5);
  });

  it('lands a line with several stamps once for each', () => {
    const sheet = parseSheet('[00:10.00][01:20.00][02:30.00]The chorus');
    expect(sheet.lines.map((line) => line.seconds)).toEqual([10, 80, 150]);
    expect(sheet.lines.every((line) => line.text === 'The chorus')).toBe(true);
  });

  it('shifts the whole sheet by the offset tag, with the sign of the convention', () => {
    expect(parseSheet('[offset:+500]\n[00:10.00]a').lines[0]!.seconds).toBe(9.5);
    expect(parseSheet('[offset:-500]\n[00:10.00]a').lines[0]!.seconds).toBe(10.5);
    expect(parseSheet('[offset:+5000]\n[00:01.00]a').lines[0]!.seconds).toBe(0);
  });

  it('keeps a blank line', () => {
    const sheet = parseSheet('[00:10.00]a\n[00:20.00]\n[00:30.00]b');
    expect(sheet.lines).toHaveLength(3);
    expect(sheet.lines[1]!.text).toBe('');
  });

  it('puts a sheet out of order in order', () => {
    expect(parseSheet('[00:30.00]c\n[00:10.00]a\n[00:20.00]b').lines.map((line) => line.text)).toEqual(['a', 'b', 'c']);
  });

  it('skips metadata tags and prose', () => {
    const sheet = parseSheet('[ar:Enya]\n[ti:Orinoco Flow]\nsome prose\n[00:10.00]a');
    expect(sheet.lines.map((line) => line.text)).toEqual(['a']);
  });

  it('carries the words of a word-stamped line', () => {
    const sheet = parseSheet('[00:12.00]<00:12.00>Hello <00:12.90>darkness');
    expect(sheet.lines[0]!.words?.map((word) => word.text)).toEqual(['Hello', 'darkness']);
    expect(sheet.lines[0]!.words?.[1]!.seconds).toBeCloseTo(12.9);
    expect(sheet.lines[0]!.text).toBe('Hello darkness');
  });

  it('keeps no word times for a refrain', () => {
    expect(parseSheet('[00:10.00][01:20.00]<00:10.00>La <00:10.50>la').lines.every((line) => line.words === null)).toBe(true);
  });

  it('takes a stamp left in the words out of them', () => {
    expect(unstamp('[00:12.30] Hello')).toBe('Hello');
    expect(unstamp('(00:12.30) Hello')).toBe('Hello');
    expect(unstamp('00:12.300 Hello')).toBe('Hello');
    expect(unstamp('<00:12.30>Hello <00:12.90>darkness')).toBe('Hello darkness');
  });

  it('leaves a time in the words alone', () => {
    expect(unstamp('3:15 in the morning')).toBe('3:15 in the morning');
  });

  it('counts a line of notes as having nothing to read', () => {
    expect(isWordless('')).toBe(true);
    expect(isWordless('   ')).toBe(true);
    expect(isWordless('♪')).toBe(true);
    expect(isWordless('\u{1f3b5} \u{1f3b6}')).toBe(true);
    expect(isWordless('la')).toBe(false);
    expect(isWordless('♯')).toBe(false);
  });

  it('finds the line being sung, and no line in the intro', () => {
    const sheet = parseSheet('[00:10.00]a\n[00:20.00]b\n[00:30.00]c');
    expect(lineAt(sheet, 9.9)).toBeNull();
    expect(lineAt(sheet, 10)).toBe(0);
    expect(lineAt(sheet, 19.9)).toBe(0);
    expect(lineAt(sheet, 20)).toBe(1);
    expect(lineAt(sheet, 300)).toBe(2);
  });
});

describe('a sheet cut into stretches', () => {
  it('keeps a sheet with no breaks as one stretch', () => {
    const sung = score('[00:10.00]a\n[00:20.00]b\n[00:30.00]c');
    expect(sectionAt(sung, 10)).toBe(0);
    expect(sectionAt(sung, 30)).toBe(0);
    expect(sung.filter((part) => isRest(part.piece))).toHaveLength(1);
  });

  it('makes a wordless line a rest', () => {
    const lrc = '[00:10.00]a\n[00:30.00]♪\n[01:30.00]b';
    expect(rests(lrc)[0]).toEqual([30, 90]);
    const sung = score(lrc);
    expect(sectionAt(sung, 20)).toBe(0);
    expect(sectionAt(sung, 40)).toBe(0);
    expect(sectionAt(sung, 95)).toBe(1);
  });

  it('counts a long wait as a break even though nobody marked it', () => {
    const lrc = '[00:10.00]a\n[01:30.00]b';
    expect(rests(lrc)[0]).toEqual([18, 90]);
    const sung = score(lrc);
    expect(sectionAt(sung, 12)).toBe(0);
    expect(sectionAt(sung, 60)).toBe(0);
    expect(sectionAt(sung, 95)).toBe(1);
  });

  it('does not count a breath as a break', () => {
    const sung = score('[00:10.00]a\n[00:19.00]b\n[00:28.00]c');
    expect(sectionAt(sung, 28)).toBe(0);
    expect(sung.filter((part) => isRest(part.piece))).toHaveLength(1);
  });

  it('uses the wait the desktop uses', () => {
    expect(REST_SECONDS).toBe(20);
    expect(sectionAt(score('[00:10.00]a\n[00:30.00]b'), 35)).toBe(1);
    expect(sectionAt(score('[00:10.00]a\n[00:29.00]b'), 35)).toBe(0);
  });

  it('ends in a rest that never finishes', () => {
    expect(rests('[00:10.00]a').at(-1)![1]).toBe(Infinity);
    expect(sectionAt(score('[00:10.00]a'), 11)).toBe(0);
  });

  it('has no piece before the first line', () => {
    expect(partAt(score('[00:10.00]a'), 3)).toBeNull();
    expect(sectionAt(score('[00:10.00]a'), 3)).toBeNull();
  });

  it('numbers the pieces in the order they are sung', () => {
    const sung = score('[00:10.00]a\n[01:30.00]b');
    expect(sung.map((part) => part.id)).toEqual([0, 1, 2, 3]);
    expect(sung.map((part) => part.seconds)).toEqual([10, 18, 90, 98]);
  });
});

const track = (over: Partial<CloudTrack> = {}): CloudTrack => ({
  rpmId: 'one',
  sha256: '',
  relativePath: null,
  originalSize: 0,
  title: 'I Try',
  artist: 'Macy Gray',
  album: 'On How Life Is',
  addedAt: 0,
  updatedAt: 0,
  tags: { durationSeconds: 239 },
  ...over,
});

describe('where the words come from', () => {
  const noSheet = () => {
    throw new ApiError(404, 'none');
  };

  // The store's chosen sheet, then the API's list of LRCLIB's sheets.
  const fake = (chosen: () => string | null, sheets: () => string[]) => ({
    json: vi.fn(async (path: string, read: (raw: unknown) => unknown) => (path.startsWith('metadata/lyrics') ? read({ sheets: sheets() }) : read({ lrc: chosen() }))),
    call: vi.fn(async () => new Response()),
  });

  it('asks about the record, with its length', async () => {
    const api = fake(() => null, () => ['[00:01.00]one']);
    await new Lyrics(api as never).of(track());
    const asked = new URL(`https://x/${api.json.mock.calls[1]![0]}`).searchParams;
    expect([asked.get('title'), asked.get('artist'), asked.get('album'), asked.get('seconds')]).toEqual(['I Try', 'Macy Gray', 'On How Life Is', '239']);
  });

  it('leaves out what carries no timings', async () => {
    const api = fake(() => null, () => ['just words', '[00:01.00]timed']);
    expect((await new Lyrics(api as never).of(track())).lines[0]!.text).toBe('timed');
  });

  it('asks nobody about a track with no title', async () => {
    const api = fake(() => null, () => []);
    const sheet = await new Lyrics(api as never).of(track({ title: '  ' }));
    expect(isSynced(sheet)).toBe(false);
    expect(api.json).not.toHaveBeenCalled();
  });

  it('puts the owner\'s chosen sheet before LRCLIB', async () => {
    const api = fake(() => '[00:01.00]mine', () => ['[00:01.00]other']);
    const sheet = await new Lyrics(api as never).of(track());
    expect(sheet.lines[0]!.text).toBe('mine');
    expect(api.json).toHaveBeenCalledTimes(1);
  });

  it('goes to LRCLIB when the owner chose none', async () => {
    const api = fake(noSheet, () => ['[00:01.00]lrclib']);
    expect((await new Lyrics(api as never).of(track())).lines[0]!.text).toBe('lrclib');
  });

  it('asks once per track', async () => {
    const api = fake(() => null, () => ['[00:01.00]lrclib']);
    const lyrics = new Lyrics(api as never);
    await lyrics.of(track());
    await lyrics.of(track());
    expect(api.json).toHaveBeenCalledTimes(2);
  });

  it('shows no words when nobody answered, and asks again next time', async () => {
    let tries = 0;
    const api = fake(() => null, () => {
      if (++tries === 1) throw new ApiError(502, 'silent');
      return ['[00:01.00]back'];
    });
    const lyrics = new Lyrics(api as never);
    expect(isSynced(await lyrics.of(track()))).toBe(false);
    expect((await lyrics.of(track())).lines[0]!.text).toBe('back');
  });

  it('goes round the other sheets, and tells the store which was chosen', async () => {
    const api = fake(() => null, () => ['[00:01.00]one', '[00:01.00]two', '[00:01.00]three']);
    const lyrics = new Lyrics(api as never);

    const first = await lyrics.of(track());
    const second = await lyrics.another(track(), first);
    const third = await lyrics.another(track(), second!);
    const again = await lyrics.another(track(), third!);

    expect([second, third, again].map((sheet) => sheet!.lines[0]!.text)).toEqual(['two', 'three', 'one']);
    expect(api.call).toHaveBeenCalledTimes(3);
    expect((api.call.mock.calls as unknown[][])[0]).toEqual(['cloud/lyric-sheet/one', { method: 'PUT', body: { lrc: '[00:01.00]two' } }]);
    expect(await lyrics.of(track())).toBe(again);
  });

  it('says so when there is nothing else to show', async () => {
    const api = fake(() => null, () => ['[00:01.00]only']);
    const lyrics = new Lyrics(api as never);
    expect(await lyrics.another(track(), await lyrics.of(track()))).toBeNull();
    expect(api.call).not.toHaveBeenCalled();
  });

  it('refuses a file of the listener\'s that carries no timings', async () => {
    const api = fake(() => null, () => []);
    const lyrics = new Lyrics(api as never);
    expect(await lyrics.own(track(), 'just the words')).toBeNull();
    expect(api.call).not.toHaveBeenCalled();
    expect((await lyrics.own(track(), '[00:01.00]mine'))!.lines[0]!.text).toBe('mine');
    expect(api.call).toHaveBeenCalledTimes(1);
  });
});
