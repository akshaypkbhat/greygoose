// Grey Goose: two-deck Web Audio mixer with Web MIDI and MIDI learn.
// No dependencies. Load local audio files into the library, send them to decks A or B.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const library = [];          // { name, url } from local files
const decks = {};            // { A: Deck, B: Deck }
let ctx = null, master = null, echoIn = null, revIn = null;
let learnMode = false;
// MIDI output (controller LEDs). LED[id] = { ch, note } once the controller's LED address is known; null = not yet.
let midiOut = null;
const LED = { 'A.play': null, 'B.play': null, 'A.hc1': null, 'A.hc2': null, 'A.hc3': null, 'A.hc4': null, 'B.hc1': null, 'B.hc2': null, 'B.hc3': null, 'B.hc4': null };
function led(id, on) {
  const addr = LED[id];
  if (!midiOut || !addr) return;
  midiOut.send([0x90 | (addr.ch - 1), addr.note, on ? 127 : 0]);
}
// Pad or button held state: the screen and the controller LED change together.
function setHeld(el, on) {
  el.classList.toggle('held', on);
  led(el.dataset.ctl, on);
}
const pickedUp = new Set(); // controls whose physical position has reached the on-screen value
const JOG_SEC = 0.002; // seconds the playhead moves per jog tick (finest practical scrub)
const SCRATCH_SEC = 0.001; // seconds per tick while the jog is touched (scratch)
let currentAlgo = 'autocorr'; // beat detection algorithm, chosen in the header
let armed = null;            // control id waiting for a MIDI input
const BIND_KEY = 'minidj.bindings.v1'; // declared before use, so the saved bindings load on startup
let bindings = loadBindings(); // { "cc:1:7": "A.tempo", "note:1:11": "A.play", ... }

function setStatus(msg) { $('#status').textContent = msg; }

function loadBindings() {
  try { return JSON.parse(localStorage.getItem(BIND_KEY)) || {}; } catch { return {}; }
}
function saveBindings() {
  try { localStorage.setItem(BIND_KEY, JSON.stringify(bindings)); } catch { /* storage blocked: bindings last only this session */ }
}

function fmt(s) {
  if (!isFinite(s)) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function makeImpulse(seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  return buf;
}

function ensureAudio() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.connect(ctx.destination);

  // Echo bus: delay with feedback, returns to master.
  const delay = ctx.createDelay(2);
  delay.delayTime.value = 0.375;
  const fb = ctx.createGain();
  fb.gain.value = 0.45;
  echoIn = ctx.createGain();
  echoIn.connect(delay);
  delay.connect(fb);
  fb.connect(delay);
  delay.connect(master);

  // Reverb bus: generated impulse response.
  const conv = ctx.createConvolver();
  conv.buffer = makeImpulse(2.5);
  revIn = ctx.createGain();
  revIn.connect(conv);
  conv.connect(master);

  decks.A = new Deck('A');
  decks.B = new Deck('B');
}

function biquad(type, freq) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  return f;
}

class Deck {
  constructor(id) {
    this.id = id;
    this.name = null;
    this.zoomBars = 4; // bars shown on each side of the playhead
    this.synced = false; // true after SYNC (tempo locked to the other deck)
    this.cues = {}; // hot cues 1-4: position in seconds
    this.recording = false; // REC: log jog movement
    this.rec = []; // recorded jog events: { t (ms), step, pos (s) }
    this.recStart = 0;
    this.lastJog = 0;
    this.el = new Audio();
    // Play's controller LED follows whether this track is playing.
    this.el.addEventListener('play', () => led(`${id}.play`, true));
    this.el.addEventListener('pause', () => led(`${id}.play`, false));
    this.el.preservesPitch = true;
    this.el.preload = 'auto';

    const src = ctx.createMediaElementSource(this.el);
    this.low = biquad('lowshelf', 200);
    this.mid = biquad('peaking', 1000);
    this.mid.Q.value = 1;
    this.high = biquad('highshelf', 4000);
    this.filter = biquad('allpass', 1000);
    this.vol = ctx.createGain();
    this.xf = ctx.createGain();       // crossfader side
    this.echo = ctx.createGain();     // send to echo bus
    this.verb = ctx.createGain();     // send to reverb bus
    this.echo.gain.value = 0;
    this.verb.gain.value = 0;

    src.connect(this.low);
    this.low.connect(this.mid);
    this.mid.connect(this.high);
    this.high.connect(this.filter);
    this.filter.connect(this.vol);
    this.vol.connect(this.xf);
    this.xf.connect(master);
    this.vol.connect(this.echo);
    this.echo.connect(echoIn);
    this.vol.connect(this.verb);
    this.verb.connect(revIn);

    this.el.addEventListener('play', () => this.syncButton());
    this.el.addEventListener('pause', () => this.syncButton());
    this.el.addEventListener('ended', () => this.syncButton());
    this.el.addEventListener('timeupdate', () => this.syncTime());
    this.el.addEventListener('loadedmetadata', () => this.syncTime());
  }

