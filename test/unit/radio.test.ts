import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../src/api/http';
import { DirectoryDown, RadioDirectory } from '../../src/radio/directory';
import { changed, emptyLedger, forAccount, holds, RadioFavorites, savedOf, sent, taking, toSend } from '../../src/radio/favorites';
import { cutsToOrder, isDrawable, logosOf, rankLogo, samePicture } from '../../src/radio/logo';
import { forPicker, genreNames, genreTerm, isGenre, NO_RULES, NO_SIEVE, onePerStation, sieveIsOn, shortCountry, sorted, throughSieve, underRules, withRetagged } from '../../src/radio/results';
import { RadioRules } from '../../src/radio/rules';
import { HAND_OUT_SECONDS, NOTICED_SECONDS, StationCounter } from '../../src/radio/tuner';
import { callSign, carriesAds, cleanName, displayOf, distinguish, foldName, fullName, genresOf, type RadioStation } from '../../src/radio/station';

const station = (over: Partial<RadioStation> & { uuid: string }): RadioStation => ({ name: over.uuid, streamUrl: `https://stream.test/${over.uuid}`, ...over });

describe('a station\'s name', () => {
  it('loses the specification', () => {
    expect(cleanName('Radio Paradise (320k)')).toBe('Radio Paradise');
    expect(cleanName('Jazz FM [AAC 128]')).toBe('Jazz FM');
    expect(cleanName('Rock Antenne #MP3#')).toBe('Rock Antenne');
    expect(cleanName('Classic 128 kbps')).toBe('Classic');
    expect(cleanName('SomaFM MP3 128')).toBe('SomaFM');
  });

  it('stops at the dash', () => {
    expect(cleanName('BBC Radio 1 - The best new music')).toBe('BBC Radio 1');
    expect(cleanName('NPO 3FM | Pop')).toBe('NPO 3FM');
    expect(fullName('BBC Radio 1 - The best new music')).toBe('BBC Radio 1 - The best new music');
  });

  it('keeps a number that is not a bitrate on its own', () => {
    expect(cleanName('Radio 538')).toBe('Radio 538');
  });

  it('keeps a name that is nothing but a specification', () => {
    expect(cleanName('MP3')).toBe('MP3');
  });

  it('prefers the admin\'s name', () => {
    expect(displayOf(station({ uuid: 'a', name: 'x', edit: { name: 'Mine', tags: null, description: null } }))).toBe('Mine');
  });

  it('keeps the long name where two stations share the short one', () => {
    const told = distinguish([station({ uuid: 'a', name: 'Sky - Rock' }), station({ uuid: 'b', name: 'Sky - Jazz' }), station({ uuid: 'c', name: 'Other' })]);
    expect(told.map(displayOf)).toEqual(['Sky - Rock', 'Sky - Jazz', 'Other']);
  });

  it('leaves out of the genres a tag that is a specification', () => {
    expect(genresOf(['jazz', '128 kbps', '#nowplaying', ' soul '])).toEqual(['jazz', 'soul']);
  });

  it('folds a name down to what tells it from another', () => {
    expect(foldName('Radio Nederland FM', 'NL')).toBe('nederland');
    expect(foldName('Sky Radio Nederland', 'NL')).toBe('sky');
    expect(foldName('Élan Radio', null)).toBe('elan');
  });
});

describe('the sign on the dial', () => {
  it('takes a short name whole', () => {
    expect(callSign('BBC')).toBe('BBC');
    expect(callSign('NPO Radio 1')).toBe('NPO1');
    expect(callSign('KEXP')).toBe('KEXP');
    expect(callSign('Radio 538')).toBe('538');
  });

  it('takes the first letters of a long one', () => {
    expect(callSign('The Quick Brown Fox Jumps')).toBe('QBFJ');
  });

  it('skips the words that carry nothing', () => {
    expect(callSign('Radio Paradise')).toBe('PARA');
    expect(callSign('Radio de la Mar')).toBe('MAR');
  });

  it('is empty for nothing', () => {
    expect(callSign('')).toBe('');
    expect(callSign(null)).toBe('');
  });
});

