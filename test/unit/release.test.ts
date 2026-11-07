import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../src/api/http';
import { CoverSearch } from '../../src/import/cover-search';
import { discOfFolder, ImportQueue } from '../../src/import/queue';
import {
  canSearch,
  discogsDisc,
  discogsDuration,
  discogsName,
  fitOf,
  foldRpmSearch,
  matchTracks,
  measureMatch,
  orderResults,
  readDiscogsRelease,
  readDiscogsSearch,
  readRpmRelease,
  ReleaseLookup,
  splitDiscogsTitle,
  type ReleaseDetail,
  type ReleaseQuery,
  type ReleaseResult,
  type ReleaseTrack,
  type TrackPlace,
} from '../../src/import/release';
import { renderTemplate, TAG_PRESETS } from '../../src/import/tag-template';

const place = (disc: number, track: number, title: string | null = null): TrackPlace => ({ disc, track, title });
const listed = (position: number, disc = 0, discPosition = 0, title = `Track ${position}`): ReleaseTrack => ({ position, title, artist: null, lengthSeconds: 200, disc, discPosition });
const query: ReleaseQuery = { album: 'Clandestino', artist: 'Manu Chao', media: 'any', catalogNumber: '', barcode: '', country: '', year: 0 };

describe('the rpm database', () => {
  it('folds the media of a release into one row', () => {
    const [row] = foldRpmSearch([
      { releaseId: 'a', title: 'Box', format: 'CD', trackCount: 10, score: 80 },
      { releaseId: 'a', title: 'Box', format: 'DVD', trackCount: 4, score: 80 },
    ]);
    expect(row).toMatchObject({ id: 'a', format: 'CD + DVD', trackCount: 14, relevance: 0.8 });
  });

  it('keeps disc and number from the media, and the flat position across them', () => {
    const detail = readRpmRelease({
      id: 'a',
      title: 'Double',
      artist: 'Band',
      media: [
        { position: 1, title: 'One', tracks: [{ title: 'A' }, { title: 'B' }] },
        { position: 2, title: 'Two', tracks: [{ title: 'C', artist: 'Guest' }] },
      ],
    });
    expect(detail.tracks.map((track) => [track.position, track.disc, track.discPosition, track.artist, track.discSubtitle])).toEqual([
      [1, 1, 1, 'Band', 'One'],
      [2, 1, 2, 'Band', 'One'],
      [3, 2, 1, 'Guest', 'Two'],
    ]);
    expect(detail.discCount).toBe(2);
  });

  it('gives a one-disc release no disc number', () => {
    const detail = readRpmRelease({ id: 'a', title: 'One', media: [{ position: 1, tracks: [{ title: 'A' }] }] });
    expect(detail.tracks[0]!.disc).toBe(0);
    expect(detail.discCount).toBe(1);
  });
});