  async toggle() {
    if (!this.el.src) return setStatus(`Load a track into deck ${this.id} first.`);
    await ctx.resume();
    if (this.el.paused) this.el.play().catch(err => setStatus(`Playback failed: ${err.message}`));
    else this.el.pause();
  }

  cue() {
    this.el.pause();
    this.el.currentTime = 0;
    this.syncTime();
  }

  // SYNC: set this deck's tempo to the other deck's BPM; press again to release.
  toggleSync() {
    const other = decks[this.id === 'A' ? 'B' : 'A'];
    if (!this.synced) {
      if (!this.analysis || !other.analysis) return setStatus('Sync needs both tracks analysed.');
      this.tempoValue = other.analysis.bpm / this.analysis.bpm;
      this.applyRate();
      this.synced = true;
    } else {
      this.synced = false;
      this.tempoValue = 1;
      this.applyRate();
    }
    this.syncVisual();
  }

  syncVisual() {
    const btn = $(`#sync-${this.id}`);
    if (btn) btn.classList.toggle('on', this.synced);
  }

  // Hot cue n: first press stores the playhead, later presses jump to it.
  hotCue(n) {
    if (this.cues[n] == null) this.cues[n] = this.el.currentTime;
    else this.el.currentTime = this.cues[n];
    this.syncHotCues();
  }

  syncHotCues() {
    [1, 2, 3, 4].forEach((n) => {
      const btn = $(`#hc${n}-${this.id}`);
      if (btn) btn.classList.toggle('on', this.cues[n] != null);
    });
  }

  // Jog: each tick moves the playhead, like dragging on the waveform. Fast spins move further.
  jog(step) {
    this.spin(step);
    if (!isFinite(this.el.duration)) return;
    this.lastJog = step;
    // Top turn: scrub the playhead, whether or not the track is playing. Touched = finer scratch steps.
    const per = this.scratching ? SCRATCH_SEC : JOG_SEC;
    this.el.currentTime = Math.max(0, Math.min(this.el.duration, (this.el.currentTime || 0) + step * per));
    if (this.recording) this.rec.push({ t: performance.now() - this.recStart, step, pos: this.el.currentTime });
    this.recSync();
  }

  // Turn the on-screen jog wheel by one tick per 15 degrees, whether the turn came from the mouse or MIDI.
  spin(step) {
    this.spinDeg = (this.spinDeg || 0) + step * 15;
    const j = $(`#jog-${this.id}`);
    if (j) j.style.transform = `rotate(${this.spinDeg}deg)`;
  }

  // Playback rate = tempo slider (or sync) plus a temporary nudge that decays back to it.
  applyRate() {
    this.el.playbackRate = (this.tempoValue ?? 1) + (this.nudgeOffset || 0);
  }

  // Outer edge turn: nudge while playing; move the playhead a little when paused.
  edgeTurn(step) {
    this.spin(step);
    if (!isFinite(this.el.duration)) return;
    this.lastJog = step;
    if (this.el.paused) {
      this.el.currentTime = Math.max(0, Math.min(this.el.duration, (this.el.currentTime || 0) + step * JOG_SEC));
    } else {
      this.nudge(step);
    }
    this.recSync();
  }

  // Outer edge nudge: speeds or slows the track for a moment, then it returns to the set tempo.
  nudge(step) {
    this.nudgeOffset = Math.max(-0.1, Math.min(0.1, (this.nudgeOffset || 0) + step * 0.01));
    this.applyRate();
    if (this.nudgeFrame) return;
    const decay = () => {
      this.nudgeOffset *= 0.85;
      if (Math.abs(this.nudgeOffset) < 0.0005) this.nudgeOffset = 0;
      this.applyRate();
      this.nudgeFrame = this.nudgeOffset ? setTimeout(decay, 16) : 0; // a timer, so it still runs when frames are throttled
    };
    this.nudgeFrame = setTimeout(decay, 16);
  }

  // Touch scratch: while the jog is touched the track stops and turns move it in small steps.
  // Release resumes playback, if it was playing before the touch.
  setScratch(on) {
    if (on === !!this.scratching) return;
    this.scratching = on;
    if (on) {
      this.resumeAfterScratch = !this.el.paused;
      this.el.pause();
    } else if (this.resumeAfterScratch) {
      this.el.play().catch(() => {});
    }
    const j = $(`#jog-${this.id}`);
    if (j) j.classList.toggle('scratching', on);
  }

  // REC: start or stop logging jog movement. Stopping keeps the log for replay.
  toggleRec() {
    if (!this.recording) {
      this.recording = true;
      this.rec = [];
      this.recStart = performance.now();
    } else {
      this.recording = false;
    }
    this.recSync();
  }

