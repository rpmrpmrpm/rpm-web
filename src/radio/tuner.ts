// A station on the air. A stream goes straight to its own audio element: a page cannot read a station's stream
// without the station's permission, and hardly any give it, so nothing goes through the chain, and no song title can
// be read out of it. The rest is RadioStreamSource: a dropped stream is a wait and another try, and only a station that
// stays silent is given up on.

import type { Volume } from '../audio/volume';
import { logosOf } from './logo';
import { displayOf, type RadioStation } from './station';

export type Air = 'off' | 'tuning' | 'on' | 'reconnecting' | 'lost';

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15000];
const MOST_TRIES = 8;

// A station is heard when it has run this long, as the desktop counts it, and the time goes out every five minutes.
export const NOTICED_SECONDS = 30;
export const HAND_OUT_SECONDS = 300;
const LONGEST_STEP_SECONDS = 5;

export interface Heard {
  station: RadioStation;
  seconds: number;
  newTune: boolean;
  at: number;
}

// How long a station was listened to. A step longer than a tick is a gap, which nobody heard.
export class StationCounter {
  private station: RadioStation | null = null;
  private heard = 0;
  private handedOut = 0;
  private last: number | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  read(station: RadioStation | null, playing: boolean): Heard | null {
    const at = this.now();
    const last = this.last;
    this.last = at;

    if (station?.uuid !== this.station?.uuid) {
      const finished = this.handOut();
      this.station = station;
      this.heard = 0;
      this.handedOut = 0;
      return finished;
    }
    if (!this.station || !playing || last === null) return null;

    const step = (at - last) / 1000;
    if (step > 0 && step <= LONGEST_STEP_SECONDS) this.heard += step;
    return this.heard - this.handedOut >= HAND_OUT_SECONDS ? this.handOut() : null;
  }

  handOut(): Heard | null {
    if (!this.station || this.heard < NOTICED_SECONDS || this.heard <= this.handedOut) return null;
    const part = { station: this.station, seconds: this.heard - this.handedOut, newTune: this.handedOut === 0, at: Math.floor(this.now() / 1000) };
    this.handedOut = this.heard;
    return part;
  }
}

export interface TunerHooks {
  // Whatever else was playing stops.
  starting(): void;
  tuned(station: RadioStation): void;
  heard(part: Heard): void;
}

export class Tuner {
  station: RadioStation | null = null;
  air: Air = 'off';
  wantsToPlay = false;
  list: RadioStation[] = [];

  private readonly audio: HTMLAudioElement;
  private readonly listeners = new Set<() => void>();
  private readonly counter = new StationCounter();
  private tries = 0;
  private retry: ReturnType<typeof setTimeout> | undefined;

  // The radio plays at the player's level: there is one volume. See Volume.
  constructor(
    private readonly hooks: TunerHooks,
    sound: Volume,
  ) {
    this.audio = new Audio();
    this.audio.preload = 'none';
    this.audio.setAttribute('playsinline', '');
    sound.drive(this.audio);
    this.audio.addEventListener('playing', () => {
      this.tries = 0;
      this.set('on');
    });
    this.audio.addEventListener('waiting', () => {
      if (this.air === 'on') this.set('reconnecting');
    });
    this.audio.addEventListener('error', () => this.dropped());
    this.audio.addEventListener('ended', () => this.dropped());
    this.audio.addEventListener('timeupdate', () => this.count());
  }

  onChange(listener: () => void) {
    this.listeners.add(listener);
  }

  private changed() {
    for (const listener of this.listeners) listener();
  }

  private set(air: Air) {
    this.air = air;
    this.changed();
  }

  private count() {
    const part = this.counter.read(this.station, !this.audio.paused);
    if (part) this.hooks.heard(part);
  }

  private open() {
    if (!this.station) return;
    this.audio.src = this.station.streamUrl;
    void this.audio.play().catch((error: unknown) => {
      // Replaced by a later press is nothing. Refused means a press is what it needs.
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        this.wantsToPlay = false;
        this.set('off');
      }
    });
  }

  private dropped() {
    if (!this.station || !this.wantsToPlay) return;
    clearTimeout(this.retry);
    if (this.tries >= MOST_TRIES) {
      this.wantsToPlay = false;
      this.set('lost');
      return;
    }
    this.set('reconnecting');
    this.retry = setTimeout(() => this.open(), BACKOFF_MS[Math.min(this.tries, BACKOFF_MS.length - 1)]);
    this.tries++;
  }

  // Runs inside the key press, because a browser allows play() only there.
  tune(station: RadioStation, list: RadioStation[] = this.list) {
    this.hooks.starting();
    clearTimeout(this.retry);
    this.count();
    this.station = station;
    this.list = list;
    this.tries = 0;
    this.wantsToPlay = true;
    this.set('tuning');
    this.open();
    this.publish();
    this.hooks.tuned(station);
  }

  // A live stream has nothing to come back to, so a pause lets go of it and a play tunes in again.
  toggle() {
    if (!this.station) return;
    if (this.wantsToPlay) {
      this.wantsToPlay = false;
      clearTimeout(this.retry);
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
      this.count();
      this.changed();
      return;
    }
    this.tune(this.station);
  }

  stop() {
    if (!this.station) return;
    clearTimeout(this.retry);
    this.wantsToPlay = false;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    const part = this.counter.read(null, false);
    if (part) this.hooks.heard(part);
    this.station = null;
    this.set('off');
  }

  private step(by: number) {
    if (!this.station || !this.list.length) return;
    const at = this.list.findIndex((row) => row.uuid === this.station!.uuid);
    this.tune(this.list[(at + by + this.list.length) % this.list.length]!);
  }

  next() {
    this.step(1);
  }

  previous() {
    this.step(-1);
  }

  private publish() {
    if (!('mediaSession' in navigator) || !this.station) return;
    const logo = logosOf(this.station.favicon, this.station.otherLogos)[0];
    navigator.mediaSession.metadata = new MediaMetadata({ title: displayOf(this.station), artist: this.station.country ?? '', artwork: logo ? [{ src: logo }] : [] });
  }
}
