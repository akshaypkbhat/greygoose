# Grey Goose — To do and context

## Context
- Goal: a Mac DJ app with two decks, a simple controller (EQ, volume fader, 4 hot cues per deck), and a local library. SoundCloud is out for now; local audio files only.
- Current build: The app is a browser prototype (plain HTML/JS, Web Audio, Web MIDI with learn). Run with `python3 -m http.server` and open in Chrome.
- Planned: wrap in Electron for a real Mac app, which also gives folder browsing and `:cd`.
- Mockups live on the "Grey Goose UI Mockups" canvas (https://claude.ai/artifact/U1TyW6aWVqbgvhzqZgqeHJ). Quad 01 is the current layout: 1440×900 Mac screen, quadrants with 16px gutters.

## UI spec
Palette (one set for every window):
- Primary: grey. Screen `#2E2D2A`, windows `#3A3935`, lanes `#45433E`.
- Accent: cyan `#54D5E1` (active cue, playhead, active beat, selected row marker).
- Secondary: dark purple `#2F2340` (BPM pills, key chips `#3A3550`, selected row `#3E3560`).
- Text: `#E6E3DC` primary, `#B9B7B2` and `#8E8A80` secondary.
- Type: SF Mono Bold 20 for the library windows. Keep the same family across all windows.

Layout (Quad 01):
- Top left: directory search (`~/Music/Sets`, BPM pills, 1/2 load keys, vim key row).
- Top right: controller (vinyl, EQ knob, fader and 4 hot-cue pads per deck, master fader, crossfader).
- Bottom: two-track view (waveforms with beat-grid lines, BPM readouts, beat counter 1 2 3 4, master BPM, sync readout).

## Done
- [x] Controller mockups (01 Classic, 04 Turntable focus)
- [x] Library mockups (Lib 01, Var 01–06, with vim keys and no terminal line)
- [x] Quad 01 layout with the palette above
- [x] Basic beat counter and BPM readouts in the two-track view (mockup)
- [x] Removed superseded mockups from the canvas (their files remain in the local scratchpad)

## To do — UI
- [ ] Render-check Quad 01 and the library boards (none checked yet)
- [ ] Carry the Quad 01 palette into the Electron app's CSS
- [ ] Decide whether the purple pills should also hold the key chips on the library boards
- [ ] Build the directory-search window in the app (with `:cd` once Electron is in place)
- [ ] Build the two-track window in the app (waveforms, beat grid, BPM readout)
- [ ] Build the controller window in the app

## Sync requirements (decided)
- Waveform shows a basic 4/4 grid: a tick on every beat, a cyan bar line every 4 beats.
- Manual use: the DJ lines up the beat ticks by ear and eye across both decks.
- Auto sync: a SYNC button matches tempo and phase to the other deck, the way Mixxx does it. Mixxx gets its beatgrid from its own detector, and manual correction is rarely needed.
- No per-beat editing, slipping or nudging for now.
- Beat detection (below) feeds the grid and SYNC.

## Done — beat detection switcher (app)
- [x] Header switcher with three methods: autocorrelation grid (basic, 148.3 BPM on the test track), beat tracker 70–180 BPM (152.0), beat tracker 60–110 BPM (78.1). Loaded tracks re-analyse when you change it.
- [x] Serato's detection method is not published. Its newest engine, Lucid Beatgrids (DJ 5.0 beta), follows tempo changes and detects downbeats. No internal details were found.
- [ ] Which method is right needs a listen test on tracks with a known tempo. The 148 vs 74 BPM octave question is still open.

## Done — pickup for mapped knobs and faders (app)
- [x] A mapped knob or fader only takes over once it reaches the on-screen value (within 3% of its range), so it doesn't jump to its own absolute position.
- [x] Moving the on-screen control, or learning a new mapping, puts the control back into pickup.
- [x] Tested in the browser pane: values far from the on-screen value are ignored, and the control takes over once the fader gets close.
- [ ] Not tested with a real controller. Relative encoders (endless knobs) are not supported yet.

## Done — scrubbing (app)
- [x] Drag across a live waveform to move through the track; click to jump to a point.
- [x] Position slider per deck (`A.seek`, `B.seek`), so a fader can be mapped to scrub. Teach it with MIDI learn.
- [x] Tested in the browser pane: click, drag and slider all move the playhead.

## Done — quadrant layout (app)
- [x] Library top-left, controller top-right (both decks, crossfader, master), tracks across the bottom (BPM box left of each live waveform).
- [x] Stacks to one column below 900 px wide.
- [x] Checked in the browser pane: panels in the right places, lanes hold the waveform canvases, no console errors.
- [ ] Layout not checked at 1440×900 (the mockup size) or on a phone-width window.

## Done — MIDI mapping and controls (app)
- [x] Every control has a MIDI id: play, cue, tempo, EQ low/mid/high, filter, echo, reverb, volume, sync, zoom in/out, hot cues 1–4 per deck, crossfader, master, library up/down, load to A/B.
- [x] Hot cues: first press stores the playhead, later presses jump to it.
- [x] Library selection (up/down) with load to A or B.
- [x] Tested in the browser pane: all 40 controls learn a binding, and hot cue, zoom, library load and SYNC work from MIDI messages.
- [ ] Not tested with a real controller. Learn uses note/CC numbers from the device.
- [ ] Hot cues have no clear action yet (long press to delete).

## Done — first pass waveform and analysis (app)
- [x] `analyze.js`: mono mix, peaks, onset envelope, autocorrelation BPM (70–180), comb phase search for the beat grid, bar phase.
- [x] Each deck draws its waveform: grey for quiet, cyan for loud, beat ticks, cyan bar lines every 4 beats, playhead.
- [x] BPM pill per deck, updated when a track loads.
- [x] Tested on heatcheck4you.mp3: 393 beats over 159 s; estimate 148.3 BPM, first beats at 0.06 s and 0.47 s.
- [ ] Octave check: 148 may be double time (74). Confirm by ear before trusting the grid.

## To do — beat and BPM detection (priority)
Goal: find a strong BPM and beat-tracking algorithm first. Quick switching between algorithms comes later, but design the detector behind a simple interface so swapping is easy.

Candidates from research so far:
- **Beat This!** (CPJKU, JKU Linz): current state of the art in a 2026 study. Beat and downbeat tracking without DBN postprocessing. Code and weights reported as MIT, but I haven't confirmed the upstream LICENSE file. Check before shipping.
- **madmom**: strong MIR toolkit. Its pretrained models are non-commercial (CC BY-NC-SA), so it's a poor fit for a commercial product. Fine for research and comparison.
- **librosa**: easiest to use, ISC-licensed, but less accurate on hard material. Good as a baseline.
- **essentia**: broad MIR library in C++ with Python bindings. Check its license before shipping (AGPL for the open-source build).
- **aubio**: lightweight C library. Older and less focused on modern beat tracking.

Plan:
1. Confirm the Beat This! license from the upstream `LICENSE` file.
2. Benchmark Beat This!, librosa, and one more (e.g. essentia) on a set of your own tracks. Score with `mir_eval` (F-measure for beats and downbeats, and tempo accuracy).
3. Pick a default. Add a simple `Detector` interface (input: audio buffer; output: BPM, beat times, downbeats) so other algorithms can be swapped in later.
4. Later: a quick switch in the UI, plus a manual "set first beat" or grid nudge if the match isn't good. Nudging and slipping are out of scope for now.

## Open questions
- Target Mac build: Electron or native (JUCE)? Electron is the current plan.
- Does the detector run in the app (on load) or offline (cache results per file)? Offline caching is probably better for large libraries.
