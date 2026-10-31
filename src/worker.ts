// Heavy lifting off the UI thread: analysis (essentia.js WASM), time-stretch, MP3 encoding.
// @ts-expect-error untyped
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js';
// @ts-expect-error untyped
import Essentia from 'essentia.js/dist/essentia.js-core.es.js';
import { analyze } from './analysis';
import { encodeMp3, stretch } from './dsp';

let essentia: unknown;
onmessage = ({ data: m }) => {
  const reply = (r: object, transfer: Transferable[] = []) => postMessage({ id: m.id, ...r }, { transfer });
  const progress = (p: number) => reply({ progress: p });
  try {
    if (m.type === 'analyze') {
      essentia ??= new Essentia(EssentiaWASM);
      reply({ result: analyze(m.mono, m.sr, essentia, progress) });
    } else if (m.type === 'stretch') {
      const [L, R] = stretch(m.L, m.R, m.sr, m.beat0, m.bpm, m.entryBar, m.tempos);
      reply({ result: [L, R] }, [L.buffer, R.buffer]);
    } else if (m.type === 'mp3') {
      reply({ result: encodeMp3(m.L, m.R, m.sr, progress) });
    }
  } catch (e) {
    reply({ error: String(e) });
  }
};
