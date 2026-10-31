// Mix planning: Camelot scoring, track ordering, transition choice/placement, tempo drift, automation.
// Pure data in, pure data out — the audio engine just executes the result.
import { barLen, PHRASE, type Analysis } from './analysis';

export interface Track extends Analysis { id: string; name: string }
export type TType = 'blend' | 'filter' | 'echo' | 'cut';
export interface Transition { type: TType; bars: number; outBar: number; inBar: number; reason: string }

export const MAX_STRETCH = 0.06; // R2.3
const KILL = -40; // dB, EQ kill (R4.1)

// ---------- R3: Camelot ----------
export type KeyKind = 'perfect' | 'adjacent' | 'relative' | 'diagonal' | 'boost' | 'shift' | 'clash';
export function keyRelation(a: string, b: string): { kind: KeyKind; score: number } {
  const na = parseInt(a), nb = parseInt(b), la = a.slice(-1), lb = b.slice(-1);
  const d = ((nb - na + 18) % 12) - 6; // -6..5, clockwise positive
  if (la === lb) {
    if (d === 0) return { kind: 'perfect', score: 1 }; // R3.1
    if (Math.abs(d) === 1) return { kind: 'adjacent', score: 0.9 }; // R3.2
    if (d === 2) return { kind: 'boost', score: 0.6 }; // R3.4
    if (d === -2) return { kind: 'shift', score: 0.45 }; // R3.4 (reverse: energy drop)
  } else {
    if (d === 0) return { kind: 'relative', score: 0.85 }; // R3.3
    if ((la === 'A' && d === 1) || (la === 'B' && d === -1)) return { kind: 'diagonal', score: 0.7 }; // R3.5
  }
  return { kind: 'clash', score: 0.1 }; // R3.6
}

export const bpmGap = (a: number, b: number) => Math.abs(a - b) / Math.min(a, b);

/** R6.4 pairwise compatibility, 0..1. */
export function pairScore(a: Track, b: Track) {
  const bpm = Math.max(0, 1 - bpmGap(a.bpm, b.bpm) / (2 * MAX_STRETCH)); // R2.3
  const key = keyRelation(a.camelot, b.camelot).score; // R3
  const flow = 1 - Math.min(1, Math.abs(b.energy - a.energy - 0.05) * 3); // R6.2 small rises
  return 0.4 * bpm + 0.4 * key + 0.2 * flow;
}

/** R6.1 target energy (0..1) at position x in 0..1: build to a peak at ~70%, short cool-down. */
export const arcTarget = (x: number) => (x <= 0.7 ? 0.1 + 0.9 * (x / 0.7) : 1 - 1.2 * (x - 0.7));

function orderCost(ts: Track[], rank: Map<string, number>) {
  let c = 0;
  for (let i = 0; i < ts.length; i++) {
    if (i) c += 1 - pairScore(ts[i - 1], ts[i]);
    c += 3 * (rank.get(ts[i].id)! - arcTarget(ts.length > 1 ? i / (ts.length - 1) : 0)) ** 2;
  }
  return c;
}

/** R6.4: order tracks; ids in `locked` keep their current index. Simulated annealing over swaps. */
export function orderTracks(tracks: Track[], locked: Set<string> = new Set()): Track[] {
  const byE = [...tracks].sort((a, b) => a.energy - b.energy);
  const rank = new Map(byE.map((t, i) => [t.id, tracks.length > 1 ? i / (tracks.length - 1) : 0]));
  const free = tracks.map((t, i) => (locked.has(t.id) ? -1 : i)).filter((i) => i >= 0);
  // start from energy-sorted order on the free slots
  let cur = [...tracks];
  const freeSorted = free.map((i) => tracks[i]).sort((a, b) => a.energy - b.energy);
  free.forEach((slot, k) => (cur[slot] = freeSorted[k]));
  if (free.length < 2) return cur;
  let cost = orderCost(cur, rank), best = cur, bestCost = cost;
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const iters = 4000 * free.length; // ponytail: SA is plenty for set sizes (<100 tracks)
  for (let it = 0; it < iters; it++) {
    const temp = 0.5 * (1 - it / iters) + 1e-4;
    const i = free[Math.floor(rnd() * free.length)], j = free[Math.floor(rnd() * free.length)];
    if (i === j) continue;
    const nxt = [...cur];
    [nxt[i], nxt[j]] = [nxt[j], nxt[i]];
    const c = orderCost(nxt, rank);
    if (c < cost || rnd() < Math.exp((cost - c) / temp)) {
      cur = nxt; cost = c;
      if (c < bestCost) { best = nxt; bestCost = c; }
    }
  }
  return best;
}