  // Replay the recorded movement through the track, with the same timing it was recorded at.
  replay() {
    if (this.recording) return setStatus('Stop recording before replaying.');
    if (!this.rec.length) return setStatus(`Deck ${this.id}: nothing recorded yet.`);
    const log = this.rec.slice();
    const start = performance.now();
    const tick = () => {
      const now = performance.now() - start;
      while (log.length && log[0].t <= now) this.el.currentTime = log.shift().pos;
      if (log.length) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // Live readout: REC state, recorded events, the last jog step and the playhead.
  recSync() {
    const btn = $(`#rec-${this.id}`);
    if (btn) btn.classList.toggle('on', this.recording);
    const info = $(`#recinfo-${this.id}`);
    if (info) {
      const n = this.rec.length;
      const steps = this.rec.map((e) => e.step);
      const range = n ? ` · steps ${Math.min(...steps)} … ${Math.max(...steps)}` : '';
      info.textContent = `${this.recording ? 'REC' : 'idle'} · ${n} events${range} · last ${this.lastJog > 0 ? '+' : ''}${this.lastJog}`;
    }
  }

  // Position slider or fader: 0 = start, 1 = end of the track.
  seekFraction(f) {
    if (!isFinite(this.el.duration)) return;
    this.el.currentTime = f * this.el.duration;
  }

  load(item) {
    this.el.pause();
    this.el.src = item.url;
    this.el.load();
    this.name = item.name;
    $(`#name-${this.id}`).textContent = item.name;
    analyzeTrack(this, item);
    this.syncButton();
    this.syncTime();
  }

  // Filter: left = low-pass sweep, right = high-pass sweep, center = off.
  setFilter(v) {
    if (Math.abs(v) < 0.02) {
      this.filter.type = 'allpass';
    } else if (v < 0) {
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 20000 * Math.pow(0.01, -v); // 20 kHz down to 200 Hz
    } else {
      this.filter.type = 'highpass';
      this.filter.frequency.value = 20 * Math.pow(100, v);      // 20 Hz up to 2 kHz
    }
  }

  syncButton() {
    const b = $(`#play-${this.id}`);
    if (b) b.textContent = this.el.paused ? 'Play' : 'Pause';
    const v = $(`#vinyl-${this.id}`);
    if (v) v.classList.toggle('playing', !this.el.paused);
  }

  syncTime() {
    const t = $(`#time-${this.id}`);
    if (t) t.textContent = `${fmt(this.el.currentTime)} / ${fmt(this.el.duration)}`;
    const s = $(`#seek-${this.id}`);
    if (s && isFinite(this.el.duration) && this.el.duration > 0) s.value = this.el.currentTime / this.el.duration;
  }
}

// Deck layout follows the picked mockup: name, faders, four pads, transport. Everything else sits in "More".
const DECK_TEMPLATE = (id) => `
  <h3>Deck ${id}</h3>
  <div class="name" id="name-${id}">No track loaded</div>
  <div class="time" id="time-${id}">0:00 / 0:00</div>
  <div class="faders">
    <label class="fader">Tempo<input type="range" min="0.92" max="1.08" step="0.001" value="1" data-ctl="${id}.tempo"></label>
    <label class="fader" title="Left = low-pass, right = high-pass, center = off">Filter<input type="range" min="-1" max="1" step="0.01" value="0" data-ctl="${id}.filter"></label>
    <label class="fader">Volume<input type="range" min="0" max="1.2" step="0.01" value="1" data-ctl="${id}.vol"></label>
  </div>
  <div class="row hotcues pads">${[1, 2, 3, 4].map((n) => `<button data-ctl="${id}.hc${n}" id="hc${n}-${id}" aria-label="Hot cue ${n}">${n}</button>`).join('')}</div>
  <div class="row transport">
    <button data-ctl="${id}.play" id="play-${id}">Play</button>
    <button data-ctl="${id}.cue">Cue</button>
    <button data-ctl="${id}.sync" id="sync-${id}">Sync</button>
  </div>
  <div class="row jogrow"><div class="jog" data-ctl="${id}.jog" id="jog-${id}" aria-label="Jog wheel, deck ${id}">JOG</div></div>
  <div hidden>
    <div class="vinyl" id="vinyl-${id}"></div>
    <div class="row"><button data-ctl="${id}.zoomout" id="zoomout-${id}" aria-label="Zoom out">−</button><span class="pill" id="zoom-${id}">±4 bars</span><button data-ctl="${id}.zoomin" id="zoomin-${id}" aria-label="Zoom in">+</button></div>
    <div class="row"><button data-ctl="${id}.rec" id="rec-${id}">● REC</button><button data-ctl="${id}.replay">▶ Replay</button></div>
    <div class="row"><span class="pill" id="recinfo-${id}">idle · 0 events</span></div>
    <div class="row"><label style="width:100%">Position<input type="range" min="0" max="1" step="0.0005" value="0" id="seek-${id}" data-ctl="${id}.seek"></label></div>
    <div class="eq">
      <label>Low <input type="range" min="-12" max="12" step="0.1" value="0" data-ctl="${id}.low"></label>
      <label>Mid <input type="range" min="-12" max="12" step="0.1" value="0" data-ctl="${id}.mid"></label>
      <label>High <input type="range" min="-12" max="12" step="0.1" value="0" data-ctl="${id}.high"></label>
    </div>
    <div class="row"><label style="width:100%">Echo <input type="range" min="0" max="1" step="0.01" value="0" data-ctl="${id}.echo"></label></div>
    <div class="row"><label style="width:100%">Reverb <input type="range" min="0" max="1" step="0.01" value="0" data-ctl="${id}.verb"></label></div>
  </div>
`;

// Each track's lane in the bottom panel: BPM box on the left, live waveform on the right.
const WAVE_TEMPLATE = (id) => `
  <div class="name" id="lanename-${id}">Deck ${id}</div>
  <div class="wave-row"><div class="bpmcol" id="bpmbox-${id}"><span id="bpm-${id}">--.-</span><small>BPM</small></div><canvas class="wave" id="wave-${id}" aria-label="Deck ${id} waveform"></canvas></div>
`;

// Apply one control's current value to the audio graph.
function apply(id, el) {
  const [d, c] = id.includes('.') ? id.split('.') : [null, id];
  if (!d) {
    if (c === 'xfade' && ctx) {
      const x = +el.value;
      decks.A.xf.gain.value = Math.cos(x * Math.PI / 2);
      decks.B.xf.gain.value = Math.sin(x * Math.PI / 2);
    }
    if (c === 'master' && master) master.gain.value = +el.value;
    return;
  }
  if (d === 'lib') return libAction(c);
  const deck = decks[d];
  if (!deck) return;
  const v = +el.value;
  switch (c) {
    case 'play': deck.toggle(); break;
    case 'sync': deck.toggleSync(); break;
    case 'seek': deck.seekFraction(v); break;
    case 'rec': deck.toggleRec(); break;
    case 'replay': deck.replay(); break;
    case 'zoomin': zoomDeck(deck, 1 / 1.5); break;
    case 'zoomout': zoomDeck(deck, 1.5); break;
    case 'hc1': case 'hc2': case 'hc3': case 'hc4': deck.hotCue(+c.slice(2)); break;
    case 'cue': deck.cue(); break;
    case 'tempo': deck.tempoValue = v; deck.applyRate(); deck.synced = false; deck.syncVisual(); break;
    case 'low': deck.low.gain.value = v; break;
    case 'mid': deck.mid.gain.value = v; break;
    case 'high': deck.high.gain.value = v; break;
    case 'filter': deck.setFilter(v); break;
    case 'echo': deck.echo.gain.value = v; break;
    case 'verb': deck.verb.gain.value = v; break;
    case 'vol': deck.vol.gain.value = v; break;
  }
}

// ---- Waveform + analysis ----

// Scrub on the live waveform: drag to move through the track, or click to jump to a point.
function attachScrub(deck) {
  const c = document.getElementById(`wave-${deck.id}`);
  let drag = null;
  const spanSec = () => 2 * deck.zoomBars * ((4 * 60) / deck.analysis.bpm);
  c.addEventListener('pointerdown', (e) => {
    if (!deck.analysis) return;
    c.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, t: deck.el.currentTime || 0, moved: false };
  });
  c.addEventListener('pointermove', (e) => {
    if (!drag || !deck.analysis) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 3) drag.moved = true;
    const w = c.clientWidth || 600;
    deck.el.currentTime = Math.max(0, Math.min(deck.analysis.duration, drag.t - (dx / w) * spanSec()));
  });
  c.addEventListener('pointerup', (e) => {
    if (drag && !drag.moved && deck.analysis) {
      // Click without a drag: jump to the point under the cursor.
      const rect = c.getBoundingClientRect();
      const span = spanSec();
      const t = drag.t - span / 2 + ((e.clientX - rect.left) / rect.width) * span;
      deck.el.currentTime = Math.max(0, Math.min(deck.analysis.duration, t));
    }
    drag = null;
  });
  c.addEventListener('pointercancel', () => { drag = null; });
}

