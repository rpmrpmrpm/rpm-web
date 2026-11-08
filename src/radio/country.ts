// The country the radio lists stations from, as the listener chose it in the radio pane or in the setup. Kept in
// this browser. Null is every country.

const KEY = 'rpm.radioCountry';

export function storedCountry(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function storeCountry(code: string | null) {
  try {
    if (code) localStorage.setItem(KEY, code);
    else localStorage.removeItem(KEY);
  } catch {
    // A preference. It holds for this visit either way.
  }
}

// The country the browser says the listener is in, from a language tag such as "nl-NL", or null.
export function browserCountry(tags: readonly string[]): string | null {
  for (const tag of tags) {
    const region = /^[a-z]{2,3}(?:-[A-Za-z]{4})?-([A-Z]{2})\b/i.exec(tag)?.[1];
    if (region) return region.toUpperCase();
  }
  return null;
}
