// What a person's page is drawn on, as the server stores it (pageGround): empty for the app's standard ground,
// "color:#RRGGBB" for a solid colour, or "backdrop:{id}" for one of the app's backgrounds. A value this build
// cannot read is the standard ground. The same rules as the desktop's RpmPageGround.

import gold from '../design/images/backgrounds/gold.jpg';
import goldTile from '../design/images/backgrounds/gold-tile.jpg';
import night from '../design/images/backgrounds/night.jpg';
import nightTile from '../design/images/backgrounds/night-tile.jpg';
import pegasus from '../design/images/backgrounds/pegasus.jpg';
import pegasusTile from '../design/images/backgrounds/pegasus-tile.jpg';
import rpampTile from '../design/images/backgrounds/rpamp-tile.jpg';
import sheetMusic from '../design/images/backgrounds/sheet-music.jpg';
import sheetMusicTile from '../design/images/backgrounds/sheet-music-tile.jpg';

export type Ground = { kind: 'standard' } | { kind: 'colour'; rgb: number } | { kind: 'backdrop'; id: string };

export const STANDARD: Ground = { kind: 'standard' };

export function readGround(wire: string | null | undefined): Ground {
  if (wire && /^color:#[0-9a-fA-F]{6}$/.test(wire)) return { kind: 'colour', rgb: parseInt(wire.slice(7), 16) };
  if (wire && wire.startsWith('backdrop:') && wire.length > 9) return { kind: 'backdrop', id: wire.slice(9) };
  return STANDARD;
}

export function groundWire(ground: Ground): string {
  if (ground.kind === 'colour') return `color:#${ground.rgb.toString(16).toUpperCase().padStart(6, '0')}`;
  if (ground.kind === 'backdrop') return `backdrop:${ground.id}`;
  return '';
}

export const hex = (rgb: number): string => `#${rgb.toString(16).padStart(6, '0')}`;

// The backgrounds on the edit page, in order, by the id the server and the phones store. The phones' "vinyl" is
// the desktop's night table of records. Gold is offered to supporters only.
export const GROUND_CHOICES: readonly { id: string | null; label: string; picture: string | null; tile: string; supporters?: boolean }[] = [
  { id: null, label: 'Settings_BackgroundDefault', picture: null, tile: rpampTile },
  { id: 'vinyl', label: 'Settings_BackgroundVinyl', picture: night, tile: nightTile },
  { id: 'pegasus', label: 'Settings_BackgroundPegasus', picture: pegasus, tile: pegasusTile },
  { id: 'sheet-music', label: 'Settings_BackgroundSheetMusic', picture: sheetMusic, tile: sheetMusicTile },
  { id: 'gold', label: 'Settings_BackgroundGold', picture: gold, tile: goldTile, supporters: true },
];

// The solid colours, the phones' list.
export const GROUND_COLOURS: readonly number[] = [0x2a0a5e, 0x0b1e4a, 0x0e4b4f, 0x14402a, 0x4f1028, 0x5a2a0c, 0x2a2f38, 0x0a0a0a];

// The picture for a ground, or null for the standard ground and for a background this build does not know.
export const groundPicture = (ground: Ground): string | null =>
  ground.kind === 'backdrop' ? (GROUND_CHOICES.find((choice) => choice.id === ground.id)?.picture ?? null) : null;
