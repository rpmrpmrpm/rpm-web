// When something on the Feed was written, as the desktop and the phones say it: "just now" in the first minute,
// then minutes, hours and days ago, and the date past a month.

import { currentLanguage, text } from '../strings/loc';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function written(millis: number, now: number = Date.now()): string {
  if (millis <= 0) return '';
  const age = Math.max(0, now - millis);
  if (age < MINUTE) return text('Rpm_Profile_JustNow');
  if (age < HOUR) return text('Cloud_HistoryMinutes', Math.floor(age / MINUTE));
  if (age < DAY) return text('Cloud_HistoryHours', Math.floor(age / HOUR));
  if (age < 31 * DAY) return text('Cloud_HistoryDays', Math.floor(age / DAY));
  return new Date(millis).toLocaleDateString(currentLanguage(), { day: 'numeric', month: 'short', year: 'numeric' });
}

// "Member since" a month and a year.
export const monthAndYear = (millis: number): string => new Date(millis).toLocaleDateString(currentLanguage(), { month: 'long', year: 'numeric' });

// A count grouped as the reader's language groups thousands.
export const grouped = (count: number): string => count.toLocaleString(currentLanguage());