describe('Discogs', () => {
  it('reads an artist out of a title', () => {
    expect(splitDiscogsTitle('Nirvana (2) - Nevermind')).toEqual({ artist: 'Nirvana', title: 'Nevermind' });
    expect(splitDiscogsTitle('Nevermind')).toEqual({ artist: null, title: 'Nevermind' });
    expect(discogsName('Prince*')).toBe('Prince');
  });

  it('takes pressings and leaves masters, and orders by position', () => {
    const found = readDiscogsSearch(
      {
        results: [
          { type: 'master', id: 1, title: 'A - Master' },
          { type: 'release', id: 2, title: 'A - First', year: '1998', format: ['CD', 'Album'], label: ['Virgin', 'EMI'], thumb: 'https://i.discogs.com/t.jpg' },
          { type: 'release', id: 3, title: 'A - Second' },
          { type: 'release', title: 'no id' },
        ],
      },
      25,
    );
    expect(found.map((row) => row.id)).toEqual(['2', '3']);
    expect(found[0]).toMatchObject({ year: 1998, format: 'CD, Album', label: 'Virgin', coverUrl: 'https://i.discogs.com/t.jpg' });
    expect(found[0]!.relevance).toBeGreaterThan(found[1]!.relevance);
  });

  it.each([
    ['1-1', 1],
    ['2-3', 2],
    ['CD2-05', 2],
    ['2.4', 2],
    ['1', 0],
    ['A1', 0],
    ['', 0],
    [null, 0],
  ])('position %s is disc %i', (position, disc) => {
    expect(discogsDisc(position)).toBe(disc);
  });

  it('reads a length', () => {
    expect(discogsDuration('4:05')).toBe(245);
    expect(discogsDuration('1:02:03')).toBe(3723);
    expect(discogsDuration('')).toBeNull();
    expect(discogsDuration('soon')).toBeNull();
  });

  it('credits the release artist where a track has none, and the track where it does', () => {
    const detail = readDiscogsRelease(
      {
        title: 'Album',
        artists: [{ name: 'Band (3)' }],
        tracklist: [
          { position: '1', title: 'Own', duration: '3:00', type_: 'track' },
          { position: '2', title: 'Guest', type_: 'track', artists: [{ name: 'Other' }] },
        ],
      },
      '9',
    );
    expect(detail.tracks.map((track) => track.artist)).toEqual(['Band', 'Other']);
    expect(detail.tracks[0]!.lengthSeconds).toBe(180);
  });

  it('reads the movements one level down, and passes over headings', () => {
    const detail = readDiscogsRelease(
      {
        title: 'Mozart',
        tracklist: [
          { type_: 'heading', title: 'Sonatas' },
          {
            type_: 'index',
            title: 'Sonata In B-Flat',
            sub_tracks: [
              { position: '1-1', title: 'Allegro', type_: 'track' },
              { position: '1-2', title: 'Andante', type_: 'track' },
            ],
          },
          { position: '2-1', title: 'Rondo', type_: 'track' },
        ],
      },
      '9',
    );
    expect(detail.tracks.map((track) => track.title)).toEqual(['Sonata In B-Flat: Allegro', 'Sonata In B-Flat: Andante', 'Rondo']);
    expect(detail.tracks[1]).toMatchObject({ work: 'Sonata In B-Flat', movementName: 'Andante', movementNumber: 2, movementCount: 2, disc: 1, discPosition: 2 });
    expect(detail.tracks[0]!.discSubtitle).toBe('Sonatas');
    expect(detail.discCount).toBe(2);
  });

  it('gives a single disc no number, however its positions are written', () => {
    const detail = readDiscogsRelease({ title: 'One', tracklist: [{ position: '1-1', title: 'A' }, { position: '1-2', title: 'B' }] }, '9');
    expect(detail.tracks.map((track) => track.disc)).toEqual([0, 0]);
    expect(detail.discCount).toBe(1);
  });

  it('finds the label, the barcode and the primary picture', () => {
    const detail = readDiscogsRelease(
      {
        title: 'One',
        labels: [{ name: 'Virgin (2)', catno: 'V 123' }],
        identifiers: [{ type: 'Matrix', value: 'x' }, { type: 'Barcode', value: '0724' }],
        images: [{ type: 'secondary', uri: 'https://i.discogs.com/back.jpg' }, { type: 'primary', uri: 'https://i.discogs.com/front.jpg' }],
      },
      '9',
    );
    expect(detail).toMatchObject({ label: 'Virgin', catalogNumber: 'V 123', barcode: '0724', coverUrl: 'https://i.discogs.com/front.jpg' });
  });
});

