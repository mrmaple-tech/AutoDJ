# AutoDJ Mixing Rules

Every mixing decision in the code cites one of these rule IDs (search the source for `R1`, `R2`, …).
Numbers are rules of thumb from DJ education sources, not hard standards; sources at the bottom.

## R1 — Phrase structure (house is built in 4/4 blocks)
- **R1.1** 4 beats per bar. The "1" (downbeat) is where new elements enter and sections change.
- **R1.2** House arranges in 8-, 16- and 32-bar blocks; a 32-bar phrase usually marks a major section change.
  Mix decisions happen only on 8-bar phrase boundaries.
- **R1.3** Typical layout: DJ-friendly intro (16–32 bars, mostly drums) → build → drop (full groove, bassline)
  → breakdown (drums/bass drop out, pads/vocals) → drop → outro (16–32 bars, mostly drums, made for mixing out).
- **R1.4** Section detection: phrases with high loudness *and* strong bass are drops; low-energy phrases before the
  first drop are intro, after the last drop are outro, and between drops are breakdowns.
- **R1.5** Downbeats are found where change happens: section novelty lines up with bar 1 of the bar, and
  with bar 1 of an 8-bar phrase. Most tracks start on the first downbeat of the first phrase.

## R2 — Beatmatching and tempo
- **R2.1** House sits at roughly 118–130 BPM. Tempos outside are octave errors: halve/double into that range.
- **R2.2** House is produced to a fixed grid, so one constant BPM + offset describes a whole track.
- **R2.3** With key lock, stretching stays clean within about ±4–5%; beyond ~6% artefacts get obvious.
  AutoDJ never stretches a track more than **±6%**; blends need the tempo gap to fit that budget.
- **R2.4** Always time-stretch with key lock (keep the original pitch); never plain playback-rate changes.
- **R2.5** Don't jump the tempo at each transition: drift it. Both decks share one tempo during a blend
  (the midpoint of the two BPMs), and each track ramps slowly between its in- and out-transition tempos.
- **R2.6** Big BPM gaps (> 6%) are not beatmatched; use a transition that doesn't need overlap (R5.3/R5.4).

## R3 — Harmonic mixing (Camelot wheel, Mixed In Key)
- **R3.1** Same code (8A→8A): perfect.
- **R3.2** ±1 on the same letter (8A→7A/9A): smooth, safe.
- **R3.3** Same number, switch letter (8A↔8B, relative major/minor): safe, changes mood.
- **R3.4** +2 (8A→10A): "energy boost" — a noticeable lift, use sparingly.
- **R3.5** Diagonal (8A→9B / 8B→7A): acceptable.
- **R3.6** Anything else is a clash; long blends expose clashes most, so keep overlap short or avoid it.

## R4 — EQ technique
- **R4.1** Never two full basslines at once. The incoming track enters with its low EQ killed.
- **R4.2** Bass swap: on a phrase boundary, kill the outgoing low and restore the incoming low (within a beat).
- **R4.3** After the swap, fade the outgoing mids/highs, then the fader, before its phrase ends.
- **R4.4** A high-pass filter sweep on the outgoing track thins it out and masks key clashes.
- **R4.5** Echo repeats are high-passed so they don't muddy the incoming kick.
- **R4.6** Light limiting on the master keeps levels consistent and stops clipping; tracks are
  loudness-matched before the limiter so it only catches peaks.

## R5 — Transition types and when they fit
- **R5.1 Long blend (bass swap)** — 16–32 bars. Default for house when BPMs and keys are compatible (R3.1–R3.3, R3.5).
  32 bars in the warm-up (smooth, slow), 16 bars at peak time (faster mixing, R6.3) or when intro/outro is short.
- **R5.2 Filter blend** — 8 bars, outgoing high-pass sweep + bass swap. For energy boosts (R3.4) and mild clashes
  where tempos still match.
- **R5.3 Echo out** — outgoing echoes out on a phrase boundary (1-beat delay, feedback, high-passed),
  incoming starts on the "one". For big BPM gaps (R2.6), where nothing can be beatmatched.
- **R5.4 Quick cut on the one** — switch on a downbeat at a phrase boundary, incoming starts on its first drop.
  For hard key clashes (R3.6) at matched tempos: the tracks never sound together.
- **R5.5** Incoming phrase start lands exactly on an outgoing phrase boundary, downbeat on downbeat.
- **R5.6** Mix out at the outgoing outro; time the blend so the incoming drop arrives as the outgoing leaves.

## R6 — Set energy arc
- **R6.1** Warm-up (low energy, lower BPM) → build → peak at roughly 60–75% of the set → short cool-down.
- **R6.2** Energy and BPM should rise gradually; avoid big drops in energy except into the cool-down.
- **R6.3** Longer, smoother blends early; shorter, punchier blends at the peak.
- **R6.4** Ordering = maximise (pairwise compatibility: BPM closeness R2, Camelot R3, energy flow R6.2)
  + (fit to the arc R6.1). User-locked positions are never moved.

## Sources
- Phrasing: [DJKIT – Rule of 32](https://www.djkit.com/blogs/news/djing-rule-of-32),
  [The Ghost Production – mixing house sets](https://theghostproduction.com/mix-house-music-pro-dj-sets/),
  [djworx – better DJ mixes](https://djworx.com/?p=46933), [PulseDJ – phrasing](https://blog.pulsedj.com/what-is-phrasing),
  [rekordbox phrase analysis guide](https://manuals.plus/rekordbox/alphatheta-phrase-analysis-manual)
- Tempo/key lock: [Digital DJ Tips – keylocking](https://www.digitaldjtips.com/keylocking-dj-beginners/),
  [Digital DJ Tips – how far to deviate from original BPM](https://www.digitaldjtips.com/?p=2183461),
  [DJTechTools forum – tempo with keylock](https://forum.djtechtools.com/t/tempo-adjust-with-keylock-on/54201)
- Harmonic mixing: [Mixed In Key – change energy with the Camelot wheel](https://mixedinkey.com/workflows/change-energy-with-camelot-wheel/),
  [Dubspot – harmonic mixing](https://blog.dubspot.com/harmonic-mixing-w-dj-endo-part-1)
- EQ / transitions: [Digital DJ Tips – EQ, filters & effects](https://www.digitaldjtips.com/rock-the-dancefloor/adding-eq-filters-and-effects/),
  [Digital DJ Pool – transitions](https://digitaldjpool.com/blog/dj-transitions-for-beginners/),
  [DJ.Studio – EQ mixing](https://dj.studio/blog/dj-eqmixing), [MusicRadar – EQ & filter tricks](https://www.musicradar.com/news/eq-and-filter-tricks-for-djs),
  [Digital DJ Tips – stop using echo out](https://www.digitaldjtips.com/?p=2797993),
  [Mixgraph – transition techniques](https://www.mixgraph.io/learn/dj-transition-techniques)
- Set arc: [djclass – build a DJ set](https://djclass.net/learn/how-to-build-a-dj-set),
  [PulseDJ – plan a set](https://blog.pulsedj.com/plan-dj-set), [Mixgraph – energy flow](https://www.mixgraph.io/learn/energy-flow-guide)
- Auto-mix research: Vande Veire & De Bie, *From raw audio to a seamless mix* (EURASIP JASMP 2018,
  [record](https://doaj.org/article/5cd07351eb6f4beba2c26048a3fe516d)) — beat/downbeat → structure → cue points → crossfade pipeline;
  Sowula & Knees, *Mosaikbox* (TU Wien 2024, [record](https://repositum.tuwien.at/handle/20.500.12708/212628)).
