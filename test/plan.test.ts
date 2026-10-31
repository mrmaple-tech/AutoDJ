import { describe, expect, test } from 'vitest';
import type { Section } from '../src/analysis';
import { automation, barAt, buildLayer, keyShift, shiftCamelot, buildTimeline, chooseTransition, defaultTransitions, highlight, keyRelation, orderTracks, pairScore, startsAfter, valueAt, type Track } from '../src/plan';

const STD: Section[] = ['intro', 'intro', 'intro', 'intro', 'drop', 'drop', 'drop', 'drop', 'breakdown', 'breakdown', 'drop', 'drop', 'drop', 'drop', 'outro', 'outro'];
const mk = (id: string, bpm: number, camelot: string, energy: number): Track => ({
  id, name: id, bpm, camelot, energy, key: '', beat0: 0, bars: 128, sections: STD, energyCurve: Array(128).fill(0.8), gain: 1, duration: 128 * 240 / bpm,
});

describe('Camelot compatibility (R3)', () => {
  test.each([
    ['8A', '8A', 'perfect'], ['8A', '9A', 'adjacent'], ['8A', '7A', 'adjacent'], ['12A', '1A', 'adjacent'], ['1B', '12B', 'adjacent'],
    ['8A', '8B', 'relative'], ['8A', '9B', 'diagonal'], ['8B', '7A', 'diagonal'], ['8A', '10A', 'boost'], ['11A', '1A', 'boost'],
    ['8A', '6A', 'shift'], ['8A', '3A', 'clash'], ['8A', '7B', 'clash'], ['8A', '2B', 'clash'],
  ])('%s → %s is %s', (a, b, kind) => expect(keyRelation(a, b).kind).toBe(kind));

  test('scores rank safe > boost > clash', () => {
    const s = (b: string) => keyRelation('8A', b).score;
    expect(s('8A')).toBeGreaterThan(s('9A'));
    expect(s('9A')).toBeGreaterThan(s('10A'));
    expect(s('10A')).toBeGreaterThan(s('3A'));
  });

  test('pairScore prefers close BPM and compatible keys', () => {
    const a = mk('a', 124, '8A', 0.5);
    expect(pairScore(a, mk('b', 125, '9A', 0.55))).toBeGreaterThan(pairScore(a, mk('c', 125, '3A', 0.55)));
    expect(pairScore(a, mk('b', 125, '9A', 0.55))).toBeGreaterThan(pairScore(a, mk('d', 131, '9A', 0.55)));
  });
});

describe('ordering (R6)', () => {
  const ts = [mk('peak', 128, '10A', 0.95), mk('warm', 120, '8A', 0.1), mk('b1', 122, '8A', 0.4), mk('b2', 124, '9A', 0.6), mk('b3', 126, '9A', 0.8), mk('cool', 125, '10A', 0.7)];
  test('follows warm-up → peak → cool-down arc', () => {
    const o = orderTracks(ts).map((t) => t.id);
    expect(o[0]).toBe('warm');
    const peakIdx = o.indexOf('peak');
    expect(peakIdx).toBeGreaterThanOrEqual(3);
    expect(peakIdx).toBeLessThan(5);
  });
  test('locked tracks stay put', () => {
    const o = orderTracks(ts, new Set(['peak'])).map((t) => t.id);
    expect(o[0]).toBe('peak');
  });
});

describe('transitions (R5) + timeline (R2.5/R5.5) + automation (R4)', () => {
  test('type chosen from BPM gap and key', () => {
    const a = mk('a', 124, '8A', 0.5);
    expect(chooseTransition(a, mk('b', 124, '9A', 0.5), 0).type).toBe('blend');
    expect(chooseTransition(a, mk('b', 124, '9A', 0.5), 0).bars).toBe(32);
    expect(chooseTransition(a, mk('b', 124, '9A', 0.5), 0.8).bars).toBe(16);
    expect(chooseTransition(a, mk('b', 124, '10A', 0.5), 0).type).toBe('filter');
    expect(chooseTransition(a, mk('b', 124, '3A', 0.5), 0).type).toBe('filter'); // clash still gets a real mix
    expect(chooseTransition(a, mk('b', 131, '8A', 0.5), 0).type).toBe('blend'); // 5.6% gap: each deck ±2.8%
    expect(chooseTransition(a, mk('b', 136, '8A', 0.5), 0).type).toBe('echo');
  });

  const ts = [mk('a', 122, '8A', 0.2), mk('b', 126, '9A', 0.5), mk('c', 125, '3A', 0.6), mk('d', 138, '3A', 0.9)];
  const tr = defaultTransitions(ts);
  const decks = buildTimeline(ts, tr);
  const ev = automation(decks, tr);

  test('incoming phrase start lands on outgoing phrase boundary', () => {
    expect(tr.map((t) => t.type)).toEqual(['blend', 'filter', 'echo']);
    for (let i = 0; i < tr.length; i++) {
      const mix = tr[i].outBar + (startsAfter(tr[i].type) ? tr[i].bars : 0);
      expect(mix % 8).toBe(0);
      expect(tr[i].inBar % 8).toBe(0);
      const at = barAt(decks[i], mix);
      expect(decks[i + 1].start).toBeCloseTo(at, 9);
    }
  });

  test('tempo drifts gradually and stays within ±6%', () => {
    for (const d of decks) {
      for (const t of d.tempos) expect(Math.abs(t / d.track.bpm - 1)).toBeLessThanOrEqual(0.06 + 1e-9);
      for (let j = 1; j < d.tempos.length; j++) expect(Math.abs(d.tempos[j] - d.tempos[j - 1])).toBeLessThan(0.2);
    }
    // during the blend both decks share one tempo
    const w = tr[0];
    expect(decks[0].tempos[w.outBar - decks[0].entryBar]).toBeCloseTo(decks[1].tempos[0], 9);
  });

  test('never two full basslines at once (R4.1)', () => {
    for (let t = 0; t < decks[decks.length - 1].end; t += 0.05) {
      const loud = decks.filter((d, i) => t >= d.start && t < d.end && valueAt(ev, i, 'gain', t) > 0.05 && valueAt(ev, i, 'low', t) > -10);
      expect(loud.length, `t=${t.toFixed(2)}`).toBeLessThanOrEqual(1);
    }
  });
});

