// Recognise: what a file is, from its audio. The fingerprint is made in the browser and the question goes
// to rpm's API, which asks the rpm database and then AcoustID. No audio leaves the browser for those. The
// advanced layer hears a short clip, and the server decides who may use it. These are the rules of
// TrackIdentifier and MainModel.RunRecognitionAsync, with one change: the advanced layer failing leaves
// the run on the basic layers, because those still work.

import { ApiError, type Api } from '../api/http';
import type { Fingerprint } from './import.worker';
import type { ImportMedia } from './media';
import type { ImportQueue, ImportRow } from './queue';

const MIN_SCORE = 0.5;
const CLIP_KILOBITS = 128;
const CLIP_SECONDS = 15;
const BASE64_BLOCK = 0x8000;

export interface Answer {
  title: string;
  artist: string;
  album: string | null;
  year: number;
  score: number;
  source: string;
}

export interface Outcome {
  row: ImportRow;
  // Read before the answer is applied: "was Track 04" is what the person is here for.
  wasArtist: string | null;
  wasTitle: string | null;
  answer: Answer | null;
  source: string | null;
  score: number;
  failed: boolean;
}

export interface Report {
  outcomes: Outcome[];
  attempted: number;
  recognised: number;
  // A strings.json key: why the run ended early.
  stopped: string | null;
  // A strings.json key: what the run carried on without.
  note: string | null;
  sentToAudD: number;
  identifiedByAudD: number;
}

export interface Watch {
  started(index: number, row: ImportRow): void;
  landed(outcome: Outcome): void;
}

// The layer is for supporters. A refusal somebody gave, which is not the same as "not in the database".
class SupportersOnly extends Error {}

// Nothing was looked up, so nothing was ruled out.
class Unavailable extends Error {}

interface Said {
  source: string | null;
  answer: Answer | null;
}

interface WireTrack {
  title: string;
  artist: string;
  album?: string | null;
  year?: number;
  score?: number;
}

function readSaid(raw: unknown): Said {
  const body = raw as { status?: string; source?: string | null; track?: WireTrack | null };
  const source = body.source ?? null;
  if (body.status !== 'matched' || !body.track) return { source, answer: null };
  const { title, artist, album, year, score } = body.track;
  return { source, answer: { title, artist, album: album ?? null, year: year ?? 0, score: score ?? 0, source: source ?? 'own-db' } };
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += BASE64_BLOCK) binary += String.fromCharCode(...bytes.subarray(at, at + BASE64_BLOCK));
  return btoa(binary);
}

const sure = (answer: Answer | null): Answer | null => (answer && answer.score >= MIN_SCORE ? answer : null);

// A third of the way in, past an intro or a fade, and early enough that the whole clip is inside the track.
export const clipStart = (duration: number): number => Math.max(0, Math.min(duration / 3, Math.max(0, duration - CLIP_SECONDS - 1)));

// "Artist · Title", or whichever half exists, or null when there is neither.
export function nameOf(artist: string | null | undefined, title: string | null | undefined): string | null {
  const parts = [artist, title].map((part) => part?.trim()).filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

export class Recogniser {
  constructor(
    private readonly api: Api,
    private readonly media: ImportMedia,
    private readonly queue: ImportQueue,
  ) {}

  private async ask(path: string, body: unknown, signal: AbortSignal): Promise<Said> {
    try {
      return await this.api.json(path, readSaid, { method: 'POST', body, signal });
    } catch (error) {
      if (error instanceof ApiError && (error.status === 402 || error.status === 403)) throw new SupportersOnly();
      if (error instanceof ApiError && (error.status === 502 || error.status === 503)) throw new Unavailable();
      throw error;
    }
  }

  private identify(print: Fingerprint, signal: AbortSignal) {
    return this.ask('identify', { fingerprint: print.text, rawFingerprint: print.raw, durationSeconds: print.seconds }, signal);
  }

  private async identifyClip(row: ImportRow, print: Fingerprint, signal: AbortSignal) {
    const clip = await this.media.clip(row.file, CLIP_KILOBITS, clipStart(print.seconds), CLIP_SECONDS);
    return this.ask('identify-clip', { clipBase64: base64(clip), rawFingerprint: print.raw, durationSeconds: print.seconds }, signal);
  }

  // One track at a time, and each answer is on its row as soon as it lands, so a run that is cancelled or
  // loses the network keeps the names it found.
  async run(rows: readonly ImportRow[], advanced: boolean, watch: Watch, signal: AbortSignal): Promise<Report> {
    const report: Report = { outcomes: [], attempted: rows.length, recognised: 0, stopped: null, note: null, sentToAudD: 0, identifiedByAudD: 0 };
    const record = (outcome: Outcome) => {
      report.outcomes.push(outcome);
      watch.landed(outcome);
    };

    let reach = advanced;

    for (const [index, row] of rows.entries()) {
      if (signal.aborted) {
        report.stopped = 'Review_RecognizeCancelled';
        break;
      }
      watch.started(index, row);
      const was = { wasArtist: row.tags.Artist ?? null, wasTitle: row.tags.Title ?? null };

      try {
        const print = await this.media.fingerprint(row.file);

        // The basic layers always go first. A track they can name must never go out to the paid layer.
        let answer = sure((await this.identify(print, signal)).answer);

        if (reach && !answer) {
          try {
            const said = await this.identifyClip(row, print, signal);
            answer = sure(said.answer);
            if (said.source === 'audd') {
              report.sentToAudD++;
              if (said.answer) report.identifiedByAudD++;
            }
          } catch (error) {
            if (!(error instanceof SupportersOnly || error instanceof Unavailable)) throw error;
            reach = false;
            report.note = error instanceof SupportersOnly ? 'Recognize_AdvancedRefused' : 'Recognize_AdvancedDown';
          }
        }

        if (answer) {
          this.queue.applyRecognition(row, answer);
          report.recognised++;
        }
        record({ row, ...was, answer, source: answer?.source ?? null, score: answer?.score ?? 0, failed: false });
      } catch (error) {
        if (signal.aborted) {
          report.stopped = 'Review_RecognizeCancelled';
          break;
        }

        // The service cannot look anything up, and the rest of the list would say the same.
        if (error instanceof Unavailable) {
          report.stopped = 'Recognize_Unavailable';
          break;
        }

        // One bad file must not sink the batch, and it is not the same as "not recognised".
        record({ row, ...was, answer: null, source: null, score: 0, failed: true });
      }
    }
    return report;
  }
}
