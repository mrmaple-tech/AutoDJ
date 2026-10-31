// Generates synthetic house tracks with KNOWN bpm / key / structure, for testing
// the analysis + mixing pipeline end to end. Usage: node scripts/make-test-tracks.mjs <outDir>
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SR = 44100;
const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);

export function makeTrack({ bpm, root, minor = true, lead = 0.37, sections, seed = 1 }) {
  // sections: [[name, bars]] ; names: intro, build, drop, breakdown, outro
  let rnd = seed;
  const noise = () => ((rnd = (rnd * 1664525 + 1013904223) >>> 0) / 2 ** 31) - 1;
  const beat = 60 / bpm;
  const bars = sections.reduce((a, s) => a + s[1], 0);
  const n = Math.ceil((lead + bars * 4 * beat + 2) * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const add = (t0, buf, gain = 1, pan = 0) => {
    const s = Math.round(t0 * SR);
    for (let i = 0; i < buf.length && s + i < n; i++) { L[s + i] += buf[i] * gain * (1 - pan); R[s + i] += buf[i] * gain * (1 + pan); }
  };
  const kick = Float32Array.from({ length: SR * 0.3 }, (_, i) => { const t = i / SR; return Math.sin(2 * Math.PI * (45 * t + 60 * (1 - Math.exp(-t * 30)) / 30)) * Math.exp(-t * 9); });
  const hat = Float32Array.from({ length: SR * 0.05 }, (_, i) => noise() * Math.exp(-i / SR * 80));
  const clap = Float32Array.from({ length: SR * 0.15 }, (_, i) => noise() * Math.exp(-i / SR * 25));
  const crash = Float32Array.from({ length: SR * 1.5 }, (_, i) => noise() * Math.exp(-i / SR * 2.5));
  const tone = (hz, dur, harmonics = 6, decay = 2) => Float32Array.from({ length: Math.round(dur * SR) }, (_, i) => {
    const t = i / SR; let v = 0;
    for (let h = 1; h <= harmonics; h++) v += Math.sin(2 * Math.PI * hz * h * t) / h;
    return v * Math.exp(-t * decay) * Math.min(1, t * 200);
  });
  const r = 48 + NOTE[root];
  const scale = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const degrees = minor ? [0, 0, 5, 6] : [0, 0, 3, 4]; // i-i-VI-VII / I-I-IV-V
  const chordOf = (d) => [0, 2, 4].map((k) => { const idx = d + k; return r + 12 + scale[idx % 7] + 12 * Math.floor(idx / 7); });

  let bar = 0;
  for (const [name, len] of sections) {
    for (let b = 0; b < len; b++, bar++) {
      const t0 = lead + bar * 4 * beat;
      const deg = degrees[Math.floor(bar / 2) % 4];
      const drums = name !== 'breakdown';
      const full = name === 'drop';
      if (b === 0 && full) add(t0, crash, 0.25);
      for (let q = 0; q < 4; q++) {
        const tb = t0 + q * beat;
        if (drums) add(tb, kick, 0.9);
        if (name !== 'breakdown') add(tb + beat / 2, hat, 0.25, 0.2);
        if (full || name === 'build') { add(tb + beat / 4, hat, 0.1, -0.2); add(tb + 3 * beat / 4, hat, 0.1, -0.2); }
        if (full && (q === 1 || q === 3)) add(tb, clap, 0.35);
        if (full) add(tb + beat / 2, tone(midiHz(r - 12 + scale[deg % 7]), beat / 2, 4, 6), 0.8); // offbeat bass
      }
      if (name !== 'intro' && name !== 'outro') for (const m of chordOf(deg)) add(t0, tone(midiHz(m), 4 * beat, 5, 0.6), name === 'breakdown' ? 0.22 : 0.12, (m % 3 - 1) * 0.3);
    }
  }
  let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  for (let i = 0; i < n; i++) { L[i] *= 0.9 / peak; R[i] *= 0.9 / peak; }
  return { L, R };
}

export function wav({ L, R }) {
  const n = L.length, buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { buf.writeInt16LE(Math.round(L[i] * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(R[i] * 32767), 46 + i * 4); }
  return buf;
}

const STD = [['intro', 16], ['build', 16], ['drop', 32], ['breakdown', 16], ['drop', 32], ['outro', 16]];
export const TEST_TRACKS = [
  { name: '01_deep_122_8A', bpm: 122, root: 'A', minor: true, sections: STD, seed: 1 },          // A minor = 8A
  { name: '02_groove_124_9A', bpm: 124, root: 'E', minor: true, sections: STD, seed: 2 },        // E minor = 9A
  { name: '03_peak_126_10A', bpm: 126, root: 'B', minor: true, sections: STD, seed: 3 },         // B minor = 10A
  { name: '04_major_125_8B', bpm: 125, root: 'C', minor: false, sections: STD, seed: 4 },        // C major = 8B
  { name: '05_clash_128_3A', bpm: 128, root: 'A#', minor: true, sections: [['intro', 8], ...STD.slice(1)], seed: 5 }, // Bb minor = 3A
];

if (process.argv[1]?.endsWith('make-test-tracks.mjs')) {
  const out = process.argv[2] ?? 'test-audio';
  mkdirSync(out, { recursive: true });
  for (const t of TEST_TRACKS) {
    const f = `${out}/${t.name}.wav`;
    writeFileSync(f, wav(makeTrack(t)));
    try { execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', f, '-b:a', '192k', f.replace('.wav', '.mp3')]); } catch { /* ffmpeg optional */ }
    console.log('wrote', f);
  }
}
