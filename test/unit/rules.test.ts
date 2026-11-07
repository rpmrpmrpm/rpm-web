import { describe, expect, it, vi } from 'vitest';

import { readTrack, type CloudTrack } from '../../src/api/wire';
import { EQ_BANDS, EQ_PRESETS, Equalizer, MAX_GAIN_DB } from '../../src/audio/equalizer.js';
import { listenCounts, ListenTally } from '../../src/audio/listen';
import { LoudnessMeter, MEASURE_RATE } from '../../src/import/loudness';
import { groupAlbums, type CloudAlbum } from '../../src/library/albums';
import {
  artistMatches,
  buildArtistWall,
  creditNames,
  creditRows,
  initialOf,
  isVariousArtists,
  searchKey,
  sortArtists,
  splitCredit,
  splitGuests,
  splitWide,
  type ArtistCreditRow,
} from '../../src/library/artists';
import { buildGenreWall, genreOfAlbum, genresOf, matchGenre, shelvesOf } from '../../src/library/genres';
import { addedRow, foldName, homeAlbums, homeRows, listenedRow, playedRow, shuffled, similarAlbums, type HomeAlbum, type Played } from '../../src/library/home';
import { same, squash } from '../../src/library/names';
import { PER_PASS, PlayLog, type PlaysClient, type PlaysRow, type SavedPlays } from '../../src/library/plays';
import { RECORD_CEILING, searchRecords, searchSongs, SONG_CEILING } from '../../src/library/search';

const row = (album: string, albumArtist: string | null, artist: string | null, tracks = 1): ArtistCreditRow => ({ album, albumArtist, artist, tracks });
const find = (wall: ReturnType<typeof buildArtistWall>, name: string) => {
  const hits = wall.filter((item) => item.name.toLowerCase() === name.toLowerCase());
  expect(hits).toHaveLength(1);
  return hits[0]!;
};

describe('names', () => {
  it('squashes case, punctuation and the word and', () => {
    expect(squash('Simon & Garfunkel')).toBe(squash('simon and garfunkel'));
    expect(same('AC/DC', 'ac dc')).toBe(true);
    expect(same('', '')).toBe(false);
  });
});

describe('credits', () => {
  it('splits on the separators, and keeps the names once', () => {
    expect(splitCredit('Queen & David Bowie')).toEqual(['Queen', 'David Bowie']);
    expect(splitCredit('Aye feat. Bee')).toEqual(['Aye', 'Bee']);
    expect(splitCredit('Aye (feat. Bee)')).toEqual(['Aye', 'Bee']);
    expect(splitCredit('Abba, ABBA, Bob')).toEqual(['Abba', 'Bob']);
  });

  it('reads with and and only in the wide reading', () => {
    expect(splitCredit('Tom with Jerry')).toEqual(['Tom with Jerry']);
    expect(splitWide('Tom with Jerry')).toEqual(['Tom', 'Jerry']);
  });

  it('keeps the guests of a feat in their own group', () => {
    expect(splitGuests('Aye & Bee feat. Cee')).toEqual([['Aye', 'Bee'], ['Cee']]);
  });

  it('knows the compilation marker however it is spelled', () => {
    expect(isVariousArtists('Various')).toBe(true);
    expect(isVariousArtists('VARIOUS ARTISTS')).toBe(true);
    expect(isVariousArtists('Various Artist')).toBe(true);
    expect(isVariousArtists('ABBA')).toBe(false);
  });
});

