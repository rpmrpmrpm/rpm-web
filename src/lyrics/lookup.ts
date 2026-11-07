// The words of what is playing: the sheet the owner chose on another device, kept in the cloud, or else what LRCLIB
// gives. LRCLIB is asked through rpm's API, which hands the words on and keeps none of them. It is asked only while the
// words are on screen, so ordinary listening asks nothing.

import { ApiError, type Api } from '../api/http';
import type { CloudTrack } from '../api/wire';
import { EMPTY_SHEET, isSynced, parseSheet, type LyricSheet } from './sheet';

export class Lyrics {
  private readonly held = new Map<string, LyricSheet>();
  private readonly others = new Map<string, LyricSheet[]>();

  constructor(private readonly api: Pick<Api, 'json' | 'call'>) {}

  private async chosen(rpmId: string): Promise<string | null> {
    try {
      return await this.api.json(`cloud/lyric-sheet/${encodeURIComponent(rpmId)}`, (raw) => (raw as { lrc?: string | null }).lrc ?? null);
    } catch (error) {
      // The owner chose none, or the store did not answer: LRCLIB is the next place to look either way.
      if (error instanceof ApiError) return null;
      throw error;
    }
  }

  // What LRCLIB holds that fits the record's length, best first. Nobody answering is not the same as no sheet, so
  // it throws, and nothing is remembered.
  private async all(track: CloudTrack): Promise<LyricSheet[]> {
    const known = this.others.get(track.rpmId);
    if (known) return known;

    const asked = new URLSearchParams({ title: track.title ?? '', artist: track.artist ?? '', album: track.album ?? '', seconds: String(track.tags?.durationSeconds ?? 0) });
    const lrcs = await this.api.json(`metadata/lyrics?${asked}`, (raw) => (raw as { sheets?: string[] }).sheets ?? []);
    const found = lrcs.map(parseSheet).filter(isSynced);
    this.others.set(track.rpmId, found);
    return found;
  }

  async of(track: CloudTrack): Promise<LyricSheet> {
    const known = this.held.get(track.rpmId);
    if (known) return known;
    if (!track.title?.trim()) return EMPTY_SHEET;

    let sheet = parseSheet(await this.chosen(track.rpmId));
    if (!isSynced(sheet)) {
      try {
        sheet = (await this.all(track))[0] ?? EMPTY_SHEET;
      } catch (error) {
        // Decoration on a record that is playing. The next time this record is on screen it is asked again.
        if (error instanceof ApiError) return EMPTY_SHEET;
        throw error;
      }
    }
    this.held.set(track.rpmId, sheet);
    return sheet;
  }

  private async choose(track: CloudTrack, sheet: LyricSheet) {
    this.held.set(track.rpmId, sheet);
    // Told to the owner's other devices. A sheet that stays here is still the sheet on screen.
    await this.api
      .call(`cloud/lyric-sheet/${encodeURIComponent(track.rpmId)}`, { method: 'PUT', body: { lrc: sheet.source } })
      .catch(() => {});
  }

  // The next sheet this record has, for a reader who can see the words run ahead of the singer: the right words,
  // timed against another cut. It goes round the list. Null when there is nothing else to show.
  async another(track: CloudTrack, showing: LyricSheet): Promise<LyricSheet | null> {
    const all = await this.all(track).catch((error: unknown) => {
      if (error instanceof ApiError) return [];
      throw error;
    });
    const others = all.filter((sheet) => sheet.source !== showing.source);
    if (!others.length) return null;
    const at = all.findIndex((sheet) => sheet.source === showing.source);
    const next = at < 0 ? others[0]! : all[(at + 1) % all.length]!;
    await this.choose(track, next);
    return next;
  }

  // A sheet the listener has themselves. Null when the file carries no timings.
  async own(track: CloudTrack, lrc: string): Promise<LyricSheet | null> {
    const sheet = parseSheet(lrc);
    if (!isSynced(sheet)) return null;
    await this.choose(track, sheet);
    return sheet;
  }
}