// ---------- R5: transitions ----------
const phraseStart = (t: Track, s: string, last = false) => {
  const i = last ? t.sections.lastIndexOf(s as never) : t.sections.indexOf(s as never);
  return i < 0 ? -1 : i * PHRASE;
};
/** Bar where the outro starts (end of last drop), R5.6. */
export function outroBar(t: Track) {
  let i = t.sections.length;
  while (i > 0 && t.sections[i - 1] === 'outro') i--;
  return Math.min(i * PHRASE, Math.max(0, t.bars - PHRASE));
}
const startsAfter = (type: TType) => type === 'echo' || type === 'cut'; // incoming starts at window end

/** Place a transition of a given type/length (R5.5: phrase-aligned, downbeat on downbeat). */
export function place(a: Track, b: Track, type: TType, bars: number, outBar?: number): Omit<Transition, 'reason'> {
  const firstDrop = Math.max(0, phraseStart(b, 'drop'));
  if (outBar === undefined) {
    outBar = outroBar(a);
    if (outBar + bars > a.bars) outBar = Math.floor((a.bars - bars) / PHRASE) * PHRASE;
  }
  outBar = Math.max(0, Math.min(outBar, a.bars - bars));
  // R5.6: time the blend so the incoming drop lands as the window ends; a cut jumps straight to the drop (R5.4)
  const inBar = type === 'cut' ? firstDrop : type === 'echo' ? 0 : Math.max(0, firstDrop - bars);
  return { type, bars, outBar, inBar };
}

/** R5: pick the transition type from tempo gap, key relation and set position. */
export function chooseTransition(a: Track, b: Track, pos: number): Transition {
  const gap = bpmGap(a.bpm, b.bpm);
  const rel = keyRelation(a.camelot, b.camelot);
  const g = `${(gap * 100).toFixed(1)}% BPM gap`;
  if (gap > MAX_STRETCH) return { ...place(a, b, 'echo', 1), reason: `R2.6/R5.3: ${g} too wide to beatmatch → echo out` };
  if (rel.kind === 'clash') return { ...place(a, b, 'cut', 0), reason: `R3.6/R5.4: ${a.camelot}→${b.camelot} clash → quick cut on the one` };
  if (rel.kind === 'boost' || rel.kind === 'shift') return { ...place(a, b, 'filter', 8), reason: `R3.4/R5.2: ${a.camelot}→${b.camelot} energy ${rel.kind} → short filter blend` };
  const outroLen = a.bars - outroBar(a);
  const long = pos < 0.5 && outroLen >= 16; // R5.1 / R6.3
  return { ...place(a, b, 'blend', long ? 32 : 16), reason: `R5.1: ${a.camelot}→${b.camelot} ${rel.kind}, ${g} → ${long ? 32 : 16}-bar bass-swap blend${long ? ' (warm-up)' : ''}` };
}

export const defaultTransitions = (ts: Track[]) => ts.slice(1).map((b, i) => chooseTransition(ts[i], b, ts.length > 2 ? i / (ts.length - 2) : 0));

// ---------- R2.5: tempo drift + timeline ----------
export interface Deck {
  track: Track;
  entryBar: number; exitBar: number;
  tempos: number[]; // per bar from entryBar
  barTimes: number[]; // mix time of each bar boundary entryBar..exitBar
  start: number; end: number;
}

const transTempo = (a: Track, b: Track, t: Transition) =>
  t.type === 'echo' ? { out: a.bpm, in: b.bpm } : { out: (a.bpm + b.bpm) / 2, in: (a.bpm + b.bpm) / 2 }; // R2.5 midpoint, R2.6 no match on echo

export function buildTimeline(ts: Track[], trans: Transition[]): Deck[] {
  const decks: Deck[] = [];
  let start = 0;
  ts.forEach((t, i) => {
    const prev = trans[i - 1], next = trans[i];
    const entryBar = prev ? prev.inBar : Math.max(0, t.energyCurve.findIndex((e) => e > 0.05));
    const inT = prev ? transTempo(ts[i - 1], t, prev).in : t.bpm;
    const inEnd = prev && !startsAfter(prev.type) ? entryBar + prev.bars : entryBar;
    const exitBar = next ? next.outBar + next.bars : t.bars;
    const outStart = next ? Math.max(next.outBar, inEnd) : exitBar;
    const outT = next ? transTempo(t, ts[i + 1], next).out : inT;
    const tempos: number[] = [], barTimes = [start];
    for (let j = entryBar; j < exitBar; j++) {
      const tp = j < inEnd ? inT : j >= outStart ? outT : inT + ((outT - inT) * (j - inEnd + 0.5)) / (outStart - inEnd);
      tempos.push(Math.min(t.bpm * (1 + MAX_STRETCH), Math.max(t.bpm * (1 - MAX_STRETCH), tp))); // R2.3
      barTimes.push(barTimes[barTimes.length - 1] + barLen(tempos[tempos.length - 1]));
    }
    const deck = { track: t, entryBar, exitBar, tempos, barTimes, start, end: barTimes[barTimes.length - 1] };
    decks.push(deck);
    if (next) start = barAt(deck, next.outBar + (startsAfter(next.type) ? next.bars : 0)); // R5.5
  });
  return decks;
}