describe('the order of the results', () => {
  const result = (id: string, fields: Partial<ReleaseResult>): ReleaseResult => ({
    provider: 'rpm', id, title: '', artist: null, year: 0, country: null, format: null, trackCount: 0, label: null, catalogNumber: null, relevance: 0, coverUrl: null, ...fields,
  });

  it('puts the medium asked for first, then relevance, a listing, and the earliest pressing', () => {
    const ordered = orderResults(
      [
        result('cd', { format: 'CD', relevance: 1 }),
        result('reissue', { format: 'Vinyl', relevance: 0.5, trackCount: 10, year: 2015 }),
        result('first', { format: 'Vinyl, LP', relevance: 0.5, trackCount: 10, year: 1973 }),
        result('bare', { format: 'Vinyl', relevance: 0.5 }),
      ],
      { media: 'vinyl' },
    );
    expect(ordered.map((row) => row.id)).toEqual(['first', 'reissue', 'bare', 'cd']);
  });

  it('puts an undated release after a dated one', () => {
    const ordered = orderResults([result('undated', { trackCount: 1 }), result('dated', { trackCount: 1, year: 1990 })], { media: 'any' });
    expect(ordered[0]!.id).toBe('dated');
  });
});

describe('how a listing fits the files', () => {
  it('scores lengths that agree at the top', () => {
    expect(measureMatch([200, 180, 240], [200, 180, 240])).toBe(1);
  });

  it('forgives a deck running steadily fast', () => {
    expect(measureMatch([200, 100], [202, 101])).toBeCloseTo(1, 5);
  });

  it('marks lengths that disagree down, but above a different count', () => {
    const wrong = measureMatch([200, 180], [300, 80]);
    expect(wrong).toBeGreaterThanOrEqual(0.5);
    expect(wrong).toBeLessThan(0.75);
  });

  it('caps a different count under the good match line', () => {
    expect(measureMatch([200, 200, 200], [300, 300])).toBeLessThanOrEqual(0.55);
    expect(measureMatch([200, 200, 200, 200, 200], [500, 500])).toBeCloseTo(0.35);
  });

  it('goes by the count alone when the listing has no times', () => {
    expect(measureMatch([null, null], [200, 180])).toBe(0.6);
  });

  it('says nothing about nothing', () => {
    expect(measureMatch([], [200])).toBe(0);
    expect(measureMatch([200], [])).toBe(0);
  });

  it('finds one disc of a double album', () => {
    const detail = {
      discCount: 2,
      tracks: [
        { ...listed(1, 1, 1), lengthSeconds: 100 },
        { ...listed(2, 1, 2), lengthSeconds: 200 },
        { ...listed(3, 2, 1), lengthSeconds: 300 },
        { ...listed(4, 2, 2), lengthSeconds: 400 },
      ],
    } as ReleaseDetail;
    expect(fitOf(detail, [300, 400])).toBe(1);
  });
});

describe('which row each file is', () => {
  it('goes by number when the files have them', () => {
    const { matched } = matchTracks([place(0, 2), place(0, 1)], [listed(1), listed(2)]);
    expect(matched.map((track) => track?.position)).toEqual([2, 1]);
  });

  it('uses the number on the sleeve, not the running position', () => {
    const listing = [listed(1, 1, 1), listed(2, 2, 1)];
    expect(matchTracks([place(2, 1)], listing).matched[0]?.position).toBe(2);
  });

  it('lets a title choose where the number is on two rows', () => {
    const listing = [listed(1, 1, 1, 'Same number'), listed(2, 2, 1, 'Right one')];
    expect(matchTracks([place(0, 1, 'right one')], listing).matched[0]?.position).toBe(2);
    expect(matchTracks([place(0, 1, 'neither')], listing).matched[0]).toBeNull();
  });

  it('goes by order when no file has a number', () => {
    const { matched } = matchTracks([place(0, 0), place(0, 0)], [listed(1), listed(2), listed(3)]);
    expect(matched.map((track) => track?.position)).toEqual([1, 2]);
  });

  it('does not guess which folder is which half when the listing names no discs', () => {
    const { matched } = matchTracks([place(1, 0), place(2, 0)], [listed(1), listed(2)]);
    expect(matched).toEqual([null, null]);
  });

  it('reads twenty-four files tagged disc 1 as the running order of a double album', () => {
    const listing = Array.from({ length: 24 }, (_, index) => listed(index + 1, index < 12 ? 1 : 2, (index % 12) + 1));
    const { matched, discNumbersIgnored } = matchTracks(Array.from({ length: 24 }, () => place(1, 0)), listing);
    expect(discNumbersIgnored).toBe(true);
    expect(matched.map((track) => track?.position)).toEqual(listing.map((track) => track.position));
  });

  it('keeps the files disc numbers on a partial selection', () => {
    const listing = Array.from({ length: 24 }, (_, index) => listed(index + 1, index < 12 ? 1 : 2, (index % 12) + 1));
    const { matched, discNumbersIgnored } = matchTracks(Array.from({ length: 3 }, () => place(2, 0)), listing);
    expect(discNumbersIgnored).toBe(false);
    expect(matched.map((track) => track?.position)).toEqual([13, 14, 15]);
  });

  it('answers nothing for an empty listing', () => {
    expect(matchTracks([place(0, 1)], []).matched).toEqual([null]);
  });
});

