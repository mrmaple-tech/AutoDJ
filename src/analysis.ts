// Track analysis: beat grid, downbeats, phrases/sections, key, energy.
// Pure functions + one entry point that takes an essentia.js instance (browser worker or Node tests).

export type Section = 'intro' | 'drop' | 'breakdown' | 'outro';

export interface Analysis {
  bpm: number;
  beat0: number; // time (s) of a phrase-start downbeat; bar k starts at beat0 + k*barLen. May be negative.
  bars: number; // full bars from beat0 to end of audio
  sections: Section[]; // one per 8-bar phrase (R1.2)
  energyCurve: number[]; // per bar, 0..1
  energy: number; // track energy 0..1
  key: string; // e.g. "A minor"
  camelot: string; // e.g. "8A"
  gain: number; // loudness-match gain (R4.6)
  duration: number;
}

export const PHRASE = 8;
export const barLen = (bpm: number) => 240 / bpm;

/** R2.1: fold octave errors into house range. */
export function foldBpm(bpm: number) {
  while (bpm < 100) bpm *= 2;
  while (bpm >= 150) bpm /= 2;
  return bpm;
}

/** R2.2: fit one constant grid (period + phase) to beat ticks, ignoring outliers. */
export function fitGrid(ticks: number[], bpm: number) {
  let period = 60 / bpm;
  const iv = ticks.slice(1).map((t, i) => t - ticks[i]).filter((d) => Math.abs(d / period - 1) < 0.15);
  if (iv.length) period = iv.reduce((s, d) => s + d, 0) / iv.length; // start: mean of plausible beat intervals
  let a = ticks[0] ?? 0;
  for (let iter = 0; iter < 3; iter++) {
    const pts = ticks.map((t) => [Math.round((t - a) / period), t]).filter(([k, t]) => Math.abs(t - (a + k * period)) < period * 0.25);
    if (pts.length < 8) break;
    const n = pts.length, mk = pts.reduce((s, p) => s + p[0], 0) / n, mt = pts.reduce((s, p) => s + p[1], 0) / n;
    const cov = pts.reduce((s, [k, t]) => s + (k - mk) * (t - mt), 0), vk = pts.reduce((s, [k]) => s + (k - mk) ** 2, 0);
    period = cov / vk;
    a = mt - period * mk;
  }
  const offset = ((a % period) + period) % period; // first beat >= 0
  return { bpm: 60 / period, offset };
}

/** Per-beat features: [rms, low (<~150 Hz), high (first-difference)] energies. */
export function beatFeatures(x: Float32Array, sr: number, offset: number, period: number) {
  const n = Math.floor((x.length / sr - offset) / period);
  const c = 1 - Math.exp((-2 * Math.PI * 150) / sr);
  let lp1 = 0, lp2 = 0, prev = 0;
  const f: number[][] = [];
  let b = 0, acc = [0, 0, 0], cnt = 0;
  let next = Math.round((offset + period) * sr);
  for (let i = Math.round(offset * sr); i < x.length && b < n; i++) {
    const v = x[i];
    lp1 += c * (v - lp1); lp2 += c * (lp1 - lp2);
    acc[0] += v * v; acc[1] += lp2 * lp2; acc[2] += (v - prev) ** 2; prev = v; cnt++;
    if (i + 1 >= next) { f.push(acc.map((s) => Math.sqrt(s / cnt))); acc = [0, 0, 0]; cnt = 0; b++; next = Math.round((offset + (b + 1) * period) * sr); }
  }
  return f;
}

const novelty = (f: number[][]) => f.map((v, i) => (i === 0 ? 0 : v.reduce((s, x, j) => s + Math.abs(Math.log(x + 1e-4) - Math.log(f[i - 1][j] + 1e-4)), 0)));

/** Pick the phase (0..period-1) where novelty concentrates, with a prior on `first` (R1.5). */
export function bestPhase(nov: number[], period: number, first: number) {
  const s = Array.from({ length: period }, (_, p) => { let sum = 0, c = 0; for (let i = p; i < nov.length; i += period) { sum += nov[i]; c++; } return c ? sum / c : 0; });
  const max = Math.max(...s);
  s[first % period] += 0.25 * max; // ponytail: fixed prior weight, tune if real tracks mis-detect downbeats
  return s.indexOf(Math.max(...s));
}