describe('the artist wall', () => {
  it('an ordinary album is one artist with one record, counted once', () => {
    const wall = buildArtistWall([row('ABBA/Arrival', 'ABBA', 'ABBA', 10)]);
    expect(wall).toHaveLength(1);
    expect(wall[0]).toMatchObject({ name: 'ABBA', albums: ['ABBA/Arrival'], together: [], appearances: [], tracks: 10 });
  });

  it('a guest with no records of their own gets no box', () => {
    const wall = buildArtistWall([row('CH/18', 'Calvin Harris', 'Calvin Harris', 12), row('CH/18', 'Calvin Harris', 'Calvin Harris feat. Ellie Goulding')]);
    expect(wall.map((item) => item.name)).toEqual(['Calvin Harris']);
  });

  it('a guest who also has a record gets both', () => {
    const wall = buildArtistWall([
      row('CH/18', 'Calvin Harris', 'Calvin Harris', 12),
      row('CH/18', 'Calvin Harris', 'Calvin Harris feat. Ellie Goulding'),
      row('EG/Halcyon', 'Ellie Goulding', 'Ellie Goulding', 13),
    ]);
    const goulding = find(wall, 'Ellie Goulding');
    expect(goulding).toMatchObject({ albums: ['EG/Halcyon'], appearances: ['CH/18'], tracks: 14 });
  });

  it('the same artist credited two ways is one box', () => {
    const wall = buildArtistWall([
      row('EG/Halcyon', 'Ellie Goulding', 'Ellie Goulding', 13),
      row('V/Party', 'Various Artists', 'Ellie Goulding'),
      row('V/Party', 'Various Artists', 'Calvin Harris ft. Ellie Goulding'),
    ]);
    expect(find(wall, 'Ellie Goulding')).toMatchObject({ tracks: 15, appearances: ['V/Party'] });
  });

  it.each(['Earth, Wind & Fire', 'AC/DC', 'Simon & Garfunkel'])('%s is never split', (band) => {
    const wall = buildArtistWall([row('Band/Record', band, band, 9)]);
    expect(wall.map((item) => item.name)).toEqual([band]);
  });

  it('a filed credit whose every part is known is two acts working together', () => {
    const wall = buildArtistWall([
      row('Kanye/One', 'Kanye West', 'Kanye West'),
      row('Ty/One', 'Ty Dolla $ign', 'Ty Dolla $ign'),
      row('Both/Vultures', 'Kanye West & Ty Dolla $ign', 'Kanye West & Ty Dolla $ign'),
    ]);
    expect(wall.some((item) => item.name.includes('&'))).toBe(false);
    expect(find(wall, 'Kanye West').together).toEqual(['Both/Vultures']);
  });

  it('a band with one known member stays a band', () => {
    const wall = buildArtistWall([row('Cave/Solo', 'Nick Cave', 'Nick Cave'), row('Cave/Band', 'Nick Cave & The Bad Seeds', 'Nick Cave & The Bad Seeds')]);
    expect(wall.map((item) => item.name).sort()).toEqual(['Nick Cave', 'Nick Cave & The Bad Seeds']);
  });

  it('rejoins a filed name that a credit cut in two', () => {
    const wall = buildArtistWall([row('T/One', 'Tyler, The Creator', 'Tyler, The Creator'), row('A/One', 'A$AP Rocky', 'A$AP Rocky; Tyler, The Creator; Jozzy')]);
    expect(find(wall, 'Tyler, The Creator').appearances).toEqual(['A/One']);
  });

  it('gathers every spelling of the compilation marker under one box', () => {
    const wall = buildArtistWall([row('V/One', 'Various', 'X'), row('V/Two', 'Various Artists', 'Y')]);
    expect(find(wall, 'Various Artists').albums).toEqual(['V/One', 'V/Two']);
  });

  it('shows the spelling on the most rows', () => {
    const wall = buildArtistWall([row('A/1', 'Beyonce', 'Beyonce'), row('A/2', 'Beyoncé', 'Beyoncé'), row('A/3', 'Beyoncé', 'Beyoncé')]);
    expect(wall.length).toBeGreaterThan(0);
  });

  it('counts a record with nobody on its tracks under whoever it is filed under', () => {
    const albums = [{ key: 'k', album: 'A', artist: 'Band', tracks: [readTrack({ rpmId: '1' })], addedAt: 0, year: 0 }] as CloudAlbum[];
    expect(creditRows(albums)).toEqual([{ album: 'k', albumArtist: 'Band', artist: null, tracks: 1 }]);
  });

  it('picks a song of an act out of a credit, for a shared name too', () => {
    expect(creditNames('A with Nick Cave', 'Nick Cave')).toBe(true);
    expect(creditNames('Nick Cave & The Bad Seeds', 'Nick Cave & The Bad Seeds')).toBe(true);
    expect(creditNames('Someone', 'Nick Cave')).toBe(false);
  });

  it('files a name under its letter, with accents off', () => {
    expect(initialOf('Sigur Rós')).toBe('S');
    expect(initialOf('Ólafur Arnalds')).toBe('O');
    expect(initialOf('2Pac')).toBe('#');
    expect(initialOf('"Weird Al"')).toBe('W');
    expect(initialOf('')).toBe('#');
    expect(initialOf('坂本龍一')).toBe('#');
  });

  it('searches a folded reading of both sides', () => {
    expect(artistMatches('Sigur Rós', 'sigur ros')).toBe(true);
    expect(artistMatches('AC/DC', 'acdc')).toBe(true);
    expect(artistMatches("Guns N' Roses", 'guns n roses')).toBe(true);
    expect(artistMatches('ABBA', '-')).toBe(true);
    expect(searchKey('Björk')).toBe('bjork');
  });

  it('puts the hash bucket last, in every order', () => {
    const wall = buildArtistWall([row('1/a', '2Pac', '2Pac'), row('a/b', 'Abba', 'Abba')]);
    expect(wall.map((item) => item.name)).toEqual(['Abba', '2Pac']);
  });

  it('orders by albums and by tracks, then by name', () => {
    const wall = buildArtistWall([row('b/1', 'Bee', 'Bee', 5), row('b/2', 'Bee', 'Bee', 5), row('a/1', 'Aye', 'Aye', 20)]);
    expect(sortArtists(wall, 'Albums', new Map()).map((item) => item.name)).toEqual(['Bee', 'Aye']);
    expect(sortArtists(wall, 'Tracks', new Map()).map((item) => item.name)).toEqual(['Aye', 'Bee']);
  });
});