describe('asking the sources', () => {
  const api = (json: (path: string) => unknown) => ({ json: vi.fn(async (path: string, read: (raw: unknown) => unknown) => read(json(path))) as never });

  it('needs something to search on', () => {
    expect(canSearch({ ...query, album: '', artist: '' })).toBe(false);
    expect(canSearch({ ...query, album: '', artist: '', barcode: '0724' })).toBe(true);
  });

  it('widens a search on one medium only when it found none', async () => {
    const asked: string[] = [];
    const lookup = new ReleaseLookup(api((path) => {
      asked.push(path);
      return path.includes('media=vinyl') ? [] : [{ releaseId: 'a', title: 'CD' }];
    }));
    expect(await lookup.searchRpm({ ...query, media: 'vinyl' })).toHaveLength(1);
    expect(asked).toHaveLength(2);
  });

  it('sends the words each source names them by', async () => {
    const asked: string[] = [];
    const lookup = new ReleaseLookup(api((path) => {
      asked.push(path);
      return path.startsWith('discogs') ? { results: [] } : [];
    }));
    await lookup.searchRpm({ ...query, catalogNumber: 'SHVL 804' });
    await lookup.searchDiscogs({ ...query, barcode: '0724' });
    expect(asked[0]).toContain('text=Clandestino');
    expect(asked[0]).toContain('catno=SHVL');
    expect(asked[1]).toContain('q=Clandestino');
    expect(asked[1]).toContain('barcode=0724');
  });

  it('reads an unconnected Discogs as null, and any other failure as a failure', async () => {
    const refusing = (status: number) => new ReleaseLookup({ json: async () => { throw new ApiError(status, 'no'); } } as never);
    expect(await refusing(428).searchDiscogs(query)).toBeNull();
    await expect(refusing(500).searchDiscogs(query)).rejects.toThrow();
  });

  it('asks the store for a cover only when the result has none', async () => {
    const lookup = new ReleaseLookup(api(() => ({ url: 'http://coverartarchive.org/a.jpg' })));
    expect(await lookup.coverOf({ provider: 'discogs', id: '1', coverUrl: 'https://i.discogs.com/a.jpg' }, 250)).toBe('https://i.discogs.com/a.jpg');
    expect(await lookup.coverOf({ provider: 'rpm', id: 'a', coverUrl: null }, 250)).toBe('http://coverartarchive.org/a.jpg');
    expect(await lookup.coverOf({ provider: 'discogs', id: '1', coverUrl: null }, 250)).toBeNull();
  });
});

