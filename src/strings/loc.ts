// UI text. The tables are generated from strings.json in the rpm repo, one file per language, and
// only the language in use is loaded.

const tables = import.meta.glob<{ default: Record<string, string> }>('./*.json');

let table: Record<string, string> = {};

const languages = ['en', 'fr', 'es', 'de', 'zh-Hans'];

// The language to show, from what the browser asks for. A language rpm does not have falls back to
// English.
export function chooseLanguage(asked: readonly string[]): string {
  for (const tag of asked) {
    const lower = tag.toLowerCase();
    if (lower.startsWith('zh')) return 'zh-Hans';
    const base = lower.split('-')[0]!;
    if (languages.includes(base)) return base;
  }
  return 'en';
}

export async function loadStrings(language: string): Promise<void> {
  const load = tables[`./${language}.json`] ?? tables['./en.json'];
  if (!load) throw new Error(`no strings for ${language}`);
  table = (await load()).default;
}

// The text for a key, with {0}, {1} filled in. A missing key shows the key, so it is seen in testing
// rather than showing an empty space.
export function text(key: string, ...values: (string | number)[]): string {
  const found = table[key] ?? key;
  return found.replace(/\{(\d+)\}/g, (_, index) => String(values[Number(index)] ?? ''));
}