// Decode the file and estimate BPM and beat grid. Results land on deck.analysis.
async function analyzeTrack(deck, item) {
  ensureAudio();
  const token = deck.loadToken = {};
  deck.item = item; // kept so the algorithm switcher can re-analyse this track
  setStatus(`Analysing "${item.name}" with ${Analyze.ALGORITHMS[currentAlgo].label}…`);
  try {
    const data = await (await fetch(item.url)).arrayBuffer();
    const buf = await ctx.decodeAudioData(data);
    if (deck.loadToken !== token) return; // a newer track was loaded meanwhile
    deck.analysis = Analyze.run(buf, 1200, currentAlgo);
    $(`#bpm-${deck.id}`).textContent = deck.analysis.bpm.toFixed(1);
    setStatus(`"${item.name}": ${deck.analysis.bpm.toFixed(1)} BPM (estimate)`);
  } catch (err) {
    setStatus(`Analysis failed: ${err.message}`);
  }
}

// Draw amplitude (grey quiet, cyan loud), beat ticks, bar lines and the playhead.
function drawWave(deck) {
  const c = document.getElementById(`wave-${deck.id}`);
  if (!c) return;
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth || 600, h = c.clientHeight || 72;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const a = deck.analysis;
  if (!a) return;

  const mid = h / 2, n = a.peaks.max.length;
  let maxRms = 0;
  for (let i = 0; i < n; i++) if (a.peaks.rms[i] > maxRms) maxRms = a.peaks.rms[i];
  for (let x = 0; x < w; x++) {
    const b = Math.min(n - 1, Math.floor((x / w) * n));
    const y1 = mid - a.peaks.max[b] * mid;
    const y2 = mid - a.peaks.min[b] * mid;
    g.fillStyle = a.peaks.rms[b] > 0.6 * maxRms ? '#54D5E1' : '#8E8A80';
    g.fillRect(x, y1, 1, Math.max(1, y2 - y1));
  }
  // Beat ticks along the bottom; bar lines (every 4 beats, from the bar-1 phase) in full height.
  a.beats.forEach((t, k) => {
    const x = (t / a.duration) * w;
    if (((k - a.barPhase) % 4 + 4) % 4 === 0) {
      g.fillStyle = '#54D5E1';
      g.fillRect(x, 0, 2, h);
    } else {
      g.fillStyle = '#B9B7B2';
      g.fillRect(x, h - 10, 1, 10);
    }
  });
  // Playhead
  const px = (deck.el.currentTime / a.duration) * w;
  g.fillStyle = '#E6E3DC';
  g.fillRect(px, 0, 2, h);
}

