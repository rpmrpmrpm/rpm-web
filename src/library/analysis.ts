// What the shared recording pool knows about a track: the key, the tempo, the beat grid and the energy that a
// computer measured and published. The web app cannot measure a track itself, so the track details window
// shows these readings as the desktop's does.
//
// The pool is asked by the track's names: the hash of its tag-stripped file (the catalogue row's sha256) and
// its id. Each fact's value is JSON in which every number is written as text.

import type { Api } from '../api/http';
import type { CloudTrack } from '../api/wire';

// The generation of each fact this reader understands. A fact of another generation has a different shape
// or meaning, and is left out, as the desktop leaves it out.
const GENERATIONS = { key: 1, grid: 10, energy: 1 } as const;

interface Fact {
  field: string;
  generation: number;
  value: string | null;
  modelled?: boolean;
}

export interface Reading {
  camelot: string | null;
  keyName: string | null;
  keyConfidence: number | null;
  bpm: number | null;
  bpmConfidence: number | null;
  beatsPerBar: number | null;
  firstDownbeat: number | null;
  downbeatConfidence: number | null;
  energy: number | null;
  // Whether a trained model read the track, rather than signal analysis. Null when no fact says.
  modelled: boolean | null;
}

// Below this the desktop does not write the key into the file, and says so beside the reading.
export const KEY_TOO_CLOSE = 0.2;

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MINOR_HOURS = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];
const MAJOR_HOURS = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];

// The key a Camelot code stands for, in the notation a file's key tag uses ("Am", "C"), or null for a code that
// is not one. Notation and not words, so it reads the same in every language.
export function keyName(camelot: string): string | null {
  const match = /^(\d{1,2})([AB])$/i.exec(camelot.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minor = match[2]!.toUpperCase() === 'A';
  const tonic = (minor ? MINOR_HOURS : MAJOR_HOURS).indexOf(hour);
  return tonic < 0 ? null : `${NAMES[tonic]}${minor ? 'm' : ''}`;
}

const number = (value: unknown): number | null => {
  const read = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(read) ? read : null;
};

function parse(fact: Fact | undefined): Record<string, unknown> | null {
  if (!fact?.value) return null;
  try {
    const read = JSON.parse(fact.value) as unknown;
    return typeof read === 'object' && read !== null ? (read as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// The readings in a pool answer, or null when it has none this reader understands.
export function readingOf(facts: readonly Fact[]): Reading | null {
  const of = (field: keyof typeof GENERATIONS) => facts.find((fact) => fact.field === field && fact.generation === GENERATIONS[field]);
  const keyFact = of('key');
  const gridFact = of('grid');
  const energyFact = of('energy');
  const key = parse(keyFact);
  const grid = parse(gridFact);
  const energy = parse(energyFact);

  const camelot = typeof key?.camelot === 'string' && keyName(key.camelot) ? key.camelot.trim().toUpperCase() : null;
  const beats = typeof grid?.beats === 'string' ? grid.beats.split(',').filter((beat) => beat.trim()).length : 0;
  const bpm = number(grid?.bpm);
  const reading: Reading = {
    camelot,
    keyName: camelot ? keyName(camelot) : null,
    keyConfidence: camelot ? number(key?.confidence) : null,
    bpm: bpm !== null && bpm > 0 ? bpm : null,
    bpmConfidence: bpm !== null && bpm > 0 ? number(grid?.bpmConfidence) : null,
    beatsPerBar: beats > 0 ? number(grid?.beatsPerBar) : null,
    firstDownbeat: beats > 0 ? number(grid?.firstDownbeat) : null,
    downbeatConfidence: beats > 0 ? number(grid?.downbeatConfidence) : null,
    energy: number(energy?.intensity),
    modelled: [gridFact, keyFact, energyFact].find((fact) => fact && typeof fact.modelled === 'boolean')?.modelled ?? null,
  };
  return reading.camelot || reading.bpm || reading.beatsPerBar || reading.energy !== null ? reading : null;
}

// The names the pool knows a track by, as it writes them: "canon:" and the file hash, "rpm:" and the id.
export function keysOf(track: Pick<CloudTrack, 'rpmId' | 'sha256'>): string[] {
  const keys: string[] = [];
  if (/^[0-9a-f]{64}$/i.test(track.sha256 ?? '')) keys.push(`canon:${track.sha256!.toLowerCase()}`);
  if (track.rpmId) keys.push(`rpm:${track.rpmId.toLowerCase()}`);
  return keys;
}

export class Readings {
  constructor(private readonly api: Pick<Api, 'json'>) {}

  // What the pool knows about the track, or null when it knows nothing. A failed call throws: "not known" and
  // "could not ask" are different answers.
  async of(track: Pick<CloudTrack, 'rpmId' | 'sha256'>): Promise<Reading | null> {
    const keys = keysOf(track);
    if (!keys.length) return null;
    const query = keys.map((key) => `key=${encodeURIComponent(key)}`).join('&');
    const facts = await this.api.json(`recordings/facts?${query}`, (raw) => ((raw as { facts?: Fact[] }).facts ?? []) as Fact[]);
    return readingOf(facts);
  }
}
