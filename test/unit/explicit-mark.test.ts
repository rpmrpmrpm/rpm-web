import { describe, expect, it } from 'vitest';

import { EXPLICIT_MARK, splitExplicitMark } from '../../src/import/explicit-mark';
import { catalogueTags } from '../../src/import/importer';
import type { ImportRow } from '../../src/import/queue';

describe('the explicit mark at the end of a title', () => {
  it('is taken off a title that ends with it after a space', () => {
    expect(splitExplicitMark(`Killah ${EXPLICIT_MARK}`)).toEqual({ title: 'Killah', marked: true });
    expect(splitExplicitMark(`Manchild ${EXPLICIT_MARK}  `)).toEqual({ title: 'Manchild', marked: true });
  });

  it('leaves a title without it at its end exactly as it was', () => {
    for (const title of ['Killah', EXPLICIT_MARK, `Killah${EXPLICIT_MARK}`, `A ${EXPLICIT_MARK} B`, '']) {
      expect(splitExplicitMark(title)).toEqual({ title, marked: false });
    }
  });

  it('gives no title for no title', () => {
    expect(splitExplicitMark(null)).toEqual({ title: null, marked: false });
    expect(splitExplicitMark(undefined)).toEqual({ title: null, marked: false });
  });
});

describe('the catalogue fields of an imported track', () => {
  const row = (tags: ImportRow['tags']) => ({ extension: '.m4a', tags }) as ImportRow;

  it('carry the advisory flag the tags were read with', () => {
    expect(catalogueTags(row({ Title: 'Killah', Advisory: 1 }))).toMatchObject({ advisory: 1 });
  });

  it('say nothing is known when the tags have no flag', () => {
    expect(catalogueTags(row({ Title: 'Killah' }))).toMatchObject({ advisory: 0 });
  });
});
