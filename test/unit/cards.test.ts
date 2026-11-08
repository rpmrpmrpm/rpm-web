import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../src/api/http';
import type { CloudTrack } from '../../src/api/wire';
import { activeOf, capitalised, EncyclopediaCards, lifeOf, siteName, type ConductorCard, type LabelCard } from '../../src/library/cards';
import { albumParts, creditsOf, partOf, RemoteTags } from '../../src/library/credits';

const conductor = (born: string | null, died: string | null): ConductorCard => ({ name: 'Colin Davis', roles: [], born, died, article: null, photoUrl: null, links: [] });
const label = (founded: string | null, ended: string | null): LabelCard => ({ name: 'Philips', founded, ended, genres: [], article: null, logoUrl: null, links: [] });

describe('the conductor and the label', () => {
  it('say when they lived and when they were active, from what is known', () => {
    expect(lifeOf(conductor('1927', '2013'))).toEqual({ text: '1927-2013' });
    expect(lifeOf(conductor('1940', null))).toEqual({ key: 'TrackInfo_ConductorBorn', values: ['1940'] });
    expect(lifeOf(conductor(null, '1910'))).toEqual({ text: '-1910' });
    expect(lifeOf(conductor(null, null))).toBeNull();
    expect(activeOf(label('1950', '1999'))).toEqual({ key: 'TrackInfo_LabelFromTo', values: ['1950', '1999'] });
    expect(activeOf(label('1950', null))).toEqual({ key: 'TrackInfo_LabelSince', values: ['1950'] });
    expect(activeOf(label(null, '1999'))).toEqual({ key: 'TrackInfo_LabelClosed', values: ['1999'] });
  });

  it('start each of Wikidata\'s lower-case words with a capital', () => {
    expect(capitalised(['conductor', 'clarinettist'])).toBe('Conductor  ·  Clarinettist');
  });

  it('name their links as the desktop does, and any other by its host', () => {
    expect(siteName({ site: 'officialSite', url: 'https://x.org' })).toBeNull();
    expect(siteName({ site: 'allMusic', url: 'https://www.allmusic.com/a' })).toBe('AllMusic');
    expect(siteName({ site: 'other', url: 'https://www.musicbrainz.org/artist/1' })).toBe('musicbrainz.org');
  });

  it('asks once per name, and asks again after a failure', async () => {
    let fail = true;
    const json = vi.fn(async (address: string, read: (raw: unknown) => unknown) => {
      if (fail) throw new ApiError(502, 'down');
      return read({ conductor: { ...conductor('1927', '2013'), name: address } });
    });
    const cards = new EncyclopediaCards({ json } as never, () => 'fr,en');
    await expect(cards.conductor('Sir Colin Davis')).rejects.toThrow();
    fail = false;
    const found = await cards.conductor(' Sir Colin Davis ');
    expect(found?.name).toBe('metadata/conductor?name=Sir%20Colin%20Davis&languages=fr%2Cen');
    await cards.conductor('Sir Colin Davis');
    expect(json).toHaveBeenCalledTimes(2);
  });

  it('says nobody where the API found nobody', async () => {
    const cards = new EncyclopediaCards({ json: async (_: string, read: (raw: unknown) => unknown) => read({ label: null }) } as never, () => 'en');
    expect(await cards.label('Nobody Records')).toBeNull();
  });
});

const track = (composer: string | null = null): CloudTrack =>
  ({ rpmId: 'r1', sha256: 's', relativePath: null, originalSize: 1, title: 'Sonata', artist: 'Beethoven', album: 'Moonlight', addedAt: 1, updatedAt: 1, tags: { composer } }) as CloudTrack;

describe('the credits', () => {
  it('come from the sidecar in the desktop\'s order, with the row\'s composer first', () => {
    const sidecar = { Composers: 'L. van Beethoven', Conductor: 'Colin Davis', Isrc: 'NL-A00-01-00001', Publisher: ' ', Comment: 'Live' };
    expect(creditsOf(track('Ludwig van Beethoven'), sidecar)).toEqual([
      { label: 'Details_Composers', value: 'Ludwig van Beethoven' },
      { label: 'Details_Conductor', value: 'Colin Davis' },
      { label: 'Details_Isrc', value: 'NL-A00-01-00001' },
      { label: 'Details_Comment', value: 'Live' },
    ]);
  });

  it('are the row\'s alone where there is no sidecar', () => {
    expect(creditsOf(track('Erik Satie'), null)).toEqual([{ label: 'Details_Composers', value: 'Erik Satie' }]);
    expect(creditsOf(track(), null)).toEqual([]);
  });

  it('read each sidecar once, without its picture, and read it again after a failure', async () => {
    let fail = true;
    const read = vi.fn(async () => {
      if (fail) throw new Error('down');
      return { Conductor: 'Colin Davis', Art: 'AAAA' };
    });
    const tags = new RemoteTags({ read });
    await expect(tags.of('r1')).rejects.toThrow();
    fail = false;
    expect(await tags.of('r1')).toEqual({ Conductor: 'Colin Davis' });
    await tags.of('r1');
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe('a record that is several works', () => {
  it('is cut on a slash with spaces round it, and not on one without', () => {
    expect(albumParts('Eine kleine Nachtmusik / Divertimento / Ein musikalischer Spaß')).toEqual(['Eine kleine Nachtmusik', 'Divertimento', 'Ein musikalischer Spaß']);
    expect(albumParts('AC/DC Live')).toEqual([]);
    expect(albumParts('One / one')).toEqual([]);
    expect(albumParts(null)).toEqual([]);
  });

  it('opens on the part the track is a movement of, or the first', () => {
    const parts = ['Eine kleine Nachtmusik', 'Divertimento'];
    expect(partOf(parts, 'divertimento')).toBe(1);
    expect(partOf(parts, 'Requiem')).toBe(0);
    expect(partOf(parts, null)).toBe(0);
  });
});