// Live zoomed view: playhead fixed in the centre, the track scrolls under it.
// deck.zoomBars = bars shown on each side of the playhead (default 4).
function drawLive(deck) {
  const c = document.getElementById(`wave-${deck.id}`);
  if (!c || !deck.analysis) return;
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth || 600, h = c.clientHeight || 96;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const a = deck.analysis;

  const barSec = (4 * 60) / a.bpm;
  const halfSpan = deck.zoomBars * barSec; // seconds on each side of the playhead
  const span = 2 * halfSpan;
  const t0 = (deck.el.currentTime || 0) - halfSpan;

  // Amplitude: grey quiet, cyan loud.
  const n = a.peaks.max.length, mid = h / 2;
  let maxRms = 0;
  for (let i = 0; i < n; i++) if (a.peaks.rms[i] > maxRms) maxRms = a.peaks.rms[i];
  for (let x = 0; x < w; x++) {
    const t = t0 + (x / w) * span;
    if (t < 0 || t >= a.duration) continue;
    const b = Math.min(n - 1, Math.floor((t / a.duration) * n));
    const y1 = mid - a.peaks.max[b] * mid;
    const y2 = mid - a.peaks.min[b] * mid;
    g.fillStyle = a.peaks.rms[b] > 0.6 * maxRms ? '#54D5E1' : '#8E8A80';
    g.fillRect(x, y1, 1, Math.max(1, y2 - y1));
  }

  // Beat ticks, and cyan bar lines every 4 beats.
  a.beats.forEach((bt, k) => {
    if (bt < t0 || bt > t0 + span) return;
    const x = ((bt - t0) / span) * w;
    if (((k - a.barPhase) % 4 + 4) % 4 === 0) {
      g.fillStyle = '#54D5E1';
      g.fillRect(x, 0, 2, h);
    } else {
      g.fillStyle = '#B9B7B2';
      g.fillRect(x, h - 10, 1, 10);
    }
  });

  // Centre playhead.
  g.fillStyle = '#E6E3DC';
  g.fillRect(w / 2 - 1, 0, 2, h);
}

function zoomDeck(deck, factor) {
  deck.zoomBars = Math.min(32, Math.max(0.5, deck.zoomBars * factor));
  $(`#zoom-${deck.id}`).textContent = `±${deck.zoomBars.toFixed(deck.zoomBars < 2 ? 1 : 0)} bars`;
}

// Purple BPM box when the deck is synced, or when both decks have the same BPM.
function updateBpmBoxes() {
  const a = decks.A, b = decks.B;
  const matched = !!(a && b && a.analysis && b.analysis && Math.abs(a.analysis.bpm - b.analysis.bpm) < 0.05);
  ['A', 'B'].forEach((id) => {
    const d = decks[id];
    const box = $(`#bpmbox-${id}`);
    if (box && d) box.classList.toggle('synced', d.synced || matched);
  });
}

function drawLoop() {
  updateBpmBoxes();
  drawLive(decks.A || {});
  drawLive(decks.B || {});
  requestAnimationFrame(drawLoop);
}

// ---- Library ----

