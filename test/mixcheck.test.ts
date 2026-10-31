// Manual check (skipped unless the e2e export exists): are both decks phase-locked inside a blend?
import { test } from 'vitest';
import { existsSync } from 'node:fs';
import { fitGrid } from '../src/analysis';
import { essentia, readWav } from './audio';

test.skipIf(!existsSync('test-audio/out/mix.wav'))('exported blend has no flams', () => {
  const { mono, sr } = readWav('test-audio/out/mix.wav');
  for (const [name, a, b] of [['solo', 60, 110], ['blend 1→2', 195, 245], ['blend 2→3', 390, 430], ['cut 3→4', 570, 610]] as const) {
    const seg = mono.subarray(a * sr, b * sr);
    const r = essentia.RhythmExtractor2013(essentia.arrayToVector(seg), 208, 'degara', 40);
    const ticks = Array.from(essentia.vectorToArray(r.ticks) as Float32Array);
    const g = fitGrid(ticks, r.bpm), p = 60 / g.bpm;
    const res = ticks.map((t) => { const d = ((t - g.offset) / p) % 1; return Math.min(d, 1 - d) * p * 1000; });
    // flam detector: low-band envelope autocorrelation at 10–60 ms relative to 0
    let lp = 0; const env = Float32Array.from(seg, (v) => (lp += 0.02 * (v * v - lp)));
    const ac = (lag: number) => { let s = 0; for (let i = 0; i + lag < env.length; i += 4) s += env[i] * env[i + lag]; return s; };
    const a0 = ac(0), flam = Math.max(...[10, 20, 30, 40, 60].map((ms) => ac(Math.round((ms / 1000) * sr)) / a0));
    console.log(name.padEnd(10), 'bpm', g.bpm.toFixed(2), 'tick residual ms (mean/max)', (res.reduce((s, x) => s + x, 0) / res.length).toFixed(1), Math.max(...res).toFixed(1), 'ac@10-60ms', flam.toFixed(2));
  }
});