const track = (id: string, fields: Record<string, unknown> = {}, tags: Record<string, unknown> = {}): CloudTrack =>
  readTrack({ rpmId: id, relativePath: `${fields.artist ?? 'A'}/${fields.album ?? 'B'}/${id}.flac`, title: id, artist: 'A', album: 'B', tags, ...fields });

describe('genres', () => {
  // The source's own cases.
  it.each([["Rock", "Rock"], ["rock", "Rock"], ["Hip Hop", "Hip-Hop / Rap"], ["hip-hop", "Hip-Hop / Rap"], ["Rap", "Rap"], ["R&B", "R&B"], ["RnB", "R&B"], ["Funk / Soul", "Funk"], ["Soul", "Soul"], ["Electronic", "Electronic / Dance"], ["House", "House"], ["Deep House", "House"], ["Techno", "Techno"], ["Indie Rock", "Indie"], ["Game", "Video Game"], ["Neo-Soul", "Soul"], ["neo soul", "Soul"], ["singer-songwriter, lo-fi, folk, bedroom pop, indie pop, indie rock", "Indie"], ["singer-songwriter, pop, pop rock, baroque pop, soft rock, rock", "Pop"], ["Stage & Screen", "Soundtrack"], ["Folk, World, & Country", "Folk"], ["Gospel", "Religious"], ["Religious", "Religious"], ["Score", "Soundtrack"], ["International", "World"], ["Video Game Soundtrack", "Video Game"], ["Video Game", "Video Game"], ["R&B / Soul", "R&B"], ["World / International", "World"], ["Gospel / Religious", "Religious"], ["Soundtrack / Score", "Soundtrack"], ["Post-Punk", "Punk"], ["Hard Rock", "Rock"], ["Synth-pop", "Pop"], ["Death Metal", "Metal"], ["Contemporary Jazz", "Jazz"], ["electro house", "House"], ["trap latino", "Latin"], ["pop rap", "Rap"], ["jazz rap", "Rap"], ["ambient techno", "Techno"], ["electro-disco", "Disco"], ["pop metal", "Metal"], ["reggaeton", "Latin"], ["Funk / Soul", "Funk"], ["Folk, World, & Country", "Folk"], ["Rock | Pop | Folk Rock | Art Rock", "Rock"], ["Progressive House, Trance, Speed Garage", "House"], ["cloud rap, hip hop, trap", "Rap"], ["Punk Rock", "Punk"], ["Lovers Rock", "Reggae"], ["Christian Rock", "Religious"], ["Gospel Soul", "Religious"], ["Gospel Blues", "Religious"], ["Latin Rock", "Latin"], ["Latin Pop", "Latin"], ["Country Pop", "Country"], ["Folk Pop", "Folk"], ["Jazz Pop", "Jazz"], ["Dream Pop", "Indie"], ["Bedroom Pop", "Indie"], ["Jangle Pop", "Indie"], ["Chamber Pop", "Indie"], ["Post-Punk Revival", "Indie"], ["Power Pop", "Rock"], ["Dance-Pop", "Pop"], ["Trap Soul", "R&B"], ["G-Funk", "Hip-Hop / Rap"], ["Witch House", "Electronic / Dance"], ["Future Funk", "Electronic / Dance"], ["Ambient Classical", "Neo-Classical"], ["Video Game Score", "Video Game"], ["Desert Blues", "World"], ["Ethio-Jazz", "World"], ["Progressive Punk Rock", "Punk"], ["Experimental Hip Hop", "Hip-Hop / Rap"], ["Experimental Rock", "Rock"], ["Cloud Rap", "Rap"]])('%s is %s', (tag, genre) => {
    expect(matchGenre(tag)).toBe(genre);
  });

  it('answers nothing for a tag it cannot read', () => {
    expect(matchGenre('zzzz qqqq')).toBeNull();
    expect(matchGenre('Unknown')).toBeNull();
    expect(matchGenre('Other')).toBeNull();
    expect(matchGenre('Other / Unknown')).toBeNull();
    expect(matchGenre('')).toBeNull();
    expect(matchGenre(null)).toBeNull();
  });

  it('files a record by the tag most of its tracks carry, and a tie by the first', () => {
    const album = (tags: string[]) => ({ tracks: tags.map((genre, index) => track(String(index), {}, { genre })) }) as CloudAlbum;
    expect(genreOfAlbum(album(['Jazz', 'Rock', 'Rock']))).toBe('Rock');
    expect(genreOfAlbum(album(['Jazz', 'Rock']))).toBe('Jazz');
    expect(genreOfAlbum(album([]))).toBe('Other');
  });

  it('builds the wall in shelf order, with what fits nothing last', () => {
    const albums = groupAlbums([track('1', { album: 'One' }, { genre: 'Jazz' }), track('2', { album: 'Two' }, { genre: 'Rock' }), track('3', { album: 'Three' })]);
    const wall = buildGenreWall(albums);
    expect(wall[wall.length - 1]!.name).toBe('Other');
    expect(wall.map((item) => item.name)).toEqual(expect.arrayContaining(['Rock', 'Jazz']));
  });

  it('reads each genre of a record once', () => {
    expect(genresOf([track('1', {}, { genre: 'Rock' }), track('2', {}, { genre: 'rock' }), track('3', {}, { genre: 'Jazz' })])).toEqual(['Rock', 'Jazz']);
  });

  it('gives a page its decades, and the acts counted for this genre only', () => {
    const albums = groupAlbums([track('1', { album: 'One', artist: 'Aye' }, { genre: 'Jazz', year: 1975 }), track('2', { album: 'Two', artist: 'Bee' }, { genre: 'Jazz', year: 1994 })]);
    const wall = buildGenreWall(albums);
    const artists = buildArtistWall(creditRows(albums));
    const page = shelvesOf(wall[0]!, new Map(albums.map((album) => [album.key, album])), artists);
    expect(page.eras.map((era) => era.decade)).toEqual([1990, 1970]);
    expect(page.acts).toHaveLength(2);
  });
});

