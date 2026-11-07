// UI text. The tables are generated from strings.json in the rpm repo, one file per language, and
// only the language in use is loaded.

const tables = import.meta.glob<{ default: Record<string, string> }>('./*.json');

let table: Record<string, string> = {};

// Each language's name in itself, so a person can find their own whatever is on screen.
export const LANGUAGES = [
  ['en', 'English'],
  ['fr', 'Français'],
  ['es', 'Español'],
  ['de', 'Deutsch'],
  ['zh-Hans', '简体中文'],
] as const;

const languages: readonly string[] = LANGUAGES.map(([code]) => code);
const LANGUAGE_KEY = 'rpm-language';
let language = 'en';

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

// The language picked in the app, or null when none was.
export function pickedLanguage(): string | null {
  try {
    const picked = localStorage.getItem(LANGUAGE_KEY);
    return picked && languages.includes(picked) ? picked : null;
  } catch {
    return null;
  }
}

export const currentLanguage = (): string => language;

export async function setLanguage(picked: string): Promise<void> {
  try {
    localStorage.setItem(LANGUAGE_KEY, picked);
  } catch {
    // It holds for this visit.
  }
  await loadStrings(picked);
  location.reload();
}

export async function loadStrings(wanted: string): Promise<void> {
  const load = tables[`./${wanted}.json`] ?? tables['./en.json'];
  if (!load) throw new Error(`no strings for ${wanted}`);
  table = (await load()).default;
  language = wanted;
}

// The text for a key, with {0}, {1} filled in. A missing key shows the key, so it is seen in testing
// rather than showing an empty space.
export function text(key: string, ...values: (string | number)[]): string {
  const found = table[key] ?? key;
  return found.replace(/\{(\d+)\}/g, (_, index) => String(values[Number(index)] ?? ''));
}
