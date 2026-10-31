// Test helpers: load WAV test tracks + essentia in Node.
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
// @ts-expect-error untyped
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js';
// @ts-expect-error untyped
import Essentia from 'essentia.js/dist/essentia.js-core.es.js';

export const essentia = new Essentia(EssentiaWASM);

export function ensureTracks() {
  if (!existsSync('test-audio/05_clash_128_3A.wav')) execFileSync('node', ['scripts/make-test-tracks.mjs', 'test-audio']);
}

export function readWav(path: string) {
  const b = readFileSync(path);
  const n = (b.length - 44) / 4, L = new Float32Array(n), R = new Float32Array(n), mono = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = b.readInt16LE(44 + i * 4) / 32768; R[i] = b.readInt16LE(46 + i * 4) / 32768; mono[i] = (L[i] + R[i]) / 2; }
  return { L, R, mono, sr: b.readUInt32LE(24) };
}