describe('search', () => {
  const albums = groupAlbums([track('Song One', { album: 'First', artist: 'Aye' }), track('Other', { album: 'Second', artist: 'Bee' })]);

  it('finds a song by any of its four fields', () => {
    expect(searchSongs(albums, 'song one').map((hit) => hit.track.title)).toEqual(['Song One']);
    expect(searchSongs(albums, 'SECOND').map((hit) => hit.track.title)).toEqual(['Other']);
    expect(searchSongs(albums, '  ')).toEqual([]);
  });

  it('stops at the ceilings', () => {
    const many = groupAlbums(Array.from({ length: SONG_CEILING + 40 }, (_, index) => track(`s${index}`, { album: `Same ${index}`, artist: 'Same' })));
    expect(searchSongs(many, 'same')).toHaveLength(SONG_CEILING);
    expect(searchRecords(many, 'same')).toHaveLength(RECORD_CEILING);
  });
});

const album = (key: string, fields: Partial<HomeAlbum> = {}): HomeAlbum => ({ key, album: key, artist: key, genres: [], year: 0, addedAt: 0, plays: 0, lastPlayedAt: 0, ...fields });

describe('Home', () => {
  it('sums plays over a record, and takes the latest time', () => {
    const albums = groupAlbums([track('1', { album: 'One' }), track('2', { album: 'One' })]);
    const played = new Map<string, Played>([['1', { plays: 2, lastPlayedAt: 5 }], ['2', { plays: 3, lastPlayedAt: 9 }]]);
    expect(homeAlbums(albums, played)[0]).toMatchObject({ plays: 5, lastPlayedAt: 9 });
  });

  it('orders the rows, and breaks a tie by key', () => {
    const shelf = [album('b', { lastPlayedAt: 5, plays: 2, addedAt: 1 }), album('a', { lastPlayedAt: 5, plays: 2, addedAt: 1 }), album('c', { lastPlayedAt: 9, plays: 1, addedAt: 3 })];
    expect(listenedRow(shelf, 5)).toEqual(['c', 'a', 'b']);
    expect(playedRow(shelf, 5)).toEqual(['a', 'b', 'c']);
    expect(addedRow(shelf, 5)).toEqual(['c', 'a', 'b']);
  });

  it('leaves out what has not been played', () => {
    expect(listenedRow([album('a')], 5)).toEqual([]);
    expect(playedRow([album('a')], 5)).toEqual([]);
  });

  it('starts a new account with recently added', () => {
    expect(homeRows([album('a', { addedAt: 1 })], 1).map((row) => row.kind)).toEqual(['added']);
  });

  it('shows nothing on an empty shelf', () => {
    expect(homeRows([], 1)).toEqual([]);
  });

  it('suggests other acts, and does not offer what is on the row above', () => {
    const shelf = [album('a', { genres: ['Rock'], lastPlayedAt: 5, plays: 1 }), album('b', { genres: ['Rock'] }), album('c', { genres: ['Jazz'] })];
    const rows = homeRows(shelf, 3);
    const suggested = rows.find((row) => row.kind === 'suggested')!;
    expect(suggested.keys).not.toContain('a');
    expect(suggested.keys[0]).toBe('b');
  });

  it('keeps to one record of an act until the other acts have had a turn', () => {
    const subject = album('s', { artist: 'S', genres: ['Rock'] });
    const shelf = [subject, album('a1', { artist: 'A', genres: ['Rock'] }), album('a2', { artist: 'A', genres: ['Rock'] }), album('b1', { artist: 'B', genres: ['Rock'] })];
    expect(similarAlbums(subject, shelf, 2).sort()).toEqual(['a1', 'b1']);
  });

  it('does not end up in a loop on a shelf too small to fill the row', () => {
    expect(homeRows([album('a', { lastPlayedAt: 1, plays: 1 })], 1).length).toBeGreaterThan(0);
  });

  it('shuffles the same way for one draw, and another way for another', () => {
    const keys = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    expect(shuffled(keys, 7, 'x')).toEqual(shuffled(keys, 7, 'x'));
    expect(shuffled(keys, 7, 'x')).not.toEqual(shuffled(keys, 8, 'x'));
    expect([...shuffled(keys, 7, 'x')].sort()).toEqual(keys);
  });

  it('folds a name the way the ranking does', () => {
    expect(foldName('The Beatles')).toBe('beatles');
    expect(foldName('Sigur  Rós!')).toBe('sigur ros');
    expect(foldName('')).toBe('');
  });
});

