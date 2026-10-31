// Key-locked time-stretch (SoundTouch WSOLA) + WAV/MP3 encoding.
import { Stretch } from 'soundtouchjs';
import { Mp3Encoder } from '@breezystack/lamejs';
import { barLen } from './analysis';

/**
 * R2.4: stretch bars [entryBar, entryBar+tempos.length) of a track to the given per-bar tempos without
 * changing pitch (downbeats land within ~3 ms, see test/dsp.test.ts). Output sample 0 is the entryBar downbeat; bar j ends at Σ barLen(tempos[0..j]).
 */
export function stretch(L: Float32Array, R: Float32Array, sr: number, beat0: number, bpm: number, entryBar: number, tempos: number[]) {
  const st = new Stretch(true);
  st.setParameters(sr, 0, 0, 8);
  const total = Math.round(tempos.reduce((s, t) => s + barLen(t), 0) * sr);
  const out = new Float32Array((total + sr) * 2);
  let w = 0;
  const drain = () => {
    const n = Math.min(st.outputBuffer.frameCount, out.length / 2 - w);
    st.outputBuffer.receiveSamples(out.subarray(w * 2), n);
    st.outputBuffer.receive(st.outputBuffer.frameCount); // discard overflow
    w += n;
  };
  const feed = (from: number, to: number) => {
    const n = to - from, buf = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const k = from + i;
      if (k >= 0 && k < L.length) { buf[2 * i] = L[k]; buf[2 * i + 1] = R[k]; }
    }
    st.inputBuffer.putSamples(buf, 0, n);
    st.process();
    drain();
  };
  let tempo = 0;
  tempos.forEach((t, j) => {
    if (Math.abs(t / bpm - tempo) > 1e-9) st.tempo = tempo = t / bpm;
    const a = Math.round((beat0 + (entryBar + j) * barLen(bpm)) * sr);
    feed(a, Math.round((beat0 + (entryBar + j + 1) * barLen(bpm)) * sr));
  });
  feed(0, 0); // flush with silence
  for (let i = 0; i < 4 && w < total; i++) feed(-sr, -sr / 2);
  const oL = new Float32Array(total), oR = new Float32Array(total);
  for (let i = 0; i < total; i++) { oL[i] = out[i * 2]; oR[i] = out[i * 2 + 1]; }
  return [oL, oR] as const;
}

export function encodeWav(L: Float32Array, R: Float32Array, sr: number) {
  const n = L.length, v = new DataView(new ArrayBuffer(44 + n * 4));
  const s = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  s(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); s(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 2, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  s(36, 'data'); v.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true);
    v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true);
  }
  return v.buffer;
}

export function encodeMp3(L: Float32Array, R: Float32Array, sr: number, progress: (p: number) => void = () => {}) {
  const enc = new Mp3Encoder(2, sr, 320);
  const toI16 = (x: Float32Array) => Int16Array.from(x, (v) => Math.max(-1, Math.min(1, v)) * 32767);
  const parts: Uint8Array[] = [];
  const B = 1152 * 64;
  for (let i = 0; i < L.length; i += B) {
    parts.push(enc.encodeBuffer(toI16(L.subarray(i, i + B)), toI16(R.subarray(i, i + B))));
    if ((i / B) % 20 === 0) progress(i / L.length);
  }
  parts.push(enc.flush());
  return new Blob(parts as BlobPart[], { type: 'audio/mpeg' });
}
