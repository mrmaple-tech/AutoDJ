import { expect, test } from 'vitest';
import { stretch, encodeWav, encodeMp3 } from '../src/dsp';
import { barLen } from '../src/analysis';

// Click on every downbeat of a 124 BPM track, stretched with a tempo ramp: clicks must land on the new grid.
test('stretch keeps downbeats on the planned grid (R2.4/R2.5)', () => {
  const sr = 44100, bpm = 124, beat0 = 0.25, bars = 40;
  const n = Math.ceil((beat0 + bars * barLen(bpm) + 1) * sr);
  const L = new Float32Array(n);
  for (let b = 0; b < bars; b++) { const s = Math.round((beat0 + b * barLen(bpm)) * sr); for (let i = 0; i < 200; i++) L[s + i] = Math.sin(i * 0.3) * Math.exp(-i / 50); }
  const tempos = Array.from({ length: 32 }, (_, j) => 122 + (j / 31) * 6); // 122 → 128 drift
  const t0 = performance.now();
  const [oL] = stretch(L, L, sr, beat0, bpm, 4, tempos);
  console.log('stretch of', (32 * barLen(bpm)).toFixed(0), 's took', (performance.now() - t0).toFixed(0), 'ms');
  let t = 0, worst = 0;
  const errs: number[] = [];
  for (let j = 0; j < 32; j++) {
    const exp = Math.round(t * sr);
    let best = exp, bv = 0;
    for (let k = Math.max(0, exp - 2000); k < Math.min(oL.length, exp + 2000); k++) if (Math.abs(oL[k]) > bv) { bv = Math.abs(oL[k]); best = k; }
    errs.push(best - exp); worst = Math.max(worst, Math.abs(best - exp));
    t += barLen(tempos[j]);
  }
  console.log('downbeat errors (frames):', errs.join(' '));
  expect(worst / sr).toBeLessThan(0.005);
});

test('pitch shift keeps timing and moves pitch (R8.2)', () => {
  const sr = 44100, n = sr * 4;
  const x = Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / sr) * 0.5);
  const [y] = stretch(x, x, sr, 0, 120, 0, [120, 120], 3); // 2 bars, +3 semitones
  expect(y.length).toBe(n);
  let zc = 0; // count zero crossings in the middle second → frequency
  for (let i = sr + 1; i < 2 * sr; i++) if (y[i - 1] < 0 && y[i] >= 0) zc++;
  expect(zc).toBeGreaterThan(440 * 2 ** (3 / 12) - 8);
  expect(zc).toBeLessThan(440 * 2 ** (3 / 12) + 8);
});

test('encoders produce valid files', () => {
  const x = Float32Array.from({ length: 44100 }, (_, i) => Math.sin(i / 10) * 1.5);
  const wav = new DataView(encodeWav(x, x, 44100));
  expect(wav.getUint32(40, true)).toBe(44100 * 4);
  expect(wav.getInt16(44 + 4 * 16, true)).toBe(32767); // clipped, not wrapped
  const mp3 = encodeMp3(x, x, 44100);
  expect(mp3.size).toBeGreaterThan(1000);
});