// Library selection, driven by the lib.* controls (up, down, load to A, load to B).
let libSel = 0;

// Library knob: 0 = first track, 1 = last track. Turning it moves the selection.
let libKnobValue = 0;
function libScrollTo(v) {
  const n = library.length;
  libKnobValue = Math.max(0, Math.min(1, v));
  drawLibKnob();
  if (!n) return;
  libSel = Math.round(libKnobValue * (n - 1));
  renderLibrary();
}
// Relative turn from the controller: move the selection by `step` tracks, wrapping at both ends.
function libMove(step) {
  const n = library.length;
  if (!n) return;
  libSel = Math.max(0, Math.min(n - 1, libSel + step)); // stop at the first and last track
  libKnobValue = n > 1 ? libSel / (n - 1) : 0;
  drawLibKnob();
  renderLibrary();
}
function drawLibKnob() {
  const k = document.getElementById('lib-knob');
  if (!k) return;
  k.style.transform = `rotate(${-135 + libKnobValue * 270}deg)`; // -135 to +135 degrees, like a real knob
  k.setAttribute('aria-valuenow', libKnobValue.toFixed(2));
}

function libAction(c) {
  if (c === 'up' || c === 'down') {
    libSel = Math.max(0, Math.min(library.length - 1, libSel + (c === 'up' ? -1 : 1)));
    renderLibrary();
  } else if (c === 'loadA' || c === 'loadB') {
    if (library[libSel]) loadTo(c === 'loadA' ? 'A' : 'B', libSel);
  }
}

function btn(text, fn) {
  const b = document.createElement('button');
  b.textContent = text;
  b.addEventListener('click', fn);
  return b;
}

function renderLibrary() {
  const ul = $('#track-list');
  ul.innerHTML = '';
  library.forEach((t, i) => {
    const li = document.createElement('li');
    if (i === libSel) li.classList.add('sel');
    const span = document.createElement('span');
    span.textContent = t.name;
    span.title = t.name;
    li.append(span, btn('→ A', () => loadTo('A', i)), btn('→ B', () => loadTo('B', i)));
    ul.append(li);
  });
}

function loadTo(d, i) {
  ensureAudio();
  decks[d].load(library[i]);
  setStatus(`Loaded "${library[i].name}" on deck ${d}.`);
}

function addFiles(files) {
  let added = 0;
  for (const f of files) {
    if (!f.type.startsWith('audio/') && !/\.(mp3|wav|aiff?|m4a|flac|ogg)$/i.test(f.name)) continue;
    library.push({ name: f.name.replace(/\.[^.]+$/, ''), url: URL.createObjectURL(f) });
    added++;
  }
  renderLibrary();
  setStatus(added ? `${library.length} track(s) in library.` : 'No audio files found in that selection.');
}

// ---- Controls + MIDI learn ----

function arm(id, el) {
  armed = id;
  $$('.learning').forEach(x => x.classList.remove('learning'));
  el.classList.add('learning');
  setStatus(`Learn: move or press your controller for "${id}".`);
}

function bindControls() {
  $$('[data-ctl]').forEach(el => {
    const id = el.dataset.ctl;
    el.addEventListener('pointerdown', e => {
      if (learnMode) { e.preventDefault(); arm(id, el); }
    });
    el.addEventListener(el.tagName === 'BUTTON' ? 'click' : 'input', () => {
      if (!learnMode) {
        pickedUp.delete(id); // the on-screen value moved, so the physical control must reach it again
        apply(id, el);
      }
    });
  });
}

