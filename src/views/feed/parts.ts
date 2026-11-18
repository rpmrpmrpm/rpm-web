// Small helpers shared by the Feed's cards and pages.

import type { Song } from '../../api/community';
import { text } from '../../strings/loc';

// Whether a press on a card landed on a key inside it, which does its own thing, or ended a text selection, rather
// than being a press on the card.
export function insideKey(event: MouseEvent): boolean {
  const card = event.currentTarget as Element;
  const key = (event.target as Element | null)?.closest('button, a, input, textarea, label');
  if (key && card.contains(key)) return true;
  return (getSelection()?.toString() ?? '') !== '';
}

// "Title by Artist", as the phones write a song.
export const songLine = (song: Song): string => (song.artist ? text('Rpm_Profile_NowPlaying', song.title, song.artist) : song.title);

// The review in quotation marks, or nothing for a rating with no text.
export const quoted = (body: string): string => (body.trim() ? text('Rpm_Profile_Quoted', body.trim()) : '');