describe('what counts as a listen', () => {
  it('asks for half the track, or four minutes of a long one', () => {
    expect(listenCounts(100, 200)).toBe(true);
    expect(listenCounts(99, 200)).toBe(false);
    expect(listenCounts(240, 3600)).toBe(true);
    expect(listenCounts(239, 3600)).toBe(false);
  });

  it('does not count a track under thirty seconds', () => {
    expect(listenCounts(29, 29)).toBe(false);
  });

  it('follows a track to the next one', () => {
    const tally = new ListenTally();
    expect(tally.read('a', 1, 0, 100, 200)).toBeNull();
    expect(tally.read('b', 2, 0, 0, 180)).toEqual({ track: 'a', heardSeconds: 100, lengthSeconds: 200 });
  });

  it('carries a listen across a seek', () => {
    const tally = new ListenTally();
    tally.read('a', 1, 0, 40, 200);
    tally.read('a', 2, 150, 30, 200);
    expect(tally.settle()).toEqual({ track: 'a', heardSeconds: 70, lengthSeconds: 200 });
  });

  it('begins again when the same track is restarted', () => {
    const tally = new ListenTally();
    tally.read('a', 1, 0, 100, 200);
    expect(tally.read('a', 2, 0, 1, 200)).toEqual({ track: 'a', heardSeconds: 100, lengthSeconds: 200 });
  });

  it('never lowers what a stretch has earned', () => {
    const tally = new ListenTally();
    tally.read('a', 1, 0, 50, 200);
    tally.read('a', 1, 0, 10, 200);
    expect(tally.settle()?.heardSeconds).toBe(50);
  });
});