function onMidi(e) {
  const [status, d1 = 0, d2 = 0] = e.data;
  const kind = status & 0xf0;
  const ch = (status & 0x0f) + 1;
  let key, value;
  if (kind === 0xb0) {                        // control change: knobs, faders
    key = `cc:${ch}:${d1}`;
    value = d2 / 127;
  } else if (kind === 0x90 || kind === 0x80) { // note on / off: buttons, pads
    key = `note:${ch}:${d1}`;
    value = kind === 0x90 && d2 > 0 ? 1 : 0;
  } else {
    return;                                    // clock, pitch bend, etc. ignored
  }
  $('#midi-monitor').textContent = `Last input: ${key} (value ${d2})`;

  if (armed) {
    // A jog keeps one turn (CC) and one touch (note), so learning one does not clear the other.
    const sameKind = (k) => !armed.endsWith('.jog') || k.split(':')[0] === key.split(':')[0];
    for (const k of Object.keys(bindings)) if (bindings[k] === armed && sameKind(k)) delete bindings[k];
    bindings[key] = armed;
    pickedUp.delete(armed); // a new mapping starts in pickup mode
    saveBindings();
    setStatus(`Bound ${key} to "${armed}".`);
    $$('.learning').forEach(x => x.classList.remove('learning'));
    armed = null;
    return;
  }

  const id = bindings[key];
  if (!id) return;
  // Jog: a relative encoder. Each tick is 1 (clockwise) or 127 (anticlockwise) in two's complement style.
  if (id.endsWith('.jog')) {
    const jogDeck = decks[id.split('.')[0]];
    if (kind === 0x90 || kind === 0x80) { // a note on the jog is its touch sensor
      if (jogDeck) jogDeck.setScratch(value === 1);
      return;
    }
    if (kind !== 0xb0) return;
    const step = d2 >= 64 ? d2 - 128 : d2;
    const dk = decks[id.split('.')[0]];
    if (dk && step) dk.jog(step);
    return;
  }
  // Library knob (mapped to your master knob): a relative encoder, so each turn moves one track and the list wraps.
  if (id === 'lib.scroll') {
    if (kind === 0xb0) libMove(d2 >= 64 ? d2 - 128 : d2); // relative: 1 = one track one way, 127 = one track the other
    return;
  }

  // Outer edge of the jog: a relative CC that only nudges the speed (or moves the playhead when paused).
  if (id.endsWith('.nudge')) {
    if (kind !== 0xb0) return;
    const step = d2 >= 64 ? d2 - 128 : d2;
    const dk = decks[id.split('.')[0]];
    if (dk && step) dk.edgeTurn(step);
    return;
  }
  const el = document.querySelector(`[data-ctl="${id}"]`);
  if (!el) return;
  if (el.tagName === 'BUTTON') {
    const pressed = kind === 0xb0 ? d2 >= 64 : value === 1; // CC buttons press at 64 and up
    if (/\.hc[1-4]$/.test(id)) setHeld(el, pressed); // pads light only while held
    if (pressed) apply(id, el);                              // trigger on press only
    return;
  }
  // Pickup (soft takeover): a physical knob or fader only takes over once it reaches the
  // on-screen value, so moving it does not jump the control to its own absolute position.
  const span = +el.max - +el.min;
  const target = +el.min + value * span;
  if (!pickedUp.has(id)) {
    if (Math.abs(target - +el.value) > span * 0.03) return; // not there yet
    pickedUp.add(id);
  }
  el.value = target;
  apply(id, el);
}

// Find the LEDs: sends note-on to each note on channel 1, one at a time, so you can see which one lights.
async function findLeds() {
  if (!midiOut) return setStatus('No MIDI output. Click Connect MIDI first.');
  for (let n = 0; n < 128; n++) {
    midiOut.send([0x90, n, 127]);
    setStatus(`LED test: note ${n}, channel 1. Note which LED lit.`);
    await new Promise(r => setTimeout(r, 350));
    midiOut.send([0x90, n, 0]);
  }
  setStatus('LED test finished. Tell me which note lit the cue pad and the play button.');
}

async function connectMidi() {
  if (!navigator.requestMIDIAccess) return setStatus('Web MIDI is not available here. Use Chrome.');
  try {
    const access = await navigator.requestMIDIAccess({ sysex: false });
    const inputs = [...access.inputs.values()];
    inputs.forEach(inp => { inp.onmidimessage = onMidi; });
    const outs = [...access.outputs.values()];
    midiOut = outs.find(o => /hercules/i.test(o.name)) || outs[0] || null; // controller LEDs
    access.onstatechange = e => {
      if (e.port.type === 'input' && e.port.state === 'connected') e.port.onmidimessage = onMidi;
    };
    setStatus(inputs.length
      ? `MIDI: ${inputs.map(i => i.name).join(', ')}`
      : 'MIDI connected, but no inputs found. Plug in your controller and click Connect MIDI again.');
  } catch (err) {
    setStatus(`MIDI access failed: ${err.message}`);
  }
}

function toggleLearn() {
  learnMode = !learnMode;
  armed = null;
  $$('.learning').forEach(x => x.classList.remove('learning'));
  const b = $('#learn-toggle');
  b.textContent = `MIDI learn: ${learnMode ? 'on' : 'off'}`;
  b.classList.toggle('on', learnMode);
  setStatus(learnMode
    ? 'Learn on: click a control on screen, then move or press the matching control on your controller.'
    : 'Learn off.');
}

