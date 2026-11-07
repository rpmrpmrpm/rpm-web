// The ten-band equaliser with a bass and a treble shelf. Ported from Equalizer.cs: peaking filters of
// about an octave, in transposed direct form II, with one set of coefficients and a memory per channel.

export const EQ_BANDS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];

const BASS_HZ = 250;
const TREBLE_HZ = 4000;
const STAGES = EQ_BANDS.length + 2;
const BASS_STAGE = EQ_BANDS.length;
const TREBLE_STAGE = EQ_BANDS.length + 1;
const Q = 1;
export const MAX_GAIN_DB = 12;

const clamp = (value) => Math.min(MAX_GAIN_DB, Math.max(-MAX_GAIN_DB, value));

export class Equalizer {
  constructor(sampleRate, channels = 2) {
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.b0 = new Float64Array(STAGES);
    this.b1 = new Float64Array(STAGES);
    this.b2 = new Float64Array(STAGES);
    this.a1 = new Float64Array(STAGES);
    this.a2 = new Float64Array(STAGES);
    this.z1 = new Float64Array(STAGES * channels);
    this.z2 = new Float64Array(STAGES * channels);
    this.preamp = 1;
    this.bypass = true;
    this.setGains(0, new Array(EQ_BANDS.length).fill(0), 0, 0);
  }

  setGains(preampDb, bandsDb, bassDb = 0, trebleDb = 0) {
    let flat = Math.abs(preampDb) < 0.01;
    this.preamp = 10 ** (clamp(preampDb) / 20);

    EQ_BANDS.forEach((hertz, band) => {
      const gain = clamp(bandsDb[band] ?? 0);
      if (Math.abs(gain) >= 0.01) flat = false;
      this.peaking(band, hertz, gain);
    });

    const bass = clamp(bassDb);
    const treble = clamp(trebleDb);
    if (Math.abs(bass) >= 0.01 || Math.abs(treble) >= 0.01) flat = false;
    this.shelf(BASS_STAGE, BASS_HZ, bass, true);
    this.shelf(TREBLE_STAGE, TREBLE_HZ, treble, false);

    this.bypass = flat;
  }

  store(stage, b0, b1, b2, a0, a1, a2) {
    this.b0[stage] = b0 / a0;
    this.b1[stage] = b1 / a0;
    this.b2[stage] = b2 / a0;
    this.a1[stage] = a1 / a0;
    this.a2[stage] = a2 / a0;
  }

  peaking(band, hertz, gainDb) {
    const a = 10 ** (gainDb / 40);
    const w0 = (2 * Math.PI * hertz) / this.sampleRate;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * Q);
    this.store(band, 1 + alpha * a, -2 * cos, 1 - alpha * a, 1 + alpha / a, -2 * cos, 1 - alpha / a);
  }

  shelf(stage, hertz, gainDb, low) {
    const a = 10 ** (gainDb / 40);
    const w0 = (2 * Math.PI * hertz) / this.sampleRate;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / Math.SQRT2;
    const twoSqrtA = 2 * Math.sqrt(a) * alpha;
    const ap1 = a + 1;
    const am1 = a - 1;

    if (low) {
      this.store(stage, a * (ap1 - am1 * cos + twoSqrtA), 2 * a * (am1 - ap1 * cos), a * (ap1 - am1 * cos - twoSqrtA), ap1 + am1 * cos + twoSqrtA, -2 * (am1 + ap1 * cos), ap1 + am1 * cos - twoSqrtA);
    } else {
      this.store(stage, a * (ap1 + am1 * cos + twoSqrtA), -2 * a * (am1 + ap1 * cos), a * (ap1 + am1 * cos - twoSqrtA), ap1 - am1 * cos + twoSqrtA, 2 * (am1 - ap1 * cos), ap1 - am1 * cos - twoSqrtA);
    }
  }

  // After a seek or a change of track, so the tail of the old audio cannot carry into the new.
  reset() {
    this.z1.fill(0);
    this.z2.fill(0);
  }

  // Filters interleaved samples in place.
  process(samples) {
    if (this.bypass) return;
    const { b0, b1, b2, a1, a2, z1, z2, channels, preamp } = this;
    for (let i = 0; i < samples.length; i++) {
      const channel = channels === 1 ? 0 : i & 1;
      let x = samples[i];
      for (let stage = 0; stage < STAGES; stage++) {
        const memory = stage * channels + channel;
        const y = b0[stage] * x + z1[memory];
        z1[memory] = b1[stage] * x - a1[stage] * y + z2[memory];
        z2[memory] = b2[stage] * x - a2[stage] * y;
        x = y;
      }
      x *= preamp;
      samples[i] = x > 1 ? 1 : x < -1 ? -1 : x;
    }
  }
}

export const EQ_PRESETS = [
  ['Eq_Flat', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ['Eq_Rock', [5, 4, 2, 0, -1, 0, 2, 4, 5, 5]],
  ['Eq_Pop', [-1, 2, 4, 5, 4, 2, 0, -1, -1, -2]],
  ['Eq_Jazz', [4, 3, 1, 2, -1, -1, 0, 1, 3, 4]],
  ['Eq_Classical', [5, 4, 3, 2, -1, -1, 0, 2, 3, 4]],
  ['Eq_BassBoost', [7, 6, 5, 3, 1, 0, 0, 0, 0, 0]],
  ['Eq_Treble', [0, 0, 0, 0, 0, 2, 4, 6, 7, 7]],
  ['Eq_Vocal', [-2, -1, 1, 3, 4, 4, 3, 1, 0, -1]],
];