describe('the play log', () => {
  function log() {
    const saved = new Map<string, SavedPlays>();
    return { saved, log: new PlayLog({ read: async (user) => saved.get(user) ?? null, write: async (user, value) => void saved.set(user, structuredClone(value)) }) };
  }

  const client = (rows: PlaysRow[] = []): PlaysClient & { sent: { deviceId: string; rows: unknown[] }[] } => {
    const sent: { deviceId: string; rows: unknown[] }[] = [];
    return { sent, trackPlays: async () => rows, sendTrackPlays: async (deviceId, entries) => void sent.push({ deviceId, rows: entries }) };
  };

  const foreign = (fields: Partial<PlaysRow>): PlaysRow => ({ rpmId: 't', deviceId: 'phone', plays: 3, lastPlayedAt: 10, updatedAt: 100, ...fields });

  it('saves a play at once', async () => {
    const { log: plays, saved } = log();
    await plays.open('u');
    plays.note('t', 5);
    await Promise.resolve();
    expect(saved.get('u')?.own.t?.plays).toBe(1);
  });

  it('adds the devices together on the way out, and keeps them apart inside', async () => {
    const { log: plays } = log();
    await plays.open('u');
    plays.note('t', 5);
    await plays.sync(client([foreign({ deviceId: 'phone', plays: 3 }), foreign({ deviceId: 'tv', plays: 2, lastPlayedAt: 20 })]), 'web');
    expect(plays.everythingPlayed().get('t')).toEqual({ plays: 6, lastPlayedAt: 20 });
  });

  it('sends totals, and not again once they arrived', async () => {
    const { log: plays } = log();
    await plays.open('u');
    plays.note('t', 5);
    plays.note('t', 6);
    const asked = client();
    await plays.sync(asked, 'web');
    await plays.sync(asked, 'web');
    expect(asked.sent).toEqual([{ deviceId: 'web', rows: [{ rpmId: 't', plays: 2, lastPlayedAt: 6 }] }]);
  });

  it('does not count its own rows twice, and moves the cursor for them all the same', async () => {
    const { log: plays, saved } = log();
    await plays.open('u');
    plays.note('t', 5);
    await plays.sync(client([foreign({ deviceId: 'web', plays: 1, updatedAt: 500 })]), 'web');
    expect(plays.everythingPlayed().get('t')?.plays).toBe(1);
    await Promise.resolve();
    expect(saved.get('u')?.cursor).toBe(500);
  });

  it('takes a row that went backwards as it stands', async () => {
    const { log: plays } = log();
    await plays.open('u');
    await plays.sync(client([foreign({ plays: 9 })]), 'web');
    await plays.sync(client([foreign({ plays: 2 })]), 'web');
    expect(plays.everythingPlayed().get('t')?.plays).toBe(2);
  });

  it('keeps what was not sent, and sends it next time', async () => {
    const { log: plays } = log();
    await plays.open('u');
    plays.note('t', 5);
    await plays.sync({ trackPlays: async () => [], sendTrackPlays: async () => { throw new Error('down'); } }, 'web');
    const asked = client();
    await plays.sync(asked, 'web');
    expect(asked.sent).toHaveLength(1);
  });

  it('sends nothing when the store could not be read', async () => {
    const { log: plays } = log();
    await plays.open('u');
    plays.note('t', 5);
    const send = vi.fn();
    await plays.sync({ trackPlays: async () => { throw new Error('down'); }, sendTrackPlays: send }, 'web');
    expect(send).not.toHaveBeenCalled();
  });

  it('sends a limited number at a time', async () => {
    const { log: plays } = log();
    await plays.open('u');
    for (let i = 0; i < PER_PASS + 5; i++) plays.note(`t${i}`, 1);
    const asked = client();
    await plays.sync(asked, 'web');
    expect(asked.sent[0]!.rows).toHaveLength(PER_PASS);
  });

  it('a pass that began before a sign-out writes nothing into the next account', async () => {
    const { log: plays, saved } = log();
    await plays.open('u');
    let answer!: (rows: PlaysRow[]) => void;
    const pass = plays.sync({ trackPlays: () => new Promise((done) => (answer = done)), sendTrackPlays: async () => {} }, 'web');
    await plays.open('v');
    answer([foreign({})]);
    await pass;
    expect(plays.everythingPlayed().size).toBe(0);
    expect(saved.get('v')).toBeUndefined();
  });
});

