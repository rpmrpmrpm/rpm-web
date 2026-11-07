import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../src/api/http';
import type { CloudTrack } from '../../src/api/wire';
import { albumFacts, artistFacts, askAbout, Dossiers, elsewhere, hasMore, lead, lifespan, type Dossier } from '../../src/library/dossier';

const dossier = (over: Partial<Dossier> = {}): Dossier => ({ artist: null, album: null, artistArticle: null, albumArticle: null, ...over });
const article = (text: string) => ({ title: 'T', text, url: '', language: 'en' });

describe('what Track info lists', () => {
  it('reads the sites in the order of the box, one link each', () => {
    const links = elsewhere(
      dossier({
        artist: {
          name: 'Macy Gray',
          links: [
            { url: 'https://www.instagram.com/macygray' },
            { url: 'https://x.com/MacyGraysLife' },
            { url: 'https://www.facebook.com/MacyGray' },
            { url: 'https://www.discogs.com/artist/1' },
            { url: 'https://macygrayofficial.com/', relation: 'official homepage' },
          ],
        },
      }),
    );
    expect(links.map((link) => link.site)).toEqual(['official', 'discogs', 'facebook', 'x', 'instagram']);
  });

  it('prefers the record\'s own page to its artist\'s', () => {
    const links = elsewhere(
      dossier({
        artist: { name: 'a', links: [{ url: 'https://www.discogs.com/artist/1' }] },
        album: { title: 'b', links: [{ url: 'https://www.discogs.com/master/2' }] },
      }),
    );
    expect(links).toEqual([{ site: 'discogs', url: 'https://www.discogs.com/master/2' }]);
  });

  it('does not call a shop filed as a homepage the band\'s own site', () => {
    const links = elsewhere(dossier({ artist: { name: 'a', links: [{ url: 'https://open.spotify.com/artist/1', relation: 'official homepage' }] } }));
    expect(links).toEqual([]);
  });

  it('knows a Bandcamp page by the end of its host', () => {
    expect(elsewhere(dossier({ artist: { name: 'a', links: [{ url: 'https://band.bandcamp.com/' }] } }))[0]!.site).toBe('bandcamp');
  });

  it('leaves out an address it cannot read', () => {
    expect(elsewhere(dossier({ artist: { name: 'a', links: [{ url: 'not an address', relation: 'official homepage' }] } }))).toEqual([]);
  });
});

describe('the fact lines', () => {
  it('gives only what is known', () => {
    expect(artistFacts({ name: 'a', kind: 'Group', area: 'Liverpool', began: '1960', ended: '1970-04-10' })).toBe('Group  ·  Liverpool  ·  1960-1970');
    expect(artistFacts({ name: 'a' })).toBe('');
    expect(artistFacts(null)).toBe('');
  });

  it('falls back from the place to the country code', () => {
    expect(artistFacts({ name: 'a', country: 'US' })).toBe('US');
  });

  it('leaves a life open while it runs, and closes one known to be over', () => {
    expect(lifespan({ name: 'a', began: '1967-07' })).toBe('1967-');
    expect(lifespan({ name: 'a', began: '1967', hasEnded: true })).toBe('1967-');
    expect(lifespan({ name: 'a', began: '1967', ended: '1995' })).toBe('1967-1995');
    expect(lifespan({ name: 'a' })).toBe('');
  });

  it('gives a record its kinds and only the year', () => {
    expect(albumFacts({ title: 'a', primaryType: 'Album', secondaryTypes: ['Live'], firstReleased: '1999-07-01' })).toBe('Album  ·  Live  ·  1999');
    expect(albumFacts({ title: 'a', firstReleased: 'soon' })).toBe('');
  });

  it('shows the first paragraph first', () => {
    expect(lead(article('One.\nTwo.'))).toBe('One.');
    expect(hasMore(article('One.\nTwo.'))).toBe(true);
    expect(lead(article('One.'))).toBe('One.');
    expect(hasMore(article('One.\n'))).toBe(false);
  });
});

describe('who a record is about', () => {
  const track = (albumArtist: string | null, artist: string | null) => ({ artist, tags: { albumArtist } }) as CloudTrack;

  it('is the album artist', () => {
    expect(askAbout(track('Macy Gray', 'Macy Gray feat. Someone'))).toBe('Macy Gray');
  });

  it('is the track\'s own artist on a compilation', () => {
    expect(askAbout(track('Various Artists', 'Kylie Minogue'))).toBe('Kylie Minogue');
    expect(askAbout(track('various', 'Kylie Minogue'))).toBe('Kylie Minogue');
    expect(askAbout(track(null, 'Kylie Minogue'))).toBe('Kylie Minogue');
  });

  it('is nobody when the tags name nobody', () => {
    expect(askAbout(track(null, ' '))).toBeNull();
  });
});

describe('asking about a record', () => {
  const said = { artist: { name: 'a' }, album: null };

  it('asks once, and reads a missing half as nothing', async () => {
    const json = vi.fn(async (_address: string, read: (raw: unknown) => unknown) => read(said));
    const book = new Dossiers({ json: json as never }, () => 'nl,en');
    const one = await book.of('A & B', 'C', 12);
    await book.of('A & B', 'C', 12);
    expect(json).toHaveBeenCalledTimes(1);
    expect(json.mock.calls[0]![0]).toBe('metadata/dossier?artist=A%20%26%20B&album=C&tracks=12&languages=nl%2Cen');
    expect(one).toEqual({ artist: { name: 'a' }, album: null, artistArticle: null, albumArticle: null });
  });

  it('waits while the catalogues are still being asked', async () => {
    let tries = 0;
    const json = vi.fn(async (_address: string, read: (raw: unknown) => unknown) => {
      if (++tries < 3) throw new ApiError(503, 'still asking');
      return read(said);
    });
    const wait = vi.fn(async () => {});
    expect((await new Dossiers({ json: json as never }, () => 'en', wait).of('a', null, 0)).artist?.name).toBe('a');
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it('gives up in the end, and asks again next time', async () => {
    const json = vi.fn(async () => {
      throw new ApiError(503, 'still asking');
    });
    const book = new Dossiers({ json: json as never }, () => 'en', async () => {});
    await expect(book.of('a', null, 0)).rejects.toThrow();
    expect(json).toHaveBeenCalledTimes(4);
    await expect(book.of('a', null, 0)).rejects.toThrow();
    expect(json).toHaveBeenCalledTimes(8);
  });

  it('does not wait out any other failure', async () => {
    const json = vi.fn(async () => {
      throw new ApiError(502, 'no');
    });
    await expect(new Dossiers({ json: json as never }, () => 'en', async () => {}).of('a', null, 0)).rejects.toThrow();
    expect(json).toHaveBeenCalledTimes(1);
  });
});
