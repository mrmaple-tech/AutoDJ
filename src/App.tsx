import { useEffect, useMemo, useRef, useState } from 'react';
import { loadFile, peaks, render, schedule, stretchDeck, toMp3, toWav } from './engine';
import { automation, barAt, buildLayer, buildTimeline, defaultTransitions, highlight, orderTracks, place, startsAfter, tracklist, type Track, type Transition, type TType } from './plan';

interface Item { id: string; name: string; progress: number; error?: string; track?: Track; L?: Float32Array; R?: Float32Array }

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const BARS: Record<TType, number[]> = { blend: [8, 16, 32], filter: [4, 8, 16], echo: [1, 2, 4], cut: [0] };
const download = (blob: Blob, name: string) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
};

export default function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [locked, setLocked] = useState<Set<string>>(new Set());
  const [trans, setTrans] = useState<Transition[]>([]);
  const [buffers, setBuffers] = useState<Map<string, AudioBuffer>>(new Map());
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const [busy, setBusy] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [mode, setMode] = useState<'full' | 'mashup' | 'axb'>('full');
  const mashup = mode === 'mashup';
  const [pair, setPair] = useState<[string, string]>(['', '']); // [top, bed] for A × B
  const ctxRef = useRef<AudioContext>();
  const stopRef = useRef<() => void>();
  const clock = useRef({ ctx0: 0, pos0: 0 });

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const seg = (t: Track): Track => (mashup ? { ...t, seg: highlight(t) } : t); // R7
  const tracks = useMemo(() => order.map((id) => byId.get(id)!.track!).filter(Boolean).map(seg), [order, byId, mashup]); // eslint-disable-line react-hooks/exhaustive-deps
  const top = byId.get(pair[0])?.track, bed = byId.get(pair[1])?.track;
  const layer = useMemo(() => (mode === 'axb' && top && bed && top !== bed ? buildLayer(top, bed) : null), [mode, top, bed]);
  const seqDecks = useMemo(() => (mode !== 'axb' && tracks.length && trans.length === tracks.length - 1 ? buildTimeline(tracks, trans) : []), [mode, tracks, trans]);
  const decks = layer && 'decks' in layer ? layer.decks : seqDecks;
  const ev = useMemo(() => (layer && 'ev' in layer ? layer.ev : mode === 'axb' ? [] : automation(seqDecks, trans)), [layer, seqDecks, trans]);
  const keyOf = (i: number) => `${decks[i].track.id}|${decks[i].entryBar}|${decks[i].semis ?? 0}|${decks[i].tempos.join(',')}`;
  const deckBufs = decks.map((_, i) => buffers.get(keyOf(i)));
  const ready = decks.length > 0 && deckBufs.every(Boolean);
  const total = decks.length ? Math.max(...decks.map((d) => d.end)) : 0;

  const applyOrder = (ids: string[]) => {
    const ts = ids.map((id) => seg(byId.get(id)!.track!));
    setOrder(ids); setTrans(defaultTransitions(ts)); setSel(null);
  };
  const autoOrder = (lock = locked) => applyOrder(orderTracks(tracks.length ? tracks : items.flatMap((i) => (i.track ? [i.track] : [])), lock).map((t) => t.id));

  // auto-order once every uploaded track is analysed
  const allReady = items.length > 0 && items.every((i) => i.track || i.error);
  const analysed = items.filter((i) => i.track);
  useEffect(() => {
    if (allReady && analysed.length !== order.length) {
      const known = order.filter((id) => byId.get(id)?.track);
      const fresh = analysed.filter((i) => !known.includes(i.id)).map((i) => i.track!);
      applyOrder(orderTracks([...known.map((id) => byId.get(id)!.track!), ...fresh], locked).map((t) => t.id));
    }
  }, [allReady, analysed.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // stretch any deck whose tempo plan changed (R2.4), in workers
  useEffect(() => {
    const missing = decks.map((d, i) => [d, keyOf(i)] as const).filter(([, k]) => !buffers.has(k));
    if (!missing.length) return;
    let live = true;
    Promise.all(missing.map(async ([d, k]) => { const it = byId.get(d.track.id)!; return [k, await stretchDeck(d, it.L!, it.R!)] as const; })).then((res) => {
      if (!live) return;
      setBuffers((b) => { const n = new Map(b); res.forEach(([k, v]) => n.set(k, v)); return n; });
    });
    return () => { live = false; };
  }, [decks]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (order.length) applyOrder(order); }, [mashup]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (mode === 'axb' && (!byId.get(pair[0]) || !byId.get(pair[1]))) setPair([order[0] ?? '', order[1] ?? '']); }, [mode, order]); // eslint-disable-line react-hooks/exhaustive-deps

  // pause whenever the plan changes
  useEffect(() => { stop(); }, [decks]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => { setPos(clock.current.pos0 + ctxRef.current!.currentTime - clock.current.ctx0); raf = requestAnimationFrame(tick); };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  useEffect(() => { if (playing && pos >= total) stop(); }, [pos]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addFiles(files: FileList | File[]) {
    const fresh = [...files].filter((f) => /\.(mp3|wav)$/i.test(f.name) || /audio\/(mpeg|wav|x-wav)/.test(f.type));
    const news = fresh.map((f) => ({ id: crypto.randomUUID(), name: f.name.replace(/\.(mp3|wav)$/i, ''), progress: 0 }));
    setItems((s) => [...s, ...news]);
    const upd = (id: string, p: Partial<Item>) => setItems((s) => s.map((i) => (i.id === id ? { ...i, ...p } : i)));
    await Promise.all(fresh.map(async (f, k) => {
      const { id, name } = news[k];
      try {
        const { analysis, L, R } = await loadFile(f, (p) => upd(id, { progress: p }));
        upd(id, { track: { ...analysis, id, name }, L, R, progress: 1 });
      } catch (e) {
        upd(id, { error: `Could not read file: ${(e as Error).message}` });
      }
    }));
  }

  function start(at: number) {
    const ctx = (ctxRef.current ??= new AudioContext());
    ctx.resume();
    stopRef.current?.();
    stopRef.current = schedule(ctx, decks, deckBufs as AudioBuffer[], ev, at);
    clock.current = { ctx0: ctx.currentTime + 0.05, pos0: at };
    setPlaying(true);
  }
  function stop() {
    stopRef.current?.(); stopRef.current = undefined;
    if (playing) setPos(clock.current.pos0 + ctxRef.current!.currentTime - clock.current.ctx0);
    setPlaying(false);
  }
  const seek = (t: number) => { setPos(t); if (playing) start(t); };

  async function exportMix(kind: 'wav' | 'mp3') {
    stop();
    setBusy('Rendering mix offline…');
    try {
      const { L, R } = await render(decks, deckBufs as AudioBuffer[], ev);
      if (kind === 'wav') download(toWav(L, R), 'AutoDJ-mix.wav');
      else download(await toMp3(L, R, (p) => setBusy(`Encoding MP3… ${Math.round(p * 100)}%`)), 'AutoDJ-mix.mp3');
    } catch (e) {
      alert(`Export failed: ${(e as Error).message}`);
    }
    setBusy('');
  }

  const move = (id: string, to: number) => {
    const ids = order.filter((x) => x !== id);
    ids.splice(Math.max(0, Math.min(ids.length, to)), 0, id);
    applyOrder(ids);
  };
  const toggleLock = (id: string) => setLocked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const editTrans = (i: number, p: Partial<Pick<Transition, 'type' | 'bars' | 'outBar'>>) => {
    const t = trans[i], type = p.type ?? t.type;
    const bars = p.bars ?? (p.type ? (BARS[type].includes(t.bars) ? t.bars : BARS[type][1] ?? BARS[type][0]) : t.bars);
    const mix = t.outBar + (startsAfter(t.type) ? t.bars : 0);
    const n = place(tracks[i], tracks[i + 1], type, bars, p.outBar ?? mix - (startsAfter(type) ? bars : 0));
    setTrans(trans.map((x, k) => (k === i ? { ...n, reason: 'Manual edit' } : x)));
  };

  const cur = decks.reduce((c, d, i) => (pos >= d.start && pos < d.end ? i : c), -1);
  const curT = decks[cur]?.track;

  return (
    <div className="app" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}>
      <header>
        <h1>Auto<span>DJ</span></h1>
        <label className="btn primary">+ Add MP3/WAV<input type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files)} /></label>
      </header>

      {!items.length && (
        <div className="drop">
          <p><b>Drop house tracks here</b></p>
          <p className="dim">Everything is analysed and mixed locally in your browser — nothing is uploaded.</p>
        </div>
      )}

      {mode === 'axb' && (
        <section className="row">
          <label>Song A (vocals / melody) <select value={pair[0]} onChange={(e) => setPair([e.target.value, pair[1]])}>{order.map((id) => <option key={id} value={id}>{byId.get(id)!.name}</option>)}</select></label>
          <button className="btn" title="Swap A and B" onClick={() => setPair([pair[1], pair[0]])}>⇄</button>
          <label>Song B (beat / bass) <select value={pair[1]} onChange={(e) => setPair([pair[0], e.target.value])}>{order.map((id) => <option key={id} value={id}>{byId.get(id)!.name}</option>)}</select></label>
          <span className={layer && 'error' in layer ? 'err small' : 'dim small'}>{!layer ? 'Pick two different songs.' : 'error' in layer ? layer.error : layer.reason}</span>
        </section>
      )}

      {decks.length > 0 && (
        <section className="deck">
          <div className="now">
            <div>
              <div className="dim small">NOW PLAYING</div>
              <div className="title">{curT?.name ?? '—'}</div>
              {curT && <div className="tags"><span>{curT.bpm.toFixed(1)} BPM</span><span>▶ {decks[cur].tempos[Math.max(0, Math.min(decks[cur].tempos.length - 1, Math.floor((pos - decks[cur].start) / (240 / curT.bpm))))].toFixed(1)}</span><span className="key">{curT.camelot}</span><span>Energy {Math.round(curT.energy * 10)}</span></div>}
            </div>
            <div className="transport">
              <button className="btn play" disabled={!ready} onClick={() => (playing ? stop() : start(pos >= total ? 0 : pos))}>{playing ? '❚❚' : '▶'}</button>
              <div className="time">{fmt(pos)} / {fmt(total)}</div>
            </div>
          </div>
          <Timeline decks={decks} trans={mode === 'axb' ? [] : trans} buffers={deckBufs} pos={pos} total={total} sel={sel} onSeek={seek} onSelect={setSel} />
          {mode !== 'axb' && sel !== null && trans[sel] && (
            <div className="editor">
              <div><b>{tracks[sel].name}</b> → <b>{tracks[sel + 1].name}</b> <button className="x" onClick={() => setSel(null)}>✕</button></div>
              <div className="dim small">{trans[sel].reason}</div>
              <div className="row">
                <label>Type <select value={trans[sel].type} onChange={(e) => editTrans(sel, { type: e.target.value as TType })}>
                  <option value="blend">Long blend (bass swap)</option><option value="filter">Filter blend</option><option value="echo">Echo out</option><option value="cut">Quick cut</option>
                </select></label>
                <label>Length <select value={trans[sel].bars} onChange={(e) => editTrans(sel, { bars: +e.target.value })}>
                  {BARS[trans[sel].type].map((b) => <option key={b} value={b}>{b} bars</option>)}
                </select></label>
                <label>Mix point bar <input type="number" step={8} min={0} max={tracks[sel].bars} value={trans[sel].outBar + (startsAfter(trans[sel].type) ? trans[sel].bars : 0)}
                  onChange={(e) => editTrans(sel, { outBar: Math.round(+e.target.value / 8) * 8 - (startsAfter(trans[sel].type) ? trans[sel].bars : 0) })} /></label>
                <button className="btn" onClick={() => setTrans(trans.map((x, k) => (k === sel ? defaultTransitions(tracks)[sel] : x)))}>Auto</button>
              </div>
            </div>
          )}
          <div className="row exports">
            <button className="btn" disabled={!ready || !!busy} onClick={() => exportMix('wav')}>Export WAV</button>
            <button className="btn" disabled={!ready || !!busy} onClick={() => exportMix('mp3')}>Export MP3</button>
            <button className="btn" disabled={!decks.length} onClick={() => download(new Blob([tracklist(decks)], { type: 'text/plain' }), 'AutoDJ-tracklist.txt')}>Tracklist</button>
            {(busy || (decks.length > 0 && !ready)) && <span className="dim small">{busy || 'Beatmatching decks (key-locked time-stretch)…'}</span>}
          </div>
        </section>
      )}

      {items.length > 0 && (
        <section>
          <div className="row between">
            <h2>Set order</h2>
            <div className="seg" role="group" aria-label="Mix mode">
              <button className={mode === 'full' ? 'on' : ''} onClick={() => setMode('full')}>Full mix</button>
              <button className={mode === 'mashup' ? 'on' : ''} onClick={() => setMode('mashup')}>Highlights (~50 s each)</button>
              <button className={mode === 'axb' ? 'on' : ''} disabled={tracks.length < 2} onClick={() => setMode('axb')}>A × B</button>
            </div>
            <button className="btn" disabled={tracks.length < 2} onClick={() => autoOrder()}>Auto-order</button>
          </div>
          <ol className="list">
            {order.map((id, i) => {
              const it = byId.get(id)!, t = it.track!;
              return (
                <li key={id} draggable={!locked.has(id)} className={`${dragId === id ? 'dragging' : ''} ${cur === i ? 'cur' : ''}`}
                  onDragStart={(e) => { setDragId(id); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => setDragId(null)}
                  onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (dragId && dragId !== id) move(dragId, i); setDragId(null); }}>
                  <span className="num">{i + 1}</span>
                  <span className="name" title={t.name}>{t.name}</span>
                  <span className="tags"><span>{t.bpm.toFixed(1)}</span><span className="key">{t.camelot}</span><span>E{Math.round(t.energy * 10)}</span></span>
                  <span className="secs">{t.sections.map((s, k) => <i key={k} className={`s-${s}`} title={s} />)}</span>
                  <span className="ctl">
                    <button title="Move up" disabled={i === 0} onClick={() => move(id, i - 1)}>▲</button>
                    <button title="Move down" disabled={i === order.length - 1} onClick={() => move(id, i + 1)}>▼</button>
                    <button title={locked.has(id) ? 'Unlock position' : 'Lock position'} className={locked.has(id) ? 'on' : ''} onClick={() => toggleLock(id)}>{locked.has(id) ? '🔒' : '🔓'}</button>
                  </span>
                </li>
              );
            })}
          </ol>
          {items.filter((i) => !i.track).map((i) => (
            <div key={i.id} className="pending">
              <span className="name">{i.name}</span>
              {i.error ? <span className="err">{i.error}</span> : <><progress value={i.progress} /><span className="dim small">Analysing… {Math.round(i.progress * 100)}%</span></>}
            </div>
          ))}
        </section>
      )}
      <footer className="dim small">Mixing logic: see MIXING_RULES.md — every decision cites a rule (R1–R8).</footer>
    </div>
  );
}

