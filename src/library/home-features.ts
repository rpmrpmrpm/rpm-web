// The top of Home: the banner and the quick selection. These are HomeFeatures, HomeBanner and QuickPicks of
// the desktop app.

export type FeatureKind = 'continue' | 'added' | 'suggested' | 'played' | 'listened';

export interface Feature {
  kind: FeatureKind;
  key: string;
}

export const FEATURE_COUNT = 7;
export const PICK_COUNT = 16;
export const PANEL_TALL = 4;
export const DWELL_MS = 7000;

const PLATE_SHARE = 0.68;
const WIDEST_PLATE = 760;
const BITE = 24;
const LEAST_PEEK = 124;
const SLIDE_SHARE = 0.3;
const LEAST_SLIDE = 60;
const MOST_SLIDE = 180;

export interface FeatureSources {
  continued: readonly string[];
  added: readonly string[];
  suggested: readonly string[];
  played: readonly string[];
  listened: readonly string[];
  // Those records are never featured: a card is drawn on the act's photograph, and a compilation has none.
  isVarious: (key: string) => boolean;
}

// One card from each question before a second from any of them, and a record is featured once. A question
// with nothing to say is passed over, so a new collection still fills the strip.
export function featureStrip(sources: FeatureSources, wanted = FEATURE_COUNT): Feature[] {
  const records = (keys: readonly string[]) => keys.filter((key) => !sources.isVarious(key));
  const dealing: [FeatureKind, string[]][] = [
    ['continue', records(sources.continued)],
    ['added', records(sources.added)],
    ['suggested', records(sources.suggested)],
    ['played', records(sources.played)],
    ['listened', records(sources.listened)],
  ];

  const strip: Feature[] = [];
  const taken = new Set<string>();
  const cursor = dealing.map(() => 0);

  while (strip.length < wanted) {
    let dealt = false;
    for (const [index, [kind, keys]] of dealing.entries()) {
      if (strip.length >= wanted) break;
      while (cursor[index]! < keys.length && taken.has(keys[cursor[index]!]!.toLowerCase())) cursor[index]!++;
      if (cursor[index]! >= keys.length) continue;
      const key = keys[cursor[index]!++]!;
      taken.add(key.toLowerCase());
      strip.push({ kind, key });
      dealt = true;
    }
    if (!dealt) break;
  }
  return strip;
}

export interface BannerLayout {
  plate: number;
  peek: number;
  slide: number;
}

// The card in front and the two partly behind it. A strip too narrow for neighbours gives the plate all of it.
export function bannerLayout(strip: number): BannerLayout {
  const wide = Math.min(strip * PLATE_SHARE, WIDEST_PLATE);
  const peek = (strip - wide) / 2 + BITE;
  const plate = peek < LEAST_PEEK ? strip : wide;
  return {
    plate,
    peek: peek < LEAST_PEEK ? 0 : peek,
    slide: Math.min(MOST_SLIDE, Math.max(LEAST_SLIDE, plate * SLIDE_SHARE)),
  };
}

export type QuickPickKind = 'song' | 'album';

export interface QuickPick {
  kind: QuickPickKind;
  key: string;
}

// Each kind is ranked within itself and dealt in turn, because a song played fifty times and a record played
// fifty times are two different numbers. Each record is offered once.
export function chooseQuickPicks(
  songs: readonly string[],
  albums: readonly string[],
  recordOf: (pick: QuickPick) => string | null,
  count = PICK_COUNT,
): QuickPick[] {
  const dealing: [QuickPickKind, readonly string[]][] = [
    ['song', songs],
    ['album', albums],
  ];
  const picked: QuickPick[] = [];
  const records = new Set<string>();
  const cursor = dealing.map(() => 0);
  const seen = (kind: QuickPickKind, key: string) => {
    const record = recordOf({ kind, key });
    return record !== null && records.has(record);
  };

  while (picked.length < count) {
    let dealt = false;
    for (const [index, [kind, keys]] of dealing.entries()) {
      if (picked.length >= count) break;
      while (cursor[index]! < keys.length && (!keys[cursor[index]!] || seen(kind, keys[cursor[index]!]!))) cursor[index]!++;
      if (cursor[index]! >= keys.length) continue;
      const pick = { kind, key: keys[cursor[index]!++]! };
      const record = recordOf(pick);
      if (record) records.add(record);
      picked.push(pick);
      dealt = true;
    }
    if (!dealt) break;
  }
  return picked;
}

// Down each panel and then across: four lists, not a grid with the four most played along the top.
export function inPanels<T>(picks: readonly T[], tall = PANEL_TALL): T[][] {
  const panels: T[][] = [];
  for (let at = 0; at < picks.length; at += tall) panels.push(picks.slice(at, at + tall));
  return panels;
}
