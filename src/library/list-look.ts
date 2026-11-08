// What colours a generated list's frame is drawn in, worked out from what the list is: its kind, its genre and
// its decade. The desktop (SmartPlaylistFace, PlaylistFigure.Colourway, CoverOverlay.Ink) and the phone apps
// (GeneratedListLook) do the same arithmetic, so every app draws a list in the same colours, and no colour has to
// be sent. Every colour comes from the app's palette. Nothing is mixed or lifted.

import { accents, type Rgb } from '../design/palette.generated';

// Three neighbours off the palette ring, sorted by light: the brightest, the middle one and the darkest.
export interface Trio {
  hot: Rgb;
  mid: Rgb;
  deep: Rgb;
}

export interface ListLook {
  trio: Trio;
  // What the frame drawing paints black.
  border: Rgb;
  // What it paints white, and the colour of the list's name.
  text: Rgb;
  // Whether the list has no picture of its own behind the frame's window. See roomed.
  roomed: boolean;
  // The palette colour the seed lands on. The desktop washes a list's photograph in it.
  tint: Rgb;
}

// Which colour off the ring each kind wears. Kinds are matched by name, so a kind added on the desktop later still
// reaches this page, as a list with no frame.
const HUES: Record<string, number> = {
  Calm: 5, // Azure
  Energetic: 9, // Red
  Danceable: 7, // Magenta
  Focus: 4, // Forest
  Sleep: 6, // Indigo
  Decade: 1, // Rust
  Classical: 3, // Lime
  FavoriteTracks: 8, // Crimson
  MostPlayed: 0, // Vermilion
  OnRepeat: 1, // Rust
  RecentlyPlayed: 2, // Gold
  RecentlyAdded: 3, // Lime
  FirstListens: 4, // Forest
  LateNight: 6, // Indigo
  Rediscover: 7, // Magenta
  LovedAndForgotten: 8, // Crimson
  PlayedNotLoved: 9, // Red
  NeverPlayed: 5, // Azure
  KeepSkipping: 1, // Rust
  RightNow: 5, // Azure
};

export const hueOf = (kind: string): number | undefined => HUES[kind];

// The five lists that have nothing of their own to put behind the frame's window. Every other list shows the
// picture the desktop stored for it there.
const ROOMED = new Set(['RightNow', 'OnRepeat', 'FavoriteTracks', 'FirstListens', 'LovedAndForgotten']);

export const roomed = (kind: string): boolean => ROOMED.has(kind);

// FNV-1a over the UTF-16 units of the text, as the desktop walks a C# string. Both must give the same number for
// the same genre.
export function scatter(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619) >>> 0;
  return hash % 4096;
}

// The hue in the low digit, and the variation above it. A decade is scattered through the same hash as a genre,
// so 1960 and 1970 do not come out as near neighbours.
export function seedOf(hue: number, genre: string | null | undefined, decade: number): number {
  const variation = decade > 0 ? 977 + scatter(`${decade}s`) : genre == null ? 977 : 977 + scatter(genre);
  return (Math.imul(variation, accents.length) + hue) >>> 0;
}

// The plain weighted sum the trio is sorted by. It is not WCAG luminance.
const light = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const same = (a: Rgb, b: Rgb) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

export function trioOf(seed: number): Trio {
  const ring = accents.map((accent) => accent.base);
  // How far round the ring the other two sit: one step or two, rolled from the seed.
  const span = 1 + (Math.floor(seed / 2048) % 2);
  const at = seed % ring.length;
  const three = [ring[at]!, ring[(at + span) % ring.length]!, ring[(((at - span) % ring.length) + ring.length) % ring.length]!];
  three.sort((a, b) => light(a) - light(b));
  return { hot: three[2]!, mid: three[1]!, deep: three[0]! };
}

// The darkest stop of the ramp the palette ships beside this colour. A colour with no ramp is taken to 40% on
// each channel, the figure the palette's own ramps use for their foot.
export function footOf(colour: Rgb): Rgb {
  const ramp = accents.find((accent) => same(accent.base, colour))?.gradient;
  const last = ramp?.[ramp.length - 1];
  if (last) return last;
  return [Math.round(colour[0] * 0.4), Math.round(colour[1] * 0.4), Math.round(colour[2] * 0.4)];
}

const channel = (value: number) => {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

const luminance = ([r, g, b]: Rgb) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

// WCAG's contrast ratio, from 1 to 21. The name is large bold text, so 3:1 is the target.
export function contrast(a: Rgb, b: Rgb): number {
  const one = luminance(a);
  const two = luminance(b);
  return (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05);
}

// The look of the list the desktop keyed on these three fields, or null for a kind this build has no colours for.
export function lookOf(kind: string, genre: string | null | undefined, decade: number): ListLook | null {
  const hue = hueOf(kind);
  if (hue === undefined || !accents.length) return null;
  const seed = seedOf(hue, genre, decade);
  const trio = trioOf(seed);
  const tint = accents[seed % accents.length]!.base;
  const border = footOf(trio.deep);
  // The brightest of the three is not always the most readable on the border.
  let text = trio.hot;
  for (const candidate of [trio.mid, trio.deep]) if (contrast(candidate, border) > contrast(text, border)) text = candidate;
  return { trio, border, text, roomed: roomed(kind), tint };
}