describe('patterns over tags', () => {
  const tags: Record<string, string> = { artist: 'Manu Chao', title: 'Clandestino', album: 'Clandestino', year: '1998', track: '3' };
  const read = (fields: Record<string, string>) => (token: string) => fields[token];

  it.each([
    ['{artist} - {title}', 'Manu Chao - Clandestino'],
    ['{track:00} - {title}', '03 - Clandestino'],
    ['{title} ({artist})', 'Clandestino (Manu Chao)'],
    ['{album} ({year})', 'Clandestino (1998)'],
  ])('%s', (pattern, expected) => {
    expect(renderTemplate(pattern, read(tags))).toBe(expected);
  });

  it('takes the glue away with an empty field, on either side', () => {
    expect(renderTemplate('{artist} - {title}', read({ title: 'Song' }))).toBe('Song');
    expect(renderTemplate('{artist} - {title}', read({ artist: 'Band' }))).toBe('Band');
  });

  it('takes a bracket away with the field inside it', () => {
    expect(renderTemplate('{album} ({year})', read({ album: 'Album' }))).toBe('Album');
    expect(renderTemplate('{title} ({artist})', read({ title: 'Song' }))).toBe('Song');
  });

  it('reads a zero as nothing when it is formatted', () => {
    expect(renderTemplate('{track:00} - {title}', read({ track: '0', title: 'Song' }))).toBe('Song');
  });

  it('leaves a format on a word alone', () => {
    expect(renderTemplate('{title:00}', read({ title: 'Song' }))).toBe('Song');
  });

  it('gives nothing for nothing, and every preset can run', () => {
    expect(renderTemplate('', read(tags))).toBe('');
    expect(renderTemplate('{artist}', read({}))).toBe('');
    for (const preset of TAG_PRESETS) expect(typeof renderTemplate(preset, read(tags))).toBe('string');
  });
});

describe('the queue and a release', () => {
  const file = (name: string, size = 10) => new File([new Uint8Array(size)], name);

  function queueOf(...paths: string[]) {
    const queue = new ImportQueue();
    const rows = queue.add(paths.map((path) => ({ file: file(path.split('/').pop()!), path })));
    for (const row of rows) row.state = 'ready';
    return { queue, rows };
  }

  const detail: ReleaseDetail = {
    provider: 'rpm', id: 'rel', title: 'Album', artist: 'Band', year: 1998, originalYear: 0, country: 'NL', format: 'CD',
    tracks: [{ ...listed(1), title: 'One', artist: 'Band', recordingId: 'rec' }, { ...listed(2), title: 'Two', artist: 'Band' }],
    discCount: 1, artistSort: null, artistId: null, releaseGroupId: 'group', barcode: '0724', label: 'Virgin', catalogNumber: 'V1', genre: 'Rock', subgenre: null, coverUrl: null,
  };

  it('follows the record order, and writes what is ticked', () => {
    const { queue, rows } = queueOf('b.flac', 'a.flac');
    rows[0]!.tags = { TrackNumber: 2 };
    rows[1]!.tags = { TrackNumber: 1 };
    const lines = queue.fillFrom(rows, detail);
    expect(lines.map((line) => line.row)).toEqual([rows[1], rows[0]]);

    lines[1]!.selected = false;
    expect(queue.applyFill(lines, detail, false)).toBe(1);
    expect(rows[1]!.tags).toMatchObject({ Title: 'One', Artist: 'Band', TrackNumber: 1, MusicBrainzRecordingId: 'rec' });
    expect(rows[0]!.tags.Title).toBeUndefined();
  });

  it('sets the album fields when asked, and takes a title typed over', () => {
    const { queue, rows } = queueOf('a.flac');
    rows[0]!.tags = { TrackNumber: 1, Year: 2001 };
    const lines = queue.fillFrom(rows, detail);
    lines[0]!.title = 'Typed';
    queue.applyFill(lines, detail, true);
    expect(rows[0]!.tags).toMatchObject({ Title: 'Typed', Album: 'Album', AlbumArtist: 'Band', Year: 1998, Publisher: 'Virgin', CatalogNumber: 'V1', Barcode: '0724', Genre: 'Rock', TrackCount: 2, MusicBrainzReleaseId: 'rel', MusicBrainzReleaseGroupId: 'group' });
  });

  it('leaves the album fields alone when not asked', () => {
    const { queue, rows } = queueOf('a.flac');
    rows[0]!.tags = { TrackNumber: 1, Album: 'Mine' };
    queue.applyFill(queue.fillFrom(rows, detail), detail, false);
    expect(rows[0]!.tags.Album).toBe('Mine');
  });

  it('writes a file with no row in the release nothing of its own', () => {
    const { queue, rows } = queueOf('a.flac');
    rows[0]!.tags = { TrackNumber: 9, Title: 'Bonus' };
    const lines = queue.fillFrom(rows, detail);
    expect(lines[0]!.track).toBeNull();
    expect(queue.applyFill(lines, detail, false)).toBe(0);
    expect(rows[0]!.tags.Title).toBe('Bonus');
  });

  it('writes a tag from a pattern, and counts what changed', () => {
    const { queue, rows } = queueOf('a.flac', 'b.flac');
    rows[0]!.tags = { Artist: 'Band' };
    rows[1]!.tags = { Artist: 'Band', AlbumArtist: 'Band' };
    expect(queue.tagsFromTags(rows, '{artist}', 'AlbumArtist')).toBe(1);
    expect(rows[0]!.tags.AlbumArtist).toBe('Band');
  });

  it.each([
    ['Album/CD 2/01.flac', 2],
    ['Album/Disc1/01.flac', 1],
    ['Album/disk-3/01.flac', 3],
    ['Album/01.flac', 0],
    ['CD2/Album/01.flac', 0],
    ['Album/Discovery/01.flac', 0],
  ])('%s is disc %i', (path, disc) => {
    expect(discOfFolder(path)).toBe(disc);
  });

  it('numbers discs from folders and leaves a folder that does not say', () => {
    const { queue, rows } = queueOf('A/CD1/a.flac', 'A/CD2/b.flac', 'A/other/c.flac');
    expect(queue.numberDiscs(rows)).toBe(2);
    expect(rows.map((row) => row.tags.DiscNumber)).toEqual([1, 2, undefined]);
    expect(rows[0]!.tags.DiscCount).toBe(2);
  });

  it('finds a second copy, and leaves two takes of one title', () => {
    const queue = new ImportQueue();
    const rows = queue.add([
      { file: file('a.flac', 10), path: 'x/a.flac' },
      { file: file('a.flac', 10), path: 'y/a.flac' },
      { file: file('b.flac', 20), path: 'z/b.flac' },
    ]);
    for (const row of rows) row.tags = { Title: 'Song', Artist: 'Band' };
    expect(queue.duplicates()).toEqual([rows[1]]);
  });
});