/** Mix time of a bar of this deck's track. */
export const barAt = (d: Deck, bar: number) => d.barTimes[Math.max(0, Math.min(d.barTimes.length - 1, bar - d.entryBar))];

// ---------- R4: automation ----------
export type Param = 'gain' | 'low' | 'mid' | 'high' | 'hp' | 'echo' | 'delay';
export interface Auto { deck: number; p: Param; t: number; v: number; ramp?: 'lin' | 'exp' }
export const DEFAULTS: Record<Param, number> = { gain: 1, low: 0, mid: 0, high: 0, hp: 10, echo: 0, delay: 0.5 };

export function automation(decks: Deck[], trans: Transition[]): Auto[] {
  const ev: Auto[] = [];
  const add = (deck: number, p: Param, t: number, v: number, ramp?: Auto['ramp']) => ev.push({ deck, p, t, v, ramp });
  trans.forEach((tr, i) => {
    const A = decks[i];
    const s = barAt(A, tr.outBar), e = barAt(A, tr.outBar + tr.bars), m = barAt(A, tr.outBar + tr.bars / 2);
    const beat = barLen(A.tempos[A.tempos.length - 1]) / 4;
    if (tr.type === 'cut') { // R5.4: hard switch on the downbeat
      add(i, 'gain', s - 0.02, 1); add(i, 'gain', s, 0, 'lin');
      return;
    }
    if (tr.type === 'echo') { // R5.3 + R4.5
      add(i, 'delay', s, beat);
      add(i, 'echo', s, 0); add(i, 'echo', e - beat, 0.8, 'lin');
      add(i, 'gain', e - beat, 1); add(i, 'gain', e, 0, 'lin');
      return;
    }
    // blend / filter: incoming enters bass-killed (R4.1), fades in over the first quarter
    add(i + 1, 'low', s, KILL); add(i + 1, 'gain', s, 0); add(i + 1, 'gain', barAt(A, tr.outBar + tr.bars / 4), 1, 'lin');
    // R4.2 bass swap on the middle phrase boundary
    add(i, 'low', m, 0); add(i, 'low', m + beat / 2, KILL, 'lin');
    add(i + 1, 'low', m, KILL); add(i + 1, 'low', m + beat / 2, 0, 'lin');
    if (tr.type === 'filter') { // R4.4 high-pass sweep
      add(i, 'hp', s, 10); add(i, 'hp', m, 800, 'exp'); add(i, 'hp', e, 4000, 'exp');
    } else { // R4.3 fade mids/highs, then the fader
      add(i, 'mid', m, 0); add(i, 'mid', e, -24, 'lin');
      add(i, 'high', m, 0); add(i, 'high', e, -24, 'lin');
    }
    add(i, 'gain', barAt(A, tr.outBar + (tr.bars * 3) / 4), 1); add(i, 'gain', e, 0, 'lin');
  });
  return ev.sort((x, y) => x.t - y.t);
}

/** Value of a param at time t (for tests / meters), following the same set/linear/exp semantics as Web Audio. */
export function valueAt(ev: Auto[], deck: number, p: Param, t: number) {
  const es = ev.filter((e) => e.deck === deck && e.p === p);
  let v = DEFAULTS[p], vt = -Infinity;
  for (const e of es) {
    if (e.t <= t) { v = e.v; vt = e.t; continue; }
    if (!e.ramp) break;
    const k = (t - vt) / (e.t - vt);
    return e.ramp === 'exp' && v > 0 && e.v > 0 ? v * (e.v / v) ** k : v + (e.v - v) * k;
  }
  return v;
}

/** Tracklist with timestamps (mm:ss — Title [BPM, key]). */
export function tracklist(decks: Deck[]) {
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return decks.map((d, i) => `${String(i + 1).padStart(2, '0')}. ${fmt(d.start)}  ${d.track.name}  [${d.track.bpm.toFixed(1)} BPM, ${d.track.camelot}]`).join('\n') + '\n';
}
