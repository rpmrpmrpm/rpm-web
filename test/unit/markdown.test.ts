import { describe, expect, it } from 'vitest';

import { inline, readMarkdown } from '../../src/library/markdown';

describe('a review in Markdown', () => {
  it('reads bold, italic and code inside a line, and leaves the rest as it is', () => {
    expect(inline('A **great** record, *truly*, with `one` _odd_ track')).toEqual([
      { text: 'A ', style: 'plain' },
      { text: 'great', style: 'bold' },
      { text: ' record, ', style: 'plain' },
      { text: 'truly', style: 'italic' },
      { text: ', with ', style: 'plain' },
      { text: 'one', style: 'code' },
      { text: ' ', style: 'plain' },
      { text: 'odd', style: 'italic' },
      { text: ' track', style: 'plain' },
    ]);
  });

  it('reads headings, lists and blank lines', () => {
    expect(readMarkdown('# Side A\n- First\n2. Second\n\nThe end')).toEqual([
      { kind: 'heading', level: 1, parts: [{ text: 'Side A', style: 'plain' }] },
      { kind: 'item', marker: '•', parts: [{ text: 'First', style: 'plain' }] },
      { kind: 'item', marker: '2.', parts: [{ text: 'Second', style: 'plain' }] },
      { kind: 'blank' },
      { kind: 'text', parts: [{ text: 'The end', style: 'plain' }] },
    ]);
  });

  it('keeps markup as text, because a review is never shown as HTML', () => {
    expect(readMarkdown('<img src=x onerror=alert(1)>')).toEqual([{ kind: 'text', parts: [{ text: '<img src=x onerror=alert(1)>', style: 'plain' }] }]);
  });
});