// ---- Save and load mappings as a file, so they don't depend on the address the app opens from ----
function saveMappings() {
  const blob = new Blob([JSON.stringify({ app: 'grey-goose', version: 1, bindings }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'grey-goose-mappings.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setStatus(`Saved ${Object.keys(bindings).length} mappings to grey-goose-mappings.json.`);
}

function loadMappings(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const b = data && data.bindings ? data.bindings : data;
      const valid = b && typeof b === 'object' && Object.entries(b).every(([k, v]) => typeof k === 'string' && typeof v === 'string');
      if (!valid) return setStatus('That file is not a Grey Goose mappings file.');
      bindings = b;
      saveBindings();
      pickedUp.clear();
      setStatus(`Loaded ${Object.keys(bindings).length} mappings from ${file.name}.`);
    } catch (err) {
      setStatus(`Could not read ${file.name}: ${err.message}`);
    }
  };
  reader.readAsText(file);
}

// ---- Init ----

function init() {
  $('#deck-A').innerHTML = DECK_TEMPLATE('A');
  $('#deck-B').innerHTML = DECK_TEMPLATE('B');
  $('#deck-A').classList.add('A');
  $('#deck-B').classList.add('B');
  $('#lane-A').innerHTML = WAVE_TEMPLATE('A');
  $('#lane-B').innerHTML = WAVE_TEMPLATE('B');
  // On-screen jog wheel: dragging it around its centre scrubs the track, like a MIDI jog tick.
  $$('.jog').forEach(j => {
    let last = null;   // angle of the pointer at the last move, or null when not dragging
    let onEdge = false; // the drag started on the outer ring
    const angleAt = (e) => {
      const r = j.getBoundingClientRect();
      return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
    };
    j.addEventListener('pointerdown', (e) => {
      try { j.setPointerCapture(e.pointerId); } catch { /* keep tracking even without capture */ }
      last = angleAt(e);
      // Top of the platter scratches; the outer ring only nudges the speed.
      const r = j.getBoundingClientRect();
      const fromCentre = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
      onEdge = fromCentre > (r.width / 2) * 0.8;
      if (!onEdge && decks[j.dataset.ctl.split('.')[0]]) decks[j.dataset.ctl.split('.')[0]].setScratch(true);
    });
    j.addEventListener('pointermove', (e) => {
      const deck = decks[j.dataset.ctl.split('.')[0]]; // looked up now: the decks are built after init wires the wheels
      if (last === null || !deck) return;
      const a = angleAt(e);
      let d = a - last;
      if (d > Math.PI) d -= 2 * Math.PI; // take the short way round
      if (d < -Math.PI) d += 2 * Math.PI;
      last = a;
      const ticks = d / (Math.PI / 12); // 15 degrees per tick
      if (onEdge) deck.edgeTurn(ticks); else deck.jog(ticks);
    });
    const end = () => {
      last = null;
      if (decks[j.dataset.ctl.split('.')[0]]) decks[j.dataset.ctl.split('.')[0]].setScratch(false);
    };
    j.addEventListener('pointerup', end);
    j.addEventListener('pointercancel', end);
  });

  // Mouse hold lights a pad the same way as a MIDI hold.
  $$('.pads button').forEach(b => {
    b.addEventListener('pointerdown', () => setHeld(b, true));
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, () => setHeld(b, false)));
  });

  ensureAudio();
  bindControls();
  requestAnimationFrame(drawLoop);

  attachScrub(decks.A);
  attachScrub(decks.B);

  // Zoom: wheel over a waveform, or the +/- buttons.
  ['A', 'B'].forEach((id) => {
    const d = decks[id];
    document.getElementById(`wave-${id}`).addEventListener('wheel', (e) => {
      e.preventDefault();
      zoomDeck(d, e.deltaY > 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });
  });
  $$('input[data-ctl]').forEach(el => apply(el.dataset.ctl, el)); // push defaults into the graph

  $('#midi-connect').addEventListener('click', connectMidi);
  $('#learn-toggle').addEventListener('click', toggleLearn);
  // Switcher: re-analyse the loaded tracks with the chosen algorithm.
  $('#algo').value = currentAlgo;
  $('#algo').addEventListener('change', (e) => {
    currentAlgo = e.target.value;
    ['A', 'B'].forEach((id) => {
      const d = decks[id];
      if (d.item) analyzeTrack(d, d.item);
    });
  });
  $('#save-mappings').addEventListener('click', saveMappings);
  $('#load-mappings').addEventListener('click', () => $('#mappings-file').click());
  $('#mappings-file').addEventListener('change', (e) => {
    if (e.target.files[0]) loadMappings(e.target.files[0]);
    e.target.value = '';
  });
  $('#find-leds').addEventListener('click', findLeds);
  // Library knob: drag up or down to turn it.
  const libKnob = document.getElementById('lib-knob');
  let dragY = null;
  libKnob.addEventListener('pointerdown', (e) => { if (!learnMode) dragY = e.clientY; });
  libKnob.addEventListener('pointermove', (e) => {
    if (dragY === null) return;
    libScrollTo(libKnobValue + (dragY - e.clientY) / 200); // stops at the first and last track
    dragY = e.clientY;
  });
  ['pointerup', 'pointercancel'].forEach(ev => libKnob.addEventListener(ev, () => { dragY = null; }));
  drawLibKnob();
  $('#learn-clear').addEventListener('click', () => {
    bindings = {};
    saveBindings();
    setStatus('MIDI bindings cleared.');
  });

  const input = $('#file-input');
  input.addEventListener('change', e => addFiles(e.target.files));

  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => addFiles(e.dataTransfer.files));
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => e.preventDefault());

  // Handy for debugging from the console.
  window.greyGoose = { decks, apply, onMidi, library, bindings: () => bindings };
}

init();
