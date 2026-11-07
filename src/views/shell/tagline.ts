// A leading "re-" is drawn in a dimmer tone: it is the prefix of the word, with its hyphen. Only a line
// that starts that way has a head. Other languages get the line in one tone.
export function taglineParts(line: string): { head: string; tail: string } {
  const split = line.startsWith('re-') ? 3 : line.startsWith('re') ? 2 : 0;
  return { head: line.slice(0, split), tail: line.slice(split) };
}
