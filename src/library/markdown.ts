// The small Markdown a review is written in, read as the desktop's SimpleMarkdown reads it: headings with #, ##
// and ###, lists with - or * or 1., and **bold**, *italic*, _italic_ and `code` inside a line. Everything else is
// plain text. The result is data, never HTML, so nothing a review says can run as markup.

export type Style = 'plain' | 'bold' | 'italic' | 'code';

export interface Part {
  text: string;
  style: Style;
}

export type Line =
  | { kind: 'blank' }
  | { kind: 'heading'; level: 1 | 2 | 3; parts: Part[] }
  | { kind: 'item'; marker: string; parts: Part[] }
  | { kind: 'text'; parts: Part[] };

const HEADING = /^(#{1,3})\s+(.+)$/;
const BULLET = /^\s*[-*]\s+(.+)$/;
const NUMBER = /^\s*(\d+)\.\s+(.+)$/;
const INLINE = /\*\*(.+?)\*\*|`(.+?)`|\*(.+?)\*|_(.+?)_/g;

export function inline(text: string): Part[] {
  const parts: Part[] = [];
  let at = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > at) parts.push({ text: text.slice(at, match.index), style: 'plain' });
    const [, bold, code, star, underscore] = match;
    if (bold !== undefined) parts.push({ text: bold, style: 'bold' });
    else if (code !== undefined) parts.push({ text: code, style: 'code' });
    else parts.push({ text: (star ?? underscore)!, style: 'italic' });
    at = match.index + match[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), style: 'plain' });
  return parts;
}

export function readMarkdown(markdown: string): Line[] {
  return markdown
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((raw): Line => {
      const line = raw.trimEnd();
      if (!line) return { kind: 'blank' };
      const heading = HEADING.exec(line);
      if (heading) return { kind: 'heading', level: heading[1]!.length as 1 | 2 | 3, parts: [{ text: heading[2]!, style: 'plain' }] };
      const bullet = BULLET.exec(line);
      if (bullet) return { kind: 'item', marker: '•', parts: inline(bullet[1]!) };
      const number = NUMBER.exec(line);
      if (number) return { kind: 'item', marker: `${number[1]}.`, parts: inline(number[2]!) };
      return { kind: 'text', parts: inline(line) };
    });
}