describe('cover pictures', () => {
  const asked: unknown[] = [];
  const api = (answer: (address: string) => string | null) => ({
    json: vi.fn(async (_: string, read: (raw: unknown) => unknown, options: { body: { url: string } }) => {
      asked.push(options.body.url);
      const url = answer(options.body.url);
      if (!url) throw new ApiError(404, 'no');
      return read({ url });
    }) as never,
  });

  it('asks the API once for an address', async () => {
    const search = new CoverSearch(api((address) => `https://store/${address}`));
    expect(await search.shown('a')).toBe('https://store/a');
    await search.shown('a');
    expect(asked.filter((address) => address === 'a')).toHaveLength(1);
  });

  it('asks again after a failure', async () => {
    let up = false;
    const search = new CoverSearch(api(() => (up ? 'https://store/b' : null)));
    expect(await search.shown('b')).toBeNull();
    up = true;
    expect(await search.shown('b')).toBe('https://store/b');
  });

  it('takes the thumbnail when the full picture cannot be had', async () => {
    const fetcher = vi.fn(async () => new Response(new Blob([new Uint8Array(3)], { type: 'image/png' })));
    const search = new CoverSearch(api((address) => (address === 'thumb' ? 'https://store/thumb' : null)), fetcher as never);
    const picture = await search.download(['full', 'thumb']);
    expect(picture?.mime).toBe('image/png');
    expect(picture?.bytes.length).toBe(3);
  });

  it('says so when nothing can be had', async () => {
    const search = new CoverSearch(api(() => null));
    expect(await search.download(['full', null])).toBeNull();
  });
});
