// The picture behind the app: one of rpm's own backdrops, or one the listener chose, as the desktop's Backdrop
// and its Settings row. It stands behind the panes whenever no record or artist page lends its colours.
//
// The choice is kept in this browser. A picture of the listener's own is kept in the Cache API, because it is
// too large for localStorage.

import gold from './images/backgrounds/gold.jpg';
import goldTile from './images/backgrounds/gold-tile.jpg';
import night from './images/backgrounds/night.jpg';
import nightTile from './images/backgrounds/night-tile.jpg';
import pegasus from './images/backgrounds/pegasus.jpg';
import pegasusTile from './images/backgrounds/pegasus-tile.jpg';
import rpamp from './images/backgrounds/rpamp.jpg';
import rpampTile from './images/backgrounds/rpamp-tile.jpg';
import sheetMusic from './images/backgrounds/sheet-music.jpg';
import sheetMusicTile from './images/backgrounds/sheet-music-tile.jpg';

export interface Backdrop {
  // What is stored. Empty is the default.
  id: string;
  label: string;
  picture: string;
  tile: string;
  // For supporters only. The tile is still shown, so everyone can see it exists.
  supporters?: boolean;
}

export const BACKDROPS: readonly Backdrop[] = [
  { id: '', label: 'Settings_BackgroundDefault', picture: rpamp, tile: rpampTile },
  { id: 'night', label: 'Settings_BackgroundNight', picture: night, tile: nightTile },
  { id: 'pegasus', label: 'Settings_BackgroundPegasus', picture: pegasus, tile: pegasusTile },
  { id: 'sheet-music', label: 'Settings_BackgroundSheetMusic', picture: sheetMusic, tile: sheetMusicTile },
  { id: 'gold', label: 'Settings_BackgroundGold', picture: gold, tile: goldTile, supporters: true },
];

const CHOICE_KEY = 'rpm-backdrop';
const CACHE = 'rpm-backdrop-1';
const OWN = '/backdrop/own';
const MOST_BYTES = 20 * 1024 * 1024;

function stored(): string {
  try {
    return localStorage.getItem(CHOICE_KEY) ?? '';
  } catch {
    return '';
  }
}

function store(id: string) {
  try {
    if (id) localStorage.setItem(CHOICE_KEY, id);
    else localStorage.removeItem(CHOICE_KEY);
  } catch {
    // Without storage the choice lasts until the page is closed.
  }
}

// Which built-in is in use, given what is stored and whether the account may have a supporter's backdrop.
// A stored id is never changed here: when support lapses the default stands, and when it comes back the
// stored choice is shown again. An id this version does not know is the default.
export function effectiveId(id: string, supporter: boolean): string {
  const known = BACKDROPS.find((backdrop) => backdrop.id === id);
  if (!known || (known.supporters && !supporter)) return '';
  return known.id;
}

class Choice {
  id = $state(stored());
  // A blob address for the listener's own picture, or null.
  own = $state<string | null>(null);

  constructor() {
    void this.readOwn();
  }

  private async readOwn() {
    try {
      const kept = await (await caches.open(CACHE)).match(OWN);
      if (kept) this.own = URL.createObjectURL(await kept.blob());
    } catch {
      // No Cache API here, as in a private window: the built-ins still work.
    }
  }

  // The picture that stands behind the app now. The listener's own picture outranks a built-in.
  picture(supporter: boolean): string {
    if (this.own) return this.own;
    const id = effectiveId(this.id, supporter);
    return BACKDROPS.find((backdrop) => backdrop.id === id)!.picture;
  }

  async pick(id: string) {
    await this.dropOwn();
    this.id = id;
    store(id);
  }

  // Keeps a picture from disk as the backdrop. False when it is not a picture, is too large, or cannot be kept.
  async pickOwn(file: File): Promise<boolean> {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > MOST_BYTES) return false;
    try {
      await (await caches.open(CACHE)).put(OWN, new Response(file, { headers: { 'Content-Type': file.type } }));
    } catch {
      return false;
    }
    if (this.own) URL.revokeObjectURL(this.own);
    this.own = URL.createObjectURL(file);
    return true;
  }

  private async dropOwn() {
    if (!this.own) return;
    URL.revokeObjectURL(this.own);
    this.own = null;
    try {
      await (await caches.open(CACHE)).delete(OWN);
    } catch {
      // Nothing was kept.
    }
  }
}

export const backdrop = new Choice();
