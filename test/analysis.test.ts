import { describe, expect, test } from 'vitest';
import { analyze, bestPhase, fitGrid, foldBpm, labelSections, toCamelot, type Analysis } from '../src/analysis';
import { ensureTracks, essentia, readWav } from './audio';

describe('BPM / grid', () => {
  test('foldBpm folds octave errors into house range (R2.1)', () => {
    expect(foldBpm(62)).toBe(124);
    expect(foldBpm(250)).toBe(125);
    expect(foldBpm(126)).toBe(126);
  });
  test('fitGrid recovers period + phase from jittery ticks with outliers and gaps (R2.2)', () => {
    const p = 60 / 124, off = 0.21;
    const ticks = Array.from({ length: 200 }, (_, k) => off + 3 * p + k * p + Math.sin(k * 7.3) * 0.008).filter((_, k) => k % 17 !== 5);
    ticks.splice(50, 0, ticks[50] + p * 0.5); // half-beat outlier
    const g = fitGrid(ticks, 124.6);
    expect(g.bpm).toBeCloseTo(124, 1);
    expect(g.offset).toBeCloseTo(off, 2);
  });
});

describe('downbeat / phrase', () => {
  test('bestPhase finds where changes happen, prior breaks ties (R1.5)', () => {
    const nov = Array.from({ length: 64 }, (_, i) => (i % 4 === 2 ? 3 : 1));
    expect(bestPhase(nov, 4, 0)).toBe(2);
    expect(bestPhase(Array(64).fill(1), 4, 1)).toBe(1);
  });
  test('labelSections: intro / drop / breakdown / outro (R1.4)', () => {
    const quiet = [0.1, 0.1, 0.01], full = [0.2, 0.15, 0.04], brk = [0.1, 0.005, 0.02];
    const bars = [...Array(16).fill(quiet), ...Array(32).fill(full), ...Array(8).fill(brk), ...Array(16).fill(full), ...Array(8).fill(quiet)];
    expect(labelSections(bars)).toEqual(['intro', 'intro', 'drop', 'drop', 'drop', 'drop', 'breakdown', 'drop', 'drop', 'outro']);
  });
});

describe('key', () => {
  test('toCamelot (R3)', () => {
    expect(toCamelot('A', 'minor')).toBe('8A');
    expect(toCamelot('C', 'major')).toBe('8B');
    expect(toCamelot('Ab', 'minor')).toBe('1A');
    expect(toCamelot('G#', 'minor')).toBe('1A');
    expect(toCamelot('B', 'major')).toBe('1B');
    expect(toCamelot('F#', 'minor')).toBe('11A');
    expect(toCamelot('E', 'major')).toBe('12B');
  });
});

describe('full analysis on generated house tracks (known ground truth)', () => {
  ensureTracks();
  const cases: [string, number, string, number][] = [
    ['01_deep_122_8A', 122, '8A', 16], ['03_peak_126_10A', 126, '10A', 16], ['04_major_125_8B', 125, '8B', 16], ['05_clash_128_3A', 128, '3A', 15],
  ];
  for (const [name, bpm, cam, phrases] of cases) {
    test(name, () => {
      const { mono, sr } = readWav(`test-audio/${name}.wav`);
      const a: Analysis = analyze(mono, sr, essentia);
      expect(a.bpm).toBeCloseTo(bpm, 0);
      expect(Math.abs(a.beat0 - 0.37)).toBeLessThan(0.012); // first downbeat (10 ms)
      expect(a.camelot).toBe(cam);
      const intro = name.startsWith('05') ? 3 : 4;
      expect(a.sections.slice(0, phrases)).toEqual([...Array(intro).fill('intro'), 'drop', 'drop', 'drop', 'drop', 'breakdown', 'breakdown', 'drop', 'drop', 'drop', 'drop', 'outro', 'outro'].slice(0, phrases));
    }, 60000);
  }
});
