// The badges a person can show under their name on their page, and what unlocks each. The same ids, order, rules
// and colours as the desktop's RpmProfileBadges and ProfileBadges, ProfileBadges.kt in rpm-android and
// ProfileBadges.swift in rpm-apple. Change all of them together.
//
// Every badge is worked out from the person's own collection on their own device (unlocked), sent to the server
// and kept there, so a badge once unlocked stays.

import { UNCLASSIFIED, UNKNOWN_GENRE } from '../library/genres';

// Every badge in the order they are listed, with the string keys of its name and of what unlocks it. The keys are
// written out in full, because the string tables keep only the keys the code names.
export const BADGES: readonly { id: string; name: string; need: string }[] = [
  { id: 'first-spin', name: 'Rpm_Badge_FirstSpin', need: 'Rpm_Badge_FirstSpin_Need' },
  { id: 'crate-digger', name: 'Rpm_Badge_CrateDigger', need: 'Rpm_Badge_CrateDigger_Need' },
  { id: 'record-collector', name: 'Rpm_Badge_RecordCollector', need: 'Rpm_Badge_RecordCollector_Need' },
  { id: 'music-connoisseur', name: 'Rpm_Badge_Connoisseur', need: 'Rpm_Badge_Connoisseur_Need' },
  { id: 'living-archive', name: 'Rpm_Badge_LivingArchive', need: 'Rpm_Badge_LivingArchive_Need' },
  { id: 'museum-curator', name: 'Rpm_Badge_MuseumCurator', need: 'Rpm_Badge_MuseumCurator_Need' },
  { id: 'ten-thousand', name: 'Rpm_Badge_TenThousand', need: 'Rpm_Badge_TenThousand_Need' },
  { id: 'rock', name: 'Rpm_Badge_Rock', need: 'Rpm_Badge_Rock_Need' },
  { id: 'jazz', name: 'Rpm_Badge_Jazz', need: 'Rpm_Badge_Jazz_Need' },
  { id: 'classical', name: 'Rpm_Badge_Classical', need: 'Rpm_Badge_Classical_Need' },
  { id: 'hiphop', name: 'Rpm_Badge_HipHop', need: 'Rpm_Badge_HipHop_Need' },
  { id: 'electronic', name: 'Rpm_Badge_Electronic', need: 'Rpm_Badge_Electronic_Need' },
  { id: 'metal', name: 'Rpm_Badge_Metal', need: 'Rpm_Badge_Metal_Need' },
  { id: 'pop', name: 'Rpm_Badge_Pop', need: 'Rpm_Badge_Pop_Need' },
  { id: 'soul', name: 'Rpm_Badge_Soul', need: 'Rpm_Badge_Soul_Need' },
  { id: 'folk', name: 'Rpm_Badge_Folk', need: 'Rpm_Badge_Folk_Need' },
  { id: 'blues', name: 'Rpm_Badge_Blues', need: 'Rpm_Badge_Blues_Need' },
  { id: 'reggae', name: 'Rpm_Badge_Reggae', need: 'Rpm_Badge_Reggae_Need' },
  { id: 'latin', name: 'Rpm_Badge_Latin', need: 'Rpm_Badge_Latin_Need' },
  { id: 'genre-hopper', name: 'Rpm_Badge_GenreHopper', need: 'Rpm_Badge_GenreHopper_Need' },
  { id: 'omnivore', name: 'Rpm_Badge_Omnivore', need: 'Rpm_Badge_Omnivore_Need' },
];

export const badgeOf = (id: string | null | undefined) => (id ? BADGES.find((badge) => badge.id === id) : undefined);

// The badge colours, the phones' list. The first is the default, which is stored as empty.
export const BADGE_COLOURS: readonly string[] = ['#7A1FD1', '#2563EB', '#0E9F95', '#2E9E4F', '#D12A4E', '#E0701B', '#D63FA6', '#B8901F'];

// The badge's colour as [r, g, b] from its stored value; the default when it has none or cannot be read.
export function badgeColour(wire: string | null | undefined): [number, number, number] {
  const value = wire && /^#[0-9a-fA-F]{6}$/.test(wire) ? wire : BADGE_COLOURS[0]!;
  const rgb = parseInt(value.slice(1), 16);
  return [(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff];
}

// Albums needed for each size badge.
const SIZES: readonly [string, number][] = [
  ['first-spin', 1],
  ['crate-digger', 50],
  ['record-collector', 250],
  ['music-connoisseur', 1_000],
  ['living-archive', 2_500],
  ['museum-curator', 5_000],
];

// The genre badges, each with the shelves it counts (lower case, as the genre table names them).
const GENRE_BADGES: readonly [string, string[]][] = [
  ['rock', ['rock', 'indie', 'punk', 'noise']],
  ['jazz', ['jazz']],
  ['classical', ['classical', 'neo-classical', 'opera']],
  ['hiphop', ['hip-hop / rap', 'rap', 'trap', 'old school hip hop']],
  ['electronic', ['electronic / dance', 'house', 'techno', 'club']],
  ['metal', ['metal']],
  ['pop', ['pop', 'disco']],
  ['soul', ['r&b', 'soul', 'funk']],
  ['folk', ['folk', 'country']],
  ['blues', ['blues']],
  ['reggae', ['reggae']],
  ['latin', ['latin']],
];

const TEN_THOUSAND = 10_000;
// A genre badge needs this share of all albums, and at least this many albums of the genre.
const GENRE_SHARE = 0.2;
const GENRE_LEAST = 25;
// A genre counts towards the range badges with this many albums.
const RANGE_ALBUMS = 5;
// The shelves for music the app cannot file. They are not genres.
const UNFILED = new Set([UNKNOWN_GENRE.toLowerCase(), UNCLASSIFIED.toLowerCase()]);

// The badges this collection unlocks, in BADGES' order. genreAlbums is how many albums each genre shelf holds.
export function unlockedBadges(albums: number, tracks: number, genreAlbums: ReadonlyMap<string, number>): string[] {
  const held = new Set<string>();
  for (const [id, least] of SIZES) if (albums >= least) held.add(id);
  if (tracks >= TEN_THOUSAND) held.add('ten-thousand');

  const byShelf = new Map<string, number>();
  for (const [shelf, count] of genreAlbums) {
    const key = shelf.trim().toLowerCase();
    byShelf.set(key, (byShelf.get(key) ?? 0) + count);
  }
  for (const [id, shelves] of GENRE_BADGES) {
    const count = shelves.reduce((sum, shelf) => sum + (byShelf.get(shelf) ?? 0), 0);
    if (count >= GENRE_LEAST && albums > 0 && count >= albums * GENRE_SHARE) held.add(id);
  }
  const wide = [...byShelf].filter(([shelf, count]) => !UNFILED.has(shelf) && count >= RANGE_ALBUMS).length;
  if (wide >= 10) held.add('genre-hopper');
  if (wide >= 20) held.add('omnivore');
  return BADGES.map((badge) => badge.id).filter((id) => held.has(id));
}
