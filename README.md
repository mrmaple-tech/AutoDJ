# AutoDJ

Drop in house tracks (MP3/WAV) and AutoDJ builds a continuous, beatmatched, phrase-aligned DJ mix in your
browser. You can play it, adjust transitions, and export it as WAV or MP3 with a timestamped tracklist.
**Your audio never leaves your machine.** Decoding, analysis, stretching and rendering all run locally.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Open the printed URL and drop some tracks in. Production build: `npm run build && npm run preview`.

Don't open `index.html` directly or serve the repo root: the page needs a build. Pushing to `main` deploys to
GitHub Pages via `.github/workflows/pages.yml` (repo **Settings → Pages → Source: GitHub Actions**).

### Tests

```bash
npm test
```

The unit tests cover the BPM grid, downbeats, phrases, sections, Camelot conversion and compatibility, ordering,
transition choice, tempo drift, and the "never two basslines" rule. The time-stretch test checks downbeat
accuracy. There is also an integration test that runs the full analysis on generated house tracks with known
BPM, key and structure (`scripts/make-test-tracks.mjs` creates these in `test-audio/` on first run).

To run the browser end-to-end check (upload → analyse → reorder/lock/edit → play → export WAV/MP3):

```bash
npm run build && (npx vite preview --port 4173 &) && node scripts/e2e.mjs
```

## How the mixing works

Every decision cites a rule in [MIXING_RULES.md](MIXING_RULES.md), which summarises DJ-education sources and
auto-mix research. Search the code for `R1`…`R6` to find where each rule is applied.

1. **Analysis** (`src/analysis.ts`, in a Web Worker)
   - essentia.js `RhythmExtractor2013` finds beats in a 2-minute window. House uses a fixed tempo (R2.2), so
     one constant grid is fitted to the ticks by robust linear regression and octave-folded into house range (R2.1).
   - Downbeat and phrase start: the bar phase and the 8-bar phase are chosen where per-beat spectral novelty
     concentrates, with a prior on the first audible beat (R1.5).
   - Sections: each 8-bar phrase is scored by loudness, bass and brightness. Loud phrases with strong bass are
     drops; quiet phrases before the first drop are the intro, after the last drop the outro, and in between
     breakdowns (R1.4).
   - Key: essentia `KeyExtractor` with the `edma` (electronic dance music) profile, converted to Camelot.
   - Energy: a heuristic built from drop loudness, brightness and tempo. Loudness-match gain is computed per track.
2. **Ordering** (`src/plan.ts`): every pair is scored on BPM closeness, Camelot relation and energy flow. Simulated
   annealing then finds an order that also follows a warm-up → peak (~70%) → cool-down arc (R6). Locked tracks
   stay in place.
3. **Transitions** (`src/plan.ts`)
   - Type (R5): BPM gap > 6% → echo out. Key clash → quick cut on the "one" into the incoming drop.
     ±2 energy move → 8-bar filter blend. Otherwise a 32-bar (warm-up) or 16-bar (peak) bass-swap blend.
   - Placement: transitions start on the outgoing outro's phrase boundary. The incoming track's phrase start
     lands on that downbeat, timed so its first drop arrives as the outgoing track leaves (R5.5, R5.6).
   - Tempo drift (R2.5): during a blend both decks run at the midpoint BPM. Between transitions each track
     ramps bar-by-bar towards its next transition tempo, never stretching more than ±6% (R2.3).
   - Automation (R4): the incoming low EQ is killed, the bass swaps on the middle phrase boundary, then the
     outgoing mids and highs fade, then its fader. Filter blends sweep a high-pass. Echo-outs use a
     high-passed feedback delay.
4. **Audio** (`src/dsp.ts`, `src/engine.ts`): each deck is time-stretched with key lock by SoundTouch (WSOLA),
   bar-by-bar in a worker, to its exact tempo plan. Downbeats land within ~3 ms. One Web Audio graph builder
   drives both live playback and the offline export: trim → low shelf / mid peak / high shelf → high-pass →
   fader (+ echo send) → master → limiter. The export is rendered with `OfflineAudioContext`, kept at a
   -1 dBFS peak, and encoded to WAV, or to 320 kbps MP3 with lamejs in a worker.

## UI

- Drag and drop files anywhere, or use **+ Add**. Progress shows per track.
- **Set order**: drag rows (or use ▲▼ on mobile) and 🔒 to lock a position. **Auto-order** re-optimises around locks.
- **Timeline**: the whole mix in two deck lanes, with transition zones in amber. Click the timeline to seek.
  Click a zone's label to edit its type, length in bars, or start bar (in 8-bar phrase steps). **Auto** resets it.

## Limits

- Analysis assumes a constant-tempo 4/4 track, which fits house. Live-drummed or tempo-changing tracks will drift.
- The section and energy heuristics were tuned on mastered EDM. Very quiet or unusual masters can be mislabelled.
- The whole mix is rendered in memory for export (about 1 GB per hour). Sets much longer than ~1.5 h may hit browser limits.
- License note: essentia.js is AGPL-3.0 and SoundTouch is LGPL-2.1. Distributing this app means following those terms.