describe('advertising', () => {
  it('reads the tags', () => {
    expect(carriesAds({ name: 'x', tags: ['commercial'] })).toBe(true);
    expect(carriesAds({ name: 'x', tags: ['jazz'] })).toBe(false);
  });

  it('lets an ad-free tag settle it', () => {
    expect(carriesAds({ name: 'x', tags: ['commercial', 'non-commercial'] })).toBe(false);
    expect(carriesAds({ name: 'BBC', tags: ['ad free'] })).toBe(false);
  });

  it('knows the broadcasters by site and by name', () => {
    expect(carriesAds({ name: 'x', tags: [], homepage: 'https://www.bbc.co.uk/sounds' })).toBe(true);
    expect(carriesAds({ name: 'BBC Radio 2', tags: [] })).toBe(true);
    expect(carriesAds({ name: 'Rtlx', tags: [] })).toBe(false);
  });
});

describe('logos', () => {
  it('refuses what cannot be drawn', () => {
    expect(isDrawable('https://a.test/x.png')).toBe(true);
    expect(isDrawable('data:image/png;base64,AA')).toBe(false);
    expect(isDrawable('')).toBe(false);
  });

  it('prefers the station\'s own site, a picture with alpha, and https', () => {
    const home = 'https://station.test/';
    expect(rankLogo('https://station.test/logo.png', home)).toBeGreaterThan(rankLogo('https://other.test/logo.png', home));
    expect(rankLogo('https://other.test/logo.png', home)).toBeGreaterThan(rankLogo('https://other.test/logo.jpg', home));
    expect(rankLogo('https://other.test/logo.jpg', home)).toBeGreaterThan(rankLogo('https://other.test/favicon.ico', home));
    expect(rankLogo('https://other.test/logo.png', home)).toBeGreaterThan(rankLogo('http://other.test/logo.png', home));
  });

  it('counts one picture at two sizes once', () => {
    expect(cutsToOrder('https://i.iheart.com/a?ops=contain(100,100)')).toBe(true);
    expect(samePicture('https://i.iheart.com/a?ops=contain(100,100)')).toBe(samePicture('https://i.iheart.com/a?ops=contain(600,600)'));
    expect(samePicture('https://cdn-profiles.tunein.com/s1/images/logoq.png')).toBe(samePicture('https://cdn-profiles.tunein.com/s1/images/logog.png'));
  });

  it('tries only what a page on https can fetch', () => {
    expect(logosOf('http://a.test/x.png', ['https://b.test/y.png', ''])).toEqual(['https://b.test/y.png']);
  });
});