function sine(hertz: number, peak: number, seconds: number) {
  const frames = Math.round(MEASURE_RATE * seconds);
  const samples = new Float32Array(frames * 2);
  for (let frame = 0; frame < frames; frame++) {
    const value = peak * Math.sin((2 * Math.PI * hertz * frame) / MEASURE_RATE);
    samples[frame * 2] = value;
    samples[frame * 2 + 1] = value;
  }
  return { samples, frames };
}

describe('the loudness meter', () => {
  // The reference signal of EBU Tech 3341: a stereo 1 kHz sine at -23 dBFS reads -23 LUFS.
  it('reads the reference signal', () => {
    const { samples, frames } = sine(1000, 10 ** (-23 / 20), 10);
    const meter = new LoudnessMeter(MEASURE_RATE);
    meter.add(samples, frames);
    expect(meter.integratedLufs).toBeCloseTo(-23, 1);
  });

  it('reads the same in blocks as in one go', () => {
    const { samples, frames } = sine(440, 0.1, 5);
    const whole = new LoudnessMeter(MEASURE_RATE);
    whole.add(samples, frames);
    const parts = new LoudnessMeter(MEASURE_RATE);
    for (let at = 0; at < frames; at += 8192) {
      const part = samples.subarray(at * 2, Math.min(frames, at + 8192) * 2);
      parts.add(part, part.length / 2);
    }
    expect(parts.integratedLufs).toBeCloseTo(whole.integratedLufs, 6);
  });

  it('leaves silence out of the average', () => {
    const { samples, frames } = sine(1000, 10 ** (-23 / 20), 5);
    const meter = new LoudnessMeter(MEASURE_RATE);
    meter.add(samples, frames);
    meter.add(new Float32Array(frames * 2), frames);
    expect(Math.abs(meter.integratedLufs + 23)).toBeLessThan(0.2);
  });

  it('reads silence as no reading', () => {
    const meter = new LoudnessMeter(MEASURE_RATE);
    meter.add(new Float32Array(48000 * 2), 48000);
    expect(meter.integratedLufs).toBe(-Infinity);
  });

  it('finds a peak that falls between the samples', () => {
    const { samples, frames } = sine(MEASURE_RATE / 4, 1, 1);
    const shifted = new Float32Array(samples.length);
    for (let frame = 0; frame < frames; frame++) {
      const value = Math.sin((2 * Math.PI * frame) / 4 + Math.PI / 4);
      shifted[frame * 2] = value;
      shifted[frame * 2 + 1] = value;
    }
    const meter = new LoudnessMeter(MEASURE_RATE);
    meter.add(shifted, frames);
    expect(meter.truePeak).toBeGreaterThan(0.95);
  });
});