describe('mashup (R7)', () => {
  // energy peaks in the second drop (bars 80..112)
  const mkM = (id: string, bpm: number, cam: string) => ({ ...mk(id, bpm, cam, 0.5), energyCurve: Array.from({ length: 128 }, (_, i) => (i >= 80 && i < 112 ? 1 : 0.5)) });
  test('highlight = highest-energy drop window of ~50 s', () => {
    const h = highlight(mkM('a', 124, '8A'));
    expect(h.drop).toBe(80);
    expect(h.end - h.drop).toBe(24); // 50 s / 1.94 s per bar → 24 bars
  });
  test('drop into drop with real overlapping transitions, ~50 s per song', () => {
    const ts = [mkM('a', 124, '8A'), mkM('b', 125, '3A'), mkM('c', 126, '4A')].map((t) => ({ ...t, seg: highlight(t) }));
    const tr = defaultTransitions(ts);
    expect(tr.map((t) => t.type)).toEqual(['filter', 'blend']);
    const decks = buildTimeline(ts, tr);
    for (let i = 0; i < tr.length; i++) {
      expect(decks[i + 1].start).toBeLessThan(decks[i].end); // decks overlap = actual mix
      expect(barAt(decks[i + 1], ts[i + 1].seg!.drop)).toBeCloseTo(barAt(decks[i], ts[i].seg!.end), 9); // drop lands as highlight ends
    }
    const total = decks[decks.length - 1].end;
    expect(total / ts.length).toBeGreaterThan(40);
    expect(total / ts.length).toBeLessThan(70);
    const ev = automation(decks, tr);
    expect(valueAt(ev, 2, 'gain', total - 0.01)).toBeLessThan(0.05); // fades out
  });
});

describe('A × B mashup (R8)', () => {
  test('shiftCamelot / keyShift pick the smallest compatible pitch shift', () => {
    expect(shiftCamelot('8A', 1)).toBe('3A'); // A minor +1 st = Bb minor
    expect(shiftCamelot('8A', -1)).toBe('1A'); // G# minor
    expect(keyShift('8A', '9A')).toBe(0); // already compatible
    expect(keyShift('3A', '8A')).toBe(-1); // Bb minor → A minor
    expect(keyShift('8A', '10A')).toBe(2);
  });
  test('layers top drop on bed drop, one bassline, same tempo', () => {
    const e = Array.from({ length: 128 }, (_, i) => (i >= 32 && i < 64 ? 1 : 0.5));
    const top = { ...mk('top', 124, '3A', 0.5), energyCurve: e }, bed = { ...mk('bed', 126, '8A', 0.5), energyCurve: e };
    const r = buildLayer(top, bed);
    if ('error' in r) throw new Error(r.error);
    const [B, A] = r.decks;
    expect(A.semis).toBe(-1);
    expect(barAt(A, 32)).toBeCloseTo(barAt(B, 32), 9); // drop on drop
    expect(A.tempos[0]).toBe(B.tempos[0]);
    expect(B.start).toBeLessThan(A.start);
    expect(B.end - A.end).toBeCloseTo(8 * 240 / 125, 6); // bed plays one phrase alone at the end
    for (let t = A.start; t < A.end; t += 0.1) expect(valueAt(r.ev, 1, 'low', t)).toBeLessThanOrEqual(-40);
    expect('error' in buildLayer(top, mk('fast', 145, '8A', 0.5))).toBe(true);
  });
});
