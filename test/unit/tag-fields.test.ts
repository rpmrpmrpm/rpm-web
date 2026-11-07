import { describe, expect, it } from 'vitest';

import { joinSoloists, performersOf, readField, styleSuggestions, summarise, TAG_FIELDS, vocalistsOf, writeField } from '../../src/library/tag-fields';

describe('the field catalogue', () => {
  it('names each field once', () => {
    const keys = TAG_FIELDS.map((tag) => tag.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('a box and its field', () => {
  it('shows a number that is not known as an empty box', () => {
    expect(readField({ Year: 0 }, 'Year')).toBe('');
    expect(readField({ Year: 1977 }, 'Year')).toBe('1977');
  });

  it('keeps digits only in a number field, and empties it when there are none', () => {
    expect(writeField({}, 'Year', ' 1977a ')).toEqual({ Year: 1977 });
    expect(writeField({ Year: 1977 }, 'Year', '')).toEqual({});
  });

  it('empties a text field that is left blank', () => {
    expect(writeField({ Conductor: 'A' }, 'Conductor', '  ')).toEqual({});
  });

  it('reads and writes the advisory flag as a token over the stored number', () => {
    expect(readField({ Advisory: 1 }, 'Advisory')).toBe('explicit');
    expect(readField({ Advisory: 2 }, 'Advisory')).toBe('clean');
    expect(readField({}, 'Advisory')).toBe('');
    expect(writeField({}, 'Advisory', 'clean')).toEqual({ Advisory: 2 });
    expect(writeField({ Advisory: 1 }, 'Advisory', '')).toEqual({});
  });
});

describe('the soloists, one tag read as two lists', () => {
  const soloists = 'Anne Sofie von Otter (mezzo-soprano); Maurizio Pollini (piano); Bryn Terfel (bass-baritone)';

  it('splits the players from the singers', () => {
    expect(performersOf(soloists)).toEqual(['Maurizio Pollini (piano)']);
    expect(vocalistsOf(soloists)).toEqual(['Anne Sofie von Otter (mezzo-soprano)', 'Bryn Terfel (bass-baritone)']);
  });

  it('replaces one half and keeps the other', () => {
    const tags = writeField({ Soloists: soloists }, 'Performers', 'Martha Argerich (piano)');
    expect(tags.Soloists).toBe('Martha Argerich (piano); Anne Sofie von Otter (mezzo-soprano); Bryn Terfel (bass-baritone)');
    expect(readField(tags, 'Vocalists')).toBe('Anne Sofie von Otter (mezzo-soprano); Bryn Terfel (bass-baritone)');
  });

  it('marks a singer typed without a voice as a singer', () => {
    expect(joinSoloists([], ['Freddie Mercury'])).toBe('Freddie Mercury (vocals)');
  });
});

describe('what a box offers', () => {
  it('offers the styles under the genre the record has, and none for a genre the app does not know', () => {
    expect(styleSuggestions('House')).toContain('Deep House');
    expect(styleSuggestions('House')).not.toContain('Psytrance');
    expect(styleSuggestions('Nothing like a genre')).toEqual([]);
  });
});

describe('several tracks at once', () => {
  it('says when they agree', () => {
    expect(summarise([{ Year: 1977 }, { Year: 1977 }], 'Year')).toEqual({ agreed: true, common: '1977', values: ['1977'] });
  });

  it('gives the value most of them hold, and every value they hold', () => {
    expect(summarise([{ Album: 'Rumours' }, { Album: 'Rumors' }, { Album: 'Rumours' }, {}], 'Album')).toEqual({ agreed: false, common: 'Rumours', values: ['Rumours', 'Rumors'] });
  });
});
