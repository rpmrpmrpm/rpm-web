// The end of the opening. The card in index.html plays from the first moment, for two passes of the band at least,
// and stays until the interface is there to fade into. It always goes in the end: a start that fails shows the page
// it failed on, not the card for ever.

const TWO_PASSES_MS = 2000;
const ONE_PASS_MS = 1000;
const LONGEST_MS = 8000;
const FADE_MS = 300;

let ended = false;

function end() {
  if (ended) return;
  ended = true;
  document.documentElement.classList.add('opened');
  setTimeout(() => document.getElementById('opening')?.remove(), FADE_MS);
}

setTimeout(end, LONGEST_MS);

// Ends on a whole pass, with the band past the last letter, so the word is at rest as it fades.
export function endOpening() {
  const at = performance.now();
  setTimeout(end, Math.max(TWO_PASSES_MS, Math.ceil(at / ONE_PASS_MS) * ONE_PASS_MS) - at);
}