/** R1.4: label 8-bar phrases from per-bar [rms, low, high] features. */
export function labelSections(barFeat: number[][]): Section[] {
  const phr: number[][] = [];
  for (let i = 0; i < barFeat.length; i += PHRASE) {
    const sl = barFeat.slice(i, i + PHRASE);
    phr.push([0, 1, 2].map((j) => sl.reduce((s, v) => s + v[j], 0) / sl.length));
  }
  const mx = [0, 1, 2].map((j) => Math.max(...phr.map((p) => p[j]), 1e-9));
  const score = phr.map((p) => 0.4 * (p[0] / mx[0]) + 0.3 * (p[1] / mx[1]) + 0.3 * (p[2] / mx[2]));
  const isDrop = score.map((v) => v >= 0.85); // ponytail: naive threshold, fine for EDM-mastered house
  const first = isDrop.indexOf(true), last = isDrop.lastIndexOf(true);
  return phr.map((_, i) => (first < 0 ? (i < phr.length / 2 ? 'intro' : 'outro') : i < first ? 'intro' : i > last ? 'outro' : isDrop[i] ? 'drop' : 'breakdown'));
}

const PCS: Record<string, number> = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };

/** Musical key → Camelot code (R3). */
export function toCamelot(key: string, scale: string) {
  const pc = PCS[key];
  return scale === 'minor' ? `${((pc * 7 + 4) % 12) + 1}A` : `${((pc * 7 + 7) % 12) + 1}B`;
}

/** Full analysis. `essentia` is an initialised essentia.js `Essentia` instance. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function analyze(mono: Float32Array, sr: number, essentia: any, progress: (p: number) => void = () => {}): Analysis {
  const duration = mono.length / sr;
  // Beats from a ~2-minute window: one constant grid covers the whole track (R2.2).
  const w0 = Math.floor(Math.max(0, duration / 2 - 60) * sr);
  const win = mono.subarray(w0, Math.min(mono.length, w0 + 120 * sr));
  const vec = essentia.arrayToVector(win);
  const r = essentia.RhythmExtractor2013(vec, 208, 'degara', 40);
  const ticks = Array.from(essentia.vectorToArray(r.ticks) as Float32Array, (t) => t + w0 / sr);
  vec.delete?.();
  progress(0.4);
  const grid = fitGrid(ticks, foldBpm(r.bpm)); // off-grid ticks (octave errors) are dropped as outliers
  const bpm = Math.round(grid.bpm * 100) / 100;
  const period = 60 / bpm;

  const bf = beatFeatures(mono, sr, grid.offset, period);
  const loudest = Math.max(...bf.map((v) => v[0]));
  const firstBeat = Math.max(0, bf.findIndex((v) => v[0] > loudest * 0.05));
  const dPhase = bestPhase(novelty(bf), 4, firstBeat); // R1.5 downbeat
  const barFeat: number[][] = [];
  for (let i = dPhase; i + 4 <= bf.length; i += 4) barFeat.push([0, 1, 2].map((j) => (bf[i][j] + bf[i + 1][j] + bf[i + 2][j] + bf[i + 3][j]) / 4));
  const firstBar = Math.max(0, barFeat.findIndex((v) => v[0] > loudest * 0.05));
  const q = bestPhase(novelty(barFeat), PHRASE, firstBar); // R1.5 phrase start
  const shift = q === 0 ? 0 : q - PHRASE; // bar index of the phrase grid origin (<= 0)
  const beat0 = grid.offset + dPhase * period + shift * 4 * period;
  const allBars = [...Array(-shift).fill([0, 0, 0]), ...barFeat];
  progress(0.6);

  const k = essentia.KeyExtractor(essentia.arrayToVector(mono), true, 4096, 4096, 12, 3500, 60, 25, 0.2, 'edma', sr);
  progress(0.95);
  const rmsMax = Math.max(...allBars.map((v) => v[0]), 1e-9);
  const sections = labelSections(allBars);
  const loud = allBars.filter((_, i) => sections[Math.floor(i / PHRASE)] === 'drop');
  const dropRms = Math.sqrt(loud.reduce((s, v) => s + v[0] ** 2, 0) / Math.max(1, loud.length)) || rmsMax;
  const bright = loud.reduce((s, v) => s + v[2] / (v[0] + 1e-9), 0) / Math.max(1, loud.length);
  // ponytail: heuristic energy (loudness + brightness + tempo); swap for a trained model if ratings feel off
  const energy = Math.min(1, Math.max(0, 0.45 * ((20 * Math.log10(dropRms) + 18) / 12) + 0.3 * Math.min(1, bright / 0.6) + 0.25 * ((bpm - 115) / 15)));
  return {
    bpm, beat0, bars: allBars.length, sections,
    energyCurve: allBars.map((v) => v[0] / rmsMax),
    energy, key: `${k.key} ${k.scale}`, camelot: toCamelot(k.key, k.scale),
    gain: Math.min(4, 0.25 / dropRms), // R4.6: match drop loudness to ~-12 dBFS RMS
    duration,
  };
}