describe('the equaliser', () => {
  const RATE = 44100;
  const level = (hertz: number, eq: Equalizer) => {
    const samples = new Float32Array(RATE * 2);
    for (let frame = 0; frame < RATE; frame++) {
      const value = 0.05 * Math.sin((2 * Math.PI * hertz * frame) / RATE);
      samples[frame * 2] = value;
      samples[frame * 2 + 1] = value;
    }
    eq.process(samples);
    let peak = 0;
    for (let i = RATE; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]!));
    return 20 * Math.log10(peak / 0.05);
  };

  it('does nothing when flat', () => {
    const eq = new Equalizer(RATE);
    expect(eq.bypass).toBe(true);
    const samples = Float32Array.of(0.5, -0.5);
    eq.process(samples);
    expect([...samples]).toEqual([0.5, -0.5]);
  });

  it('lifts a band by what was asked, at its centre', () => {
    const eq = new Equalizer(RATE);
    const bands = EQ_BANDS.map(() => 0);
    bands[4] = 6;
    eq.setGains(0, bands);
    expect(level(1000, eq)).toBeCloseTo(6, 0);
  });

  it('leaves a far band alone', () => {
    const eq = new Equalizer(RATE);
    const bands = EQ_BANDS.map(() => 0);
    bands[0] = 6;
    eq.setGains(0, bands);
    expect(Math.abs(level(14000, eq))).toBeLessThan(0.5);
  });

  it('applies the pre-amp', () => {
    const eq = new Equalizer(RATE);
    eq.setGains(-6, EQ_BANDS.map(() => 0));
    expect(level(1000, eq)).toBeCloseTo(-6, 0);
  });

  it('holds a gain to the limit', () => {
    const eq = new Equalizer(RATE);
    const bands = EQ_BANDS.map(() => 0);
    bands[4] = 100;
    eq.setGains(0, bands);
    expect(level(1000, eq)).toBeCloseTo(MAX_GAIN_DB, 0);
  });

  it('never goes past full scale', () => {
    const eq = new Equalizer(RATE);
    eq.setGains(12, EQ_BANDS.map(() => 12));
    const samples = Float32Array.of(1, 1, 1, 1);
    eq.process(samples);
    expect(Math.max(...samples)).toBeLessThanOrEqual(1);
  });

  it('has ten values in every preset', () => {
    for (const [, bands] of EQ_PRESETS) expect(bands).toHaveLength(EQ_BANDS.length);
  });
});