function Timeline({ decks, trans, buffers, pos, total, sel, onSeek, onSelect }: {
  decks: ReturnType<typeof buildTimeline>; trans: Transition[]; buffers: (AudioBuffer | undefined)[]; pos: number; total: number; sel: number | null;
  onSeek: (t: number) => void; onSelect: (i: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const pk = useMemo(() => buffers.map((b) => (b ? peaks(b) : null)), [buffers]);
  const zones = trans.map((t, i) => [barAt(decks[i], t.outBar), Math.max(barAt(decks[i], t.outBar + t.bars), barAt(decks[i], t.outBar) + 2)]);
  useEffect(() => {
    const c = ref.current!, dpr = devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight;
    c.width = W * dpr; c.height = H * dpr;
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, W, H);
    const x = (t: number) => (t / total) * W, top = 20, lane = (H - top) / 2;
    zones.forEach(([s, e], i) => {
      g.fillStyle = i === sel ? 'rgba(255,184,0,.35)' : 'rgba(255,184,0,.15)';
      g.fillRect(x(s), 0, Math.max(3, x(e) - x(s)), H);
      g.fillStyle = '#ffb800'; g.font = '10px system-ui';
      g.fillText(trans[i].type.toUpperCase(), x(s) + 2, 12);
    });
    decks.forEach((d, i) => {
      const p = pk[i], y0 = top + (i % 2) * lane, mid = y0 + lane / 2;
      g.fillStyle = i % 2 ? '#ff3d9a' : '#00d1ff';
      if (!p) { g.globalAlpha = 0.25; g.fillRect(x(d.start), y0 + 4, x(d.end) - x(d.start), lane - 8); g.globalAlpha = 1; return; }
      const x0 = Math.floor(x(d.start)), x1 = Math.ceil(x(d.end));
      for (let px = x0; px < x1; px++) {
        const a = Math.floor(((px / W) * total - d.start) * 20), b = Math.max(a + 1, Math.floor((((px + 1) / W) * total - d.start) * 20));
        let m = 0;
        for (let k = Math.max(0, a); k < Math.min(p.length, b); k++) m = Math.max(m, p[k]);
        const h = Math.min(1, m * d.track.gain) * (lane / 2 - 2);
        g.fillRect(px, mid - h, 1, h * 2);
      }
      g.fillStyle = '#fff'; g.font = '11px system-ui';
      g.fillText(`${i + 1}. ${d.track.name}`.slice(0, 40), x(d.start) + 3, y0 + 12);
    });
    g.fillStyle = '#fff'; g.fillRect(x(pos), 0, 2, H);
  });
  return (
    <canvas ref={ref} className="timeline" onClick={(e) => {
      const r = e.currentTarget.getBoundingClientRect(), t = ((e.clientX - r.left) / r.width) * total;
      const z = zones.findIndex(([s, en]) => t >= s && t <= en);
      if (e.clientY - r.top < 20 && z >= 0) onSelect(z);
      else onSeek(t);
    }} />
  );
}
