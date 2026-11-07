export const EQ_BANDS: number[];
export const MAX_GAIN_DB: number;
export const EQ_PRESETS: [string, number[]][];

export class Equalizer {
  constructor(sampleRate: number, channels?: number);
  bypass: boolean;
  setGains(preampDb: number, bandsDb: number[], bassDb?: number, trebleDb?: number): void;
  reset(): void;
  process(samples: Float32Array | Float64Array): void;
}
