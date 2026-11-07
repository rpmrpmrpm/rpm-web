// How loud a track is, by ITU-R BS.1770, and its true peak. Ported from LoudnessMeter and TruePeakDetector,
// so a track measured here plays at the same level as one measured on the desktop.

const BLOCK_SECONDS = 0.4;
const SUB_BLOCKS = 4;
const ABSOLUTE_GATE = -70;
const RELATIVE_GATE = 10;
const OFFSET = -0.691;
const PHASES = 4;
const TAPS = 12;
const CENTRE = TAPS / 2 - 1;

export const MEASURE_RATE = 48000;

function shelf(rate: number): number[] {
  const F0 = 1681.974450955533;
  const GAIN_DB = 3.999843853973347;
  const Q = 0.7071752369554196;
  const k = Math.tan((Math.PI * F0) / rate);
  const vh = 10 ** (GAIN_DB / 20);
  const vb = vh ** 0.4996667741545416;
  const a0 = 1 + k / Q + k * k;
  return [(vh + (vb * k) / Q + k * k) / a0, (2 * (k * k - vh)) / a0, (vh - (vb * k) / Q + k * k) / a0, (2 * (k * k - 1)) / a0, (1 - k / Q + k * k) / a0];
}

function highPass(rate: number): number[] {
  const F0 = 38.13547087602444;
  const Q = 0.5003270373238773;
  const k = Math.tan((Math.PI * F0) / rate);
  const den = 1 + k / Q + k * k;
  return [1, -2, 1, (2 * (k * k - 1)) / den, (1 - k / Q + k * k) / den];
}

const sinc = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));

function buildKernel(): Float64Array[] {
  return Array.from({ length: PHASES }, (_, phase) => {
    const taps = new Float64Array(TAPS);
    const offset = phase / PHASES;
    let sum = 0;
    for (let t = 0; t < TAPS; t++) {
      const angle = (2 * Math.PI * t) / (TAPS - 1);
      const window = 0.42 - 0.5 * Math.cos(angle) + 0.08 * Math.cos(2 * angle);
      taps[t] = sinc(CENTRE + offset - t) * window;
      sum += taps[t]!;
    }
    for (let t = 0; t < TAPS; t++) taps[t]! /= sum;
    return taps;
  });
}

const KERNEL = buildKernel();
const loudness = (meanSquare: number) => (meanSquare <= 0 ? -Infinity : OFFSET + 10 * Math.log10(meanSquare));

// Interleaved stereo.
export class LoudnessMeter {
  private readonly channels = 2;
  private readonly subBlockFrames: number;
  private readonly s1: number[];
  private readonly s2: number[];
  private readonly z1a = new Float64Array(2);
  private readonly z2a = new Float64Array(2);
  private readonly z1b = new Float64Array(2);
  private readonly z2b = new Float64Array(2);
  private readonly sums = new Float64Array(2);
  private readonly ring = new Float64Array(SUB_BLOCKS * 2);
  private readonly blocks: number[] = [];
  private readonly history = new Float32Array(TAPS * 2);
  private filled = 0;
  private ringAt = 0;
  private ringCount = 0;
  private at = 0;
  truePeak = 0;

  constructor(rate: number) {
    this.subBlockFrames = Math.max(1, Math.round((rate * BLOCK_SECONDS) / SUB_BLOCKS));
    this.s1 = shelf(rate);
    this.s2 = highPass(rate);
  }

  get hasSignal(): boolean {
    return this.blocks.length > 0;
  }

  add(samples: Float32Array, frames: number) {
    const { s1, s2, z1a, z2a, z1b, z2b, sums, channels } = this;
    const [a0, a1, a2, a3, a4] = s1 as [number, number, number, number, number];
    const [b0, b1, b2, b3, b4] = s2 as [number, number, number, number, number];

    this.addPeak(samples, frames);

    for (let frame = 0; frame < frames; frame++) {
      const at = frame * channels;
      for (let channel = 0; channel < channels; channel++) {
        const x = samples[at + channel]!;
        const y = a0 * x + z1a[channel]!;
        z1a[channel] = a1 * x - a3 * y + z2a[channel]!;
        z2a[channel] = a2 * x - a4 * y;
        const w = b0 * y + z1b[channel]!;
        z1b[channel] = b1 * y - b3 * w + z2b[channel]!;
        z2b[channel] = b2 * y - b4 * w;
        sums[channel]! += w * w;
      }
      if (++this.filled >= this.subBlockFrames) this.closeSubBlock();
    }
  }

  private addPeak(samples: Float32Array, frames: number) {
    const { history, channels } = this;
    let peak = this.truePeak;
    for (let frame = 0; frame < frames; frame++) {
      const at = frame * channels;
      for (let channel = 0; channel < channels; channel++) {
        const x = samples[at + channel]!;
        const size = Math.abs(x);
        if (size > peak) peak = size;
        history[this.at * channels + channel] = x;
      }
      this.at = (this.at + 1) % TAPS;

      for (let phase = 1; phase < PHASES; phase++) {
        const kernel = KERNEL[phase]!;
        for (let channel = 0; channel < channels; channel++) {
          let sum = 0;
          for (let t = 0; t < TAPS; t++) sum += kernel[t]! * history[((this.at + t) % TAPS) * channels + channel]!;
          const size = Math.abs(sum);
          if (size > peak) peak = size;
        }
      }
    }
    this.truePeak = peak;
  }

  private closeSubBlock() {
    const { channels, ring, sums } = this;
    const slot = this.ringAt * channels;
    for (let channel = 0; channel < channels; channel++) {
      ring[slot + channel] = sums[channel]! / this.filled;
      sums[channel] = 0;
    }
    this.ringAt = (this.ringAt + 1) % SUB_BLOCKS;
    this.filled = 0;
    if (this.ringCount < SUB_BLOCKS) this.ringCount++;
    if (this.ringCount < SUB_BLOCKS) return;

    let z = 0;
    for (let channel = 0; channel < channels; channel++) {
      let mean = 0;
      for (let sub = 0; sub < SUB_BLOCKS; sub++) mean += ring[sub * channels + channel]!;
      z += mean / SUB_BLOCKS;
    }
    this.blocks.push(z);
  }

  get integratedLufs(): number {
    let sum = 0;
    let count = 0;
    for (const z of this.blocks) {
      if (loudness(z) <= ABSOLUTE_GATE) continue;
      sum += z;
      count++;
    }
    if (!count) return -Infinity;

    const threshold = loudness(sum / count) - RELATIVE_GATE;
    let gated = 0;
    let kept = 0;
    for (const z of this.blocks) {
      const level = loudness(z);
      if (level <= ABSOLUTE_GATE || level <= threshold) continue;
      gated += z;
      kept++;
    }
    return kept ? loudness(gated / kept) : -Infinity;
  }
}
