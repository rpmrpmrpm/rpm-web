import { describe, expect, it, vi } from 'vitest';

import type { CloudTrack } from '../../src/api/wire';
import { readTrack } from '../../src/api/wire';
import { Catalogue } from '../../src/library/catalogue';
import { pickColour, veilOver } from '../../src/library/colour';
import { readIndex } from '../../src/library/covers';
import type { CatalogueStore } from '../../src/library/store';

const track = (id: string) => readTrack({ rpmId: id, relativePath: `A/${id}/1.flac`, album: id });

function memoryStore(kept: CloudTrack[] | null = null): CatalogueStore {
  let held = kept;
  return { read: async () => held, write: async (_, tracks) => void (held = tracks) };
}

describe('the catalogue', () => {
  it('opens on the copy in this browser, then reads the store', async () => {
    let answer!: (tracks: CloudTrack[]) => void;
    const list = vi.fn(() => new Promise<CloudTrack[]>((done) => (answer = done)));
    const catalogue = new Catalogue({ list }, memoryStore([track('old')]));
    const opening = catalogue.open('u1');
    await vi.waitFor(() => expect(catalogue.albums.map((a) => a.album)).toEqual(['old']));
    expect(catalogue.state).toBe('ready');
    answer([track('new')]);
    await opening;
    expect(catalogue.albums.map((a) => a.album)).toEqual(['new']);
  });

  it('keeps the copy on screen when the read fails, and says it is stale', async () => {
    const catalogue = new Catalogue({ list: async () => { throw new Error('down'); } }, memoryStore([track('old')]));
    await catalogue.open('u1');
    expect(catalogue.albums).toHaveLength(1);
    expect(catalogue.stale).toBe(true);
    expect(catalogue.state).toBe('ready');
  });

  it('does not read a failure as an empty library when there is no copy', async () => {
    const catalogue = new Catalogue({ list: async () => { throw new Error('down'); } }, memoryStore());
    await catalogue.open('u1');
    expect(catalogue.state).toBe('failed');
  });

  it('shows a truly empty library as ready', async () => {
    const catalogue = new Catalogue({ list: async () => [] }, memoryStore());
    await catalogue.open('u1');
    expect(catalogue.state).toBe('ready');
    expect(catalogue.albums).toEqual([]);
  });

  it('does not take the answer of an account that signed out', async () => {
    let answer!: (tracks: CloudTrack[]) => void;
    const catalogue = new Catalogue({ list: () => new Promise((done) => (answer = done)) }, memoryStore());
    const opening = catalogue.open('u1');
    await vi.waitFor(() => expect(catalogue.state).toBe('reading'));
    catalogue.close();
    answer([track('theirs')]);
    await opening;
    expect(catalogue.albums).toEqual([]);
  });

  it('says a whole read is in before it shows any of it, so covers are looked up afresh', async () => {
    const shownThen: string[][] = [];
    const catalogue: Catalogue = new Catalogue({ list: async () => [track('new')] }, memoryStore(), Date.now, () =>
      shownThen.push(catalogue.albums.map((a) => a.album)),
    );
    await catalogue.open('u1');
    expect(shownThen).toEqual([[]]);
  });

  it('does not say so when the read fails', async () => {
    const fresh = vi.fn();
    const catalogue = new Catalogue({ list: async () => { throw new Error('down'); } }, memoryStore(), Date.now, fresh);
    await catalogue.open('u1');
    expect(fresh).not.toHaveBeenCalled();
  });

  it('reads once when asked twice together', async () => {
    const list = vi.fn(async () => [track('a')]);
    const catalogue = new Catalogue({ list }, memoryStore());
    await Promise.all([catalogue.open('u1'), catalogue.refresh()]);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('reads again on focus only after ten minutes', async () => {
    let time = 0;
    const list = vi.fn(async () => [track('a')]);
    const catalogue = new Catalogue({ list }, memoryStore(), () => time);
    await catalogue.open('u1');
    time = 9 * 60 * 1000;
    catalogue.focused();
    expect(list).toHaveBeenCalledTimes(1);
    time = 10 * 60 * 1000;
    catalogue.focused();
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });
});

describe('the cover index', () => {
  it('reads the stamped list', () => {
    expect(readIndex({ albums: [{ albumKey: 'k', updatedAt: 5 }] }).get('k')).toBe(5);
  });

  it('reads the bare keys of an older API', () => {
    expect(readIndex({ albumKeys: ['k'] }).get('k')).toBe(0);
  });
});

describe('the colour of a cover', () => {
  const pixel = (...values: number[]) => Uint8ClampedArray.from(values.flatMap((v, i) => (i % 3 === 2 ? [v, 255] : [v])));

  it('takes the saturated colour over the grey around it', () => {
    expect(pickColour(pixel(100, 100, 100, 200, 40, 30, 90, 90, 95))).toEqual({ r: 200, g: 40, b: 30 });
  });

  it('takes the mean when nothing has colour', () => {
    expect(pickColour(pixel(100, 100, 100, 110, 110, 110))).toEqual({ r: 105, g: 105, b: 105 });
  });
});

describe('the veil over a sleeve', () => {
  it('leaves a dark picture alone, and takes a bright one well down', () => {
    expect(veilOver({ r: 10, g: 10, b: 20 })).toBeCloseTo(0.14);
    expect(veilOver({ r: 250, g: 250, b: 250 })).toBeCloseTo(0.62);
  });

  it('rises with the picture, as CoverColor.Veil', () => {
    expect(veilOver({ r: 128, g: 128, b: 128 })).toBeCloseTo(0.14 + (128 / 255 - 0.18) * 0.9, 2);
  });
});