describe('one row per station', () => {
  it('folds rows with one name in one country', () => {
    const rows = onePerStation([
      station({ uuid: 'a', name: 'Radio Paradise (128k)', countryCode: 'US', bitrateKbps: 128 }),
      station({ uuid: 'b', name: 'Radio Paradise (320k)', countryCode: 'US', bitrateKbps: 320 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.uuid).toBe('b');
    expect(rows[0]!.alsoFiledAs).toEqual(['a']);
  });

  it('folds rows with one stream, under any name', () => {
    const rows = onePerStation([station({ uuid: 'a', name: 'One', streamUrl: 'https://www.s.test/live/' }), station({ uuid: 'b', name: 'Two', streamUrl: 'https://s.test/live' })]);
    expect(rows).toHaveLength(1);
  });

  it('keeps one name in two countries apart', () => {
    expect(onePerStation([station({ uuid: 'a', name: 'Energy', countryCode: 'DE' }), station({ uuid: 'b', name: 'Energy', countryCode: 'CH' })])).toHaveLength(2);
  });

  it('joins a chain: a shares a name with b, and b a stream with c', () => {
    const rows = onePerStation([
      station({ uuid: 'a', name: 'Same', streamUrl: 'https://1.test/' }),
      station({ uuid: 'b', name: 'Same', streamUrl: 'https://2.test/' }),
      station({ uuid: 'c', name: 'Else', streamUrl: 'https://2.test/' }),
    ]);
    expect(rows).toHaveLength(1);
  });

  it('prefers a stream the directory could reach, whatever its rate', () => {
    const rows = onePerStation([station({ uuid: 'a', name: 'X', reachable: false, bitrateKbps: 320 }), station({ uuid: 'b', name: 'X', reachable: true, bitrateKbps: 64 })]);
    expect(rows[0]!.uuid).toBe('b');
  });

  it('keeps every logo, the best first', () => {
    const rows = onePerStation([station({ uuid: 'a', name: 'X', favicon: 'https://x.test/a.ico' }), station({ uuid: 'b', name: 'X', favicon: 'https://x.test/b.png' })]);
    expect(rows[0]!.favicon).toBe('https://x.test/b.png');
    expect(rows[0]!.otherLogos).toEqual(['https://x.test/a.ico']);
  });
});

describe('genres', () => {
  it('finds a genre through the spellings of a tag', () => {
    expect(genreNames('hip-hop')).toEqual(['Hip-Hop']);
    expect(genreNames('Hip Hop')).toEqual(['Hip-Hop']);
    expect(genreNames('jazzradio')).toEqual(['Jazz']);
    expect(genreNames('classic rock')).toEqual(['Classic Rock']);
  });

  it('reads a tag of several genres', () => {
    expect(genreNames('rock and jazz')).toEqual(['Rock', 'Jazz']);
  });

  it('finds nothing in a word it does not know', () => {
    expect(genreNames('zzz')).toEqual([]);
    expect(genreNames('')).toEqual([]);
  });

  it('says which word the directory is asked for', () => {
    expect(genreTerm('Hip-Hop')).toBe('hop');
    expect(genreTerm('Nothing')).toBeNull();
  });

  it('matches any tag of a station', () => {
    expect(isGenre(['news', 'rock'], 'Rock')).toBe(true);
    expect(isGenre(['news'], 'Rock')).toBe(false);
  });
});

describe('the admin\'s rules', () => {
  it('hides a station only when every id it is filed under is hidden', () => {
    const rules = { hidden: new Set(['a']), edits: new Map() };
    expect(underRules(rules, [station({ uuid: 'A' })])).toHaveLength(0);
    expect(underRules(rules, [station({ uuid: 'a', alsoFiledAs: ['b'] })])).toHaveLength(1);
  });

  it('puts the edit on, under any id', () => {
    const rules = { hidden: new Set<string>(), edits: new Map([['b', { name: 'Edited', tags: null, description: null }]]) };
    expect(displayOf(underRules(rules, [station({ uuid: 'a', alsoFiledAs: ['B'] })])[0]!)).toBe('Edited');
  });

  it('asks once an hour, and keeps what it has on a failure', async () => {
    let at = 0;
    const json = vi.fn(async (_path: string, read: (raw: unknown) => unknown) => read({ logos: '7', hidden: ['AB'], edits: { 'CD ': { name: ' Mine ', tags: [' Rock ', 'rock'] }, ef: { name: ' ' } } }));
    const rules = new RadioRules({ json: json as never }, () => at);
    await rules.refresh();
    await rules.refresh();
    expect(json).toHaveBeenCalledTimes(1);
    expect(rules.rules.hidden.has('ab')).toBe(true);
    expect(rules.rules.edits.get('cd')).toEqual({ name: 'Mine', tags: ['rock'], description: null });
    expect(rules.rules.edits.has('ef')).toBe(false);
    expect(rules.logoAddress('x')).toBe('/api/radio/logo/x?v=7');
    expect(rules.retagged('Rock')).toEqual(['cd']);

    at = 3_700_000;
    json.mockRejectedValueOnce(new Error('no'));
    await rules.refresh();
    expect(rules.rules.hidden.has('ab')).toBe(true);
  });
});

describe('narrowing and ordering', () => {
  const list = [
    station({ uuid: 'a', name: 'Alpha', codec: 'MP3', tags: ['jazz'], votes: 5, bitrateKbps: 128 }),
    station({ uuid: 'b', name: 'Bravo', codec: 'AAC+', tags: ['rock', 'commercial'], votes: 9, bitrateKbps: 64 }),
    station({ uuid: 'c', name: 'Charlie', codec: 'OGG, Vorbis', tags: ['rock'], votes: 5, bitrateKbps: 320 }),
  ];

  it('narrows by format, under its other spellings', () => {
    expect(throughSieve({ ...NO_SIEVE, format: 'AAC+' }, [station({ uuid: 'x', codec: 'AACP' })])).toHaveLength(1);
    expect(throughSieve({ ...NO_SIEVE, format: 'OGG' }, list).map((row) => row.uuid)).toEqual(['c']);
    expect(throughSieve({ ...NO_SIEVE, format: 'MP3' }, [station({ uuid: 'x', codec: null })])).toHaveLength(0);
  });

  it('narrows by genre and by advertising', () => {
    expect(throughSieve({ ...NO_SIEVE, genre: 'Rock' }, list).map((row) => row.uuid)).toEqual(['b', 'c']);
    expect(throughSieve({ ...NO_SIEVE, ads: 'with' }, list).map((row) => row.uuid)).toEqual(['b']);
    expect(throughSieve({ ...NO_SIEVE, ads: 'without' }, list).map((row) => row.uuid)).toEqual(['a', 'c']);
  });

  it('says when it is on', () => {
    expect(sieveIsOn(NO_SIEVE)).toBe(false);
    expect(sieveIsOn({ ...NO_SIEVE, ads: 'with' })).toBe(true);
  });

  it('orders by what was asked, and by name after that', () => {
    expect(sorted('listed', list).map((row) => row.uuid)).toEqual(['a', 'b', 'c']);
    expect(sorted('nameDown', list).map((row) => row.uuid)).toEqual(['c', 'b', 'a']);
    expect(sorted('votes', list).map((row) => row.uuid)).toEqual(['b', 'a', 'c']);
    expect(sorted('quality', list).map((row) => row.uuid)).toEqual(['c', 'a', 'b']);
  });

  it('keeps the rules on an empty rule set', () => {
    expect(underRules(NO_RULES, list).map((row) => row.uuid)).toEqual(['a', 'b', 'c']);
  });
});

describe('the country list', () => {
  it('calls a country what a reader calls it', () => {
    expect(shortCountry('The United Kingdom Of Great Britain And Northern Ireland', 'GB')).toBe('United Kingdom');
    expect(shortCountry('The Netherlands', 'NL')).toBe('Netherlands');
    expect(shortCountry('Bosnia And Herzegovina', 'BA')).toBe('Bosnia and Herzegovina');
    expect(shortCountry('', 'XX')).toBe('');
  });

  it('merges one code, keeps the largest, and sorts by name', () => {
    const rows = forPicker([
      { name: 'Germany', code: 'de', stationCount: 10 },
      { name: 'Deutschland', code: 'DE', stationCount: 2 },
      { name: 'Austria', code: 'AT', stationCount: 1 },
    ]);
    expect(rows).toEqual([
      { name: 'Austria', code: 'AT', stationCount: 1 },
      { name: 'Germany', code: 'DE', stationCount: 12 },
    ]);
  });

  it('offers no more than a list can carry', () => {
    const many = Array.from({ length: 120 }, (_, index) => ({ name: `C${index}`, code: `C${index}`, stationCount: index }));
    expect(forPicker(many)).toHaveLength(80);
    expect(forPicker(many).some((row) => row.code === 'C0')).toBe(false);
  });
});

describe('the directory', () => {
  const api = (answer: () => unknown) => ({
    json: vi.fn(async (_path: string, read: (raw: unknown) => unknown) => read(answer())),
    call: vi.fn(async () => new Response()),
  });

  it('asks the API, with the word the directory knows a genre by', async () => {
    const client = api(() => ({ stations: [station({ uuid: 'a' })] }));
    const rows = await new RadioDirectory(client as never).search({ name: ' jazz ', genre: 'Hip-Hop', countryCode: 'NL' });
    expect(rows).toHaveLength(1);
    expect(client.json.mock.calls[0]![0]).toBe('radio/stations?name=jazz&tag=hop&country=NL');
  });

  it('asks plainly for the first list', async () => {
    const client = api(() => ({ stations: [] }));
    await new RadioDirectory(client as never).search({});
    expect(client.json.mock.calls[0]![0]).toBe('radio/stations?');
  });

  it('says so when the directory is down, which is not an empty list', async () => {
    const client = api(() => {
      throw new ApiError(502, 'silent');
    });
    await expect(new RadioDirectory(client as never).search({})).rejects.toBeInstanceOf(DirectoryDown);
    await expect(new RadioDirectory(client as never).countries()).rejects.toBeInstanceOf(DirectoryDown);
  });

  it('does not take a search that was replaced for a directory that is down', async () => {
    const client = api(() => {
      throw new DOMException('Aborted', 'AbortError');
    });
    await expect(new RadioDirectory(client as never).search({})).rejects.toThrow('Aborted');
  });

  it('asks for many stations a hundred at a time', async () => {
    const client = api(() => ({ stations: [station({ uuid: 'a' })] }));
    const rows = await new RadioDirectory(client as never).byUuid(Array.from({ length: 150 }, (_, index) => String(index)));
    expect(client.json).toHaveBeenCalledTimes(2);
    expect(rows).toHaveLength(2);
  });

  it('tells the directory a station was tuned, and a failure costs nothing', async () => {
    const client = api(() => ({}));
    client.call.mockRejectedValueOnce(new Error('offline'));
    new RadioDirectory(client as never).reportPlayed('a b');
    await new Promise((done) => setTimeout(done));
    expect(client.call).toHaveBeenCalledWith('radio/played/a%20b', { method: 'POST' });
  });
});

describe('the saved stations', () => {
  const a = station({ uuid: 'A' });
  const b = station({ uuid: 'b' });
  const empty = emptyLedger();

  it('holds a change, under any case', () => {
    const ledger = changed(empty, a, true, 5);
    expect(holds(ledger, 'a')).toBe(true);
    expect(savedOf(ledger)).toEqual([a]);
    expect(ledger.unsent).toEqual(['a']);
  });

  it('keeps an unsaved station, so an older device cannot bring it back', () => {
    const ledger = changed(changed(empty, a, true, 5), a, false, 6);
    expect(holds(ledger, 'a')).toBe(false);
    expect(ledger.changes.a!.saved).toBe(false);
  });

  it('moves the clock on however close two changes are', () => {
    const ledger = changed(changed(empty, a, true, 5), a, false, 5);
    expect(ledger.changes.a!.changedAt).toBe(6);
  });

  it('lets the newest change stand', () => {
    const mine = changed(empty, a, true, 10);
    const older = taking(mine, [{ uuid: 'a', saved: false, changedAt: 5, updatedAt: 100, station: a }]);
    expect(holds(older, 'a')).toBe(true);
    expect(older.cursor).toBe(100);

    const newer = taking(mine, [{ uuid: 'a', saved: false, changedAt: 15, updatedAt: 101, station: a }]);
    expect(holds(newer, 'a')).toBe(false);
    expect(newer.unsent).toEqual([]);
  });

  it('keeps what changed again while it was being sent', () => {
    const ledger = changed(empty, a, true, 5);
    const out = toSend(ledger, 10);
    const again = changed(ledger, a, false, 6);
    expect(sent(again, out).unsent).toEqual(['a']);
    expect(sent(ledger, out).unsent).toEqual([]);
  });

  it('starts again for another account, and takes on a first one', () => {
    const ledger = changed(empty, a, true, 5);
    expect(savedOf(forAccount(ledger, 'one'))).toEqual([a]);
    expect(forAccount(forAccount(ledger, 'one'), 'two').changes).toEqual({});
  });

  it('sends a change with the fields another device needs, and marks it sent', async () => {
    const call = vi.fn(async () => new Response());
    const written: string[] = [];
    const favorites = new RadioFavorites({ json: vi.fn(), call } as never, { read: () => null, write: (text) => written.push(text) }, () => 9);
    favorites.toggle(b);
    await new Promise((done) => setTimeout(done));
    expect(favorites.has('b')).toBe(true);
    const body = (call.mock.calls[0] as unknown as [string, { body: { stations: { station: { isHls: boolean } }[] } }])[1].body;
    expect(body.stations[0]!.station.isHls).toBe(false);
    expect((JSON.parse(written.at(-1)!) as { unsent: string[] }).unsent).toEqual([]);
  });

  it('keeps a change that could not be sent, and sends it with the next pass', async () => {
    const call = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(new Response());
    const json = vi.fn(async () => []);
    const favorites = new RadioFavorites({ json, call } as never, { read: () => null, write: () => {} }, () => 9);
    favorites.toggle(b);
    await new Promise((done) => setTimeout(done));
    await favorites.sync('user');
    expect(call).toHaveBeenCalledTimes(2);
  });
});

describe('a station filed under a genre by the admin', () => {
  it('lands in its place by listeners', () => {
    const merged = withRetagged([station({ uuid: 'a', clickCount: 10 }), station({ uuid: 'b', clickCount: 5 })], [station({ uuid: 'c', clickCount: 7 })], {});
    expect(merged.map((row) => row.uuid)).toEqual(['a', 'c', 'b']);
  });

  it('is not listed twice, and passes the rest of the question', () => {
    const answer = [station({ uuid: 'a' })];
    expect(withRetagged(answer, [station({ uuid: 'A' })], {})).toHaveLength(1);
    expect(withRetagged(answer, [station({ uuid: 'c', countryCode: 'DE' })], { countryCode: 'NL' })).toHaveLength(1);
    expect(withRetagged(answer, [station({ uuid: 'c', name: 'Jazz' })], { name: 'rock' })).toHaveLength(1);
    expect(withRetagged(answer, [station({ uuid: 'c', name: 'Rock One' })], { name: 'rock' })).toHaveLength(2);
  });
});

describe('counting what was heard', () => {
  const clock = () => {
    let at = 1_000_000;
    return { now: () => at, tick: (seconds: number) => (at += seconds * 1000) };
  };
  const a = station({ uuid: 'a' });
  const b = station({ uuid: 'b' });

  function listen(counter: StationCounter, time: ReturnType<typeof clock>, who: RadioStation, seconds: number) {
    let out = null;
    for (let at = 0; at < seconds; at++) {
      time.tick(1);
      out = counter.read(who, true) ?? out;
    }
    return out;
  }

  it('says nothing about a station barely heard', () => {
    const time = clock();
    const counter = new StationCounter(time.now);
    counter.read(a, true);
    listen(counter, time, a, NOTICED_SECONDS - 5);
    expect(counter.read(b, true)).toBeNull();
  });

  it('hands out what was heard when the station changes', () => {
    const time = clock();
    const counter = new StationCounter(time.now);
    counter.read(a, true);
    listen(counter, time, a, NOTICED_SECONDS + 5);
    const part = counter.read(b, true);
    expect(part?.station).toBe(a);
    expect(part?.newTune).toBe(true);
    expect(part?.seconds).toBeCloseTo(NOTICED_SECONDS + 5);
  });

  it('hands out every five minutes, and only the first part is a tuning', () => {
    const time = clock();
    const counter = new StationCounter(time.now);
    counter.read(a, true);
    const first = listen(counter, time, a, HAND_OUT_SECONDS);
    const second = listen(counter, time, a, HAND_OUT_SECONDS);
    expect(first?.newTune).toBe(true);
    expect(second?.newTune).toBe(false);
  });

  it('does not count a gap, or a pause', () => {
    const time = clock();
    const counter = new StationCounter(time.now);
    counter.read(a, true);
    time.tick(600);
    counter.read(a, true);
    time.tick(1);
    counter.read(a, false);
    expect(counter.handOut()).toBeNull();
  });
});
