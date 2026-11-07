// What counts as a listen. Ported from Listen and ListenTally, so a play means the same in every app.

export const SHORTEST_SECONDS = 30;
export const ENOUGH_SECONDS = 4 * 60;
const RESTART_WITHIN_SECONDS = 0.5;

export function listenCounts(heard: number, length: number): boolean {
  if (length < SHORTEST_SECONDS || heard <= 0) return false;
  return heard >= Math.min(length / 2, ENOUGH_SECONDS);
}

export interface Listened {
  track: string;
  heardSeconds: number;
  lengthSeconds: number;
}

// Follows one track from first sound to last. A seek continues the same listen, and a restart of the same
// track begins a new one.
export class ListenTally {
  private track: string | null = null;
  private session = 0;
  private banked = 0;
  private stretch = 0;
  private length = 0;

  private get heard(): number {
    return this.banked + this.stretch;
  }

  read(track: string | null, session: number, startSeconds: number, heardSeconds: number, lengthSeconds: number): Listened | null {
    let finished: Listened | null = null;

    const moved = track !== this.track;
    const replayed = !moved && session !== this.session && startSeconds <= RESTART_WITHIN_SECONDS;

    if (moved || replayed) {
      if (this.track !== null) finished = { track: this.track, heardSeconds: this.heard, lengthSeconds: this.length };
      this.track = track;
      this.banked = 0;
      this.stretch = 0;
      this.length = 0;
    } else if (session !== this.session) {
      this.banked += this.stretch;
      this.stretch = 0;
    }

    this.session = session;
    if (track === null) return finished;

    // Never lowered within a stretch: a reading taken early must not discard what was earned.
    if (heardSeconds > this.stretch) this.stretch = heardSeconds;
    if (lengthSeconds > 0) this.length = lengthSeconds;
    return finished;
  }

  settle(): Listened | null {
    if (this.track === null) return null;
    const finished = { track: this.track, heardSeconds: this.heard, lengthSeconds: this.length };
    this.track = null;
    this.banked = 0;
    this.stretch = 0;
    this.length = 0;
    return finished;
  }
}
