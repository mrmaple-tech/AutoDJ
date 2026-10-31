// Web Audio engine: worker pool, decoding, and one graph builder used by both live playback and offline export.
import type { Analysis } from './analysis';
import { encodeWav } from './dsp';
import { DEFAULTS, valueAt, type Auto, type Deck, type Param } from './plan';

export const SR = 44100;

// ---------- worker pool ----------
const POOL = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
const workers = Array.from({ length: POOL }, () => ({ w: new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }), busy: 0 }));
let nextId = 0;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function run<T>(msg: any, transfer: Transferable[] = [], onProgress?: (p: number) => void): Promise<T> {
  const slot = workers.reduce((a, b) => (b.busy < a.busy ? b : a));
  const id = nextId++;
  slot.busy++;
  return new Promise((resolve, reject) => {
    const h = ({ data }: MessageEvent) => {
      if (data.id !== id) return;
      if ('progress' in data) return onProgress?.(data.progress);
      slot.w.removeEventListener('message', h);
      slot.busy--;
      data.error ? reject(new Error(data.error)) : resolve(data.result);
    };
    slot.w.addEventListener('message', h);
    slot.w.postMessage({ ...msg, id }, transfer);
  });
}

/** Decode locally (never uploaded) and analyse in a worker. */
export async function loadFile(file: File, onProgress: (p: number) => void) {
  const buf = await new OfflineAudioContext(2, 1, SR).decodeAudioData(await file.arrayBuffer());
  const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const mono = Float32Array.from(L, (v, i) => (v + R[i]) / 2);
  onProgress(0.1);
  const analysis = await run<Analysis>({ type: 'analyze', mono, sr: SR }, [mono.buffer], (p) => onProgress(0.1 + 0.9 * p));
  return { analysis, L, R };
}

/** R2.4: key-locked stretch of one deck to its tempo plan. */
export async function stretchDeck(d: Deck, L: Float32Array, R: Float32Array) {
  const t = d.track;
  const [sL, sR] = await run<[Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>]>({ type: 'stretch', L, R, sr: SR, beat0: t.beat0, bpm: t.bpm, entryBar: d.entryBar, tempos: d.tempos });
  const ab = new AudioBuffer({ numberOfChannels: 2, length: sL.length, sampleRate: SR });
  ab.copyToChannel(sL, 0); ab.copyToChannel(sR, 1);
  return ab;
}

/** Overview peaks (per 1/20 s) for the waveform. */
export function peaks(b: AudioBuffer, perSec = 20) {
  const d = b.getChannelData(0), step = Math.floor(SR / perSec);
  return Float32Array.from({ length: Math.ceil(d.length / step) }, (_, i) => {
    let m = 0;
    for (let k = i * step; k < Math.min(d.length, (i + 1) * step); k += 8) m = Math.max(m, Math.abs(d[k]));
    return m;
  });
}

// ---------- graph ----------
/**
 * Schedule the whole mix into ctx, starting at mix time `offset`. Per deck: trim → 3-band EQ → high-pass → fader,
 * plus an echo send (delay + feedback, high-passed, R4.5). Master → limiter (R4.6). Returns a stop function.
 */
export function schedule(ctx: BaseAudioContext, decks: Deck[], buffers: AudioBuffer[], ev: Auto[], offset = 0) {
  const t0 = ctx.currentTime + (ctx instanceof AudioContext ? 0.05 : 0);
  const master = new GainNode(ctx, { gain: 0.9 });
  // R4.6 light limiting: fast, high-ratio compressor just under 0 dBFS
  const limiter = new DynamicsCompressorNode(ctx, { threshold: -3, knee: 0, ratio: 20, attack: 0.002, release: 0.15 });
  master.connect(limiter).connect(ctx.destination);
  const sources: AudioBufferSourceNode[] = [];
  decks.forEach((d, i) => {
    if (d.end <= offset || !buffers[i]) return;
    const src = new AudioBufferSourceNode(ctx, { buffer: buffers[i] });
    const trim = new GainNode(ctx, { gain: d.track.gain }); // R4.6 loudness match
    const low = new BiquadFilterNode(ctx, { type: 'lowshelf', frequency: 200 });
    const mid = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 1000, Q: 0.7 });
    const high = new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 3000 });
    const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 10, Q: 0.7 });
    const fader = new GainNode(ctx);
    const send = new GainNode(ctx, { gain: 0 });
    const delay = new DelayNode(ctx, { maxDelayTime: 2 });
    const fb = new GainNode(ctx, { gain: 0.55 });
    const echoHp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 400 });
    src.connect(trim).connect(low).connect(mid).connect(high).connect(hp).connect(fader).connect(master);
    fader.connect(send).connect(delay).connect(fb).connect(delay);
    delay.connect(echoHp).connect(master);
    const params: Record<Param, AudioParam> = { gain: fader.gain, low: low.gain, mid: mid.gain, high: high.gain, hp: hp.frequency, echo: send.gain, delay: delay.delayTime };
    const now = t0;
    for (const p of Object.keys(params) as Param[]) params[p].setValueAtTime(offset > 0 ? valueAt(ev, i, p, offset) : DEFAULTS[p], now);
    for (const e of ev) {
      if (e.deck !== i || e.t <= offset) continue;
      const at = t0 + e.t - offset, prm = params[e.p];
      if (e.ramp === 'exp') prm.exponentialRampToValueAtTime(e.v, at);
      else if (e.ramp === 'lin') prm.linearRampToValueAtTime(e.v, at);
      else prm.setValueAtTime(e.v, at);
    }
    if (d.start >= offset) src.start(t0 + d.start - offset);
    else src.start(t0, offset - d.start);
    sources.push(src);
  });
  return () => { sources.forEach((s) => { try { s.stop(); } catch { /* not started */ } }); master.disconnect(); };
}

/** Offline render of the full mix (R4.6: final peak safety at -1 dBFS). */
export async function render(decks: Deck[], buffers: AudioBuffer[], ev: Auto[]) {
  const len = Math.ceil((decks[decks.length - 1].end + 2) * SR);
  // ponytail: whole mix in memory (~1 GB/hour stereo float); chunked rendering if sets get longer than ~1.5 h
  const ctx = new OfflineAudioContext(2, len, SR);
  schedule(ctx, decks, buffers, ev);
  const out = await ctx.startRendering();
  const L = out.getChannelData(0), R = out.getChannelData(1);
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  if (peak > 0.89) { const g = 0.89 / peak; for (let i = 0; i < len; i++) { L[i] *= g; R[i] *= g; } }
  return { L, R };
}

export const toWav = (L: Float32Array, R: Float32Array) => new Blob([encodeWav(L, R, SR)], { type: 'audio/wav' });
export const toMp3 = (L: Float32Array, R: Float32Array, onProgress: (p: number) => void) => run<Blob>({ type: 'mp3', L, R, sr: SR }, [], onProgress);
