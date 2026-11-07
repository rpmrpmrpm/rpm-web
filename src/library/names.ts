// When two spellings are one name. Ported from NameMatch.

const CHARACTER = /[\p{L}\p{N}]/u;

// Case, punctuation and the word "and" go, so "Simon & Garfunkel" and "Simon and Garfunkel" are one.
export function squash(name: string | null | undefined): string {
  if (!name) return '';
  let squashed = '';
  let word = '';
  for (const character of `${name} `) {
    if (CHARACTER.test(character)) {
      word += character.toLowerCase();
      continue;
    }
    if (word && word !== 'and') squashed += word;
    word = '';
  }
  return squashed;
}

export function same(one: string | null | undefined, other: string | null | undefined): boolean {
  if (!one || !other) return false;
  const squashed = squash(one);
  return squashed !== '' && squashed === squash(other);
}
