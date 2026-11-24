// analyze.js: waveform peaks, onset envelope, BPM and beat grid. No DOM code.
// Basic first version: onset energy flux + autocorrelation tempo + comb phase search.
const Analyze = (() => {
  // Mix a decoded AudioBuffer down to mono.
  function mono(buf) {
    const n = buf.length, chs = buf.numberOfChannels;
    const out = new Float32Array(n);
    for (let c = 0; c < chs; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) out[i] += d[i] / chs;
    }
    return out;
  }

  // Min, max and RMS per bucket, for drawing the waveform at any zoom.
  function peaks(x, buckets) {
    const size = x.length / buckets;
    const min = new Float32Array(buckets), max = new Float32Array(buckets), rms = new Float32Array(buckets);
    for (let b = 0; b < buckets; b++) {
      const s = Math.floor(b * size), e = Math.min(x.length, Math.floor((b + 1) * size));
      let mn = 0, mx = 0, sq = 0;
      for (let i = s; i < e; i++) {
        const v = x[i];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
        sq += v * v;
      }
      min[b] = mn;
      max[b] = mx;
      rms[b] = Math.sqrt(sq / Math.max(1, e - s));
    }
    return { min, max, rms };
  }

  // Onset envelope: positive jumps in log energy per frame (1024 samples, hop 512).
  function onsetEnvelope(x, sr) {
    const frame = 1024, hop = 512;
    const frames = Math.max(0, Math.floor((x.length - frame) / hop) + 1);
    const logE = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      let e = 0;
      const s = f * hop;
      for (let i = 0; i < frame; i++) e += x[s + i] * x[s + i];
      logE[f] = Math.log(e / frame + 1e-10);
    }
    const env = new Float32Array(frames);
    for (let f = 1; f < frames; f++) env[f] = Math.max(0, logE[f] - logE[f - 1]);
    return { env, fps: sr / hop };
  }

  // Tempo from autocorrelation of the onset envelope, searched between lo and hi BPM.
  function estimateTempo(env, fps, lo = 70, hi = 180) {
    let mean = 0;
    for (let i = 0; i < env.length; i++) mean += env[i];
    mean /= Math.max(1, env.length);
    const e = new Float32Array(env.length);
    for (let i = 0; i < env.length; i++) e[i] = env[i] - mean;

    let bestBpm = lo, bestScore = -Infinity;
    for (let bpm = lo; bpm <= hi; bpm += 0.25) {
      const lag = (60 * fps) / bpm;
      const n = e.length - Math.ceil(lag);
      let s = 0;
      for (let i = 0; i < n; i++) s += e[i] * e[Math.round(i + lag)];
      if (s > bestScore) { bestScore = s; bestBpm = bpm; }
    }
    return bestBpm;
  }

  // Beat grid: best phase for the tempo, then the strongest of the 4 bar phases as bar 1.
  function beatGrid(env, fps, bpm) {
    const period = (60 * fps) / bpm; // in envelope frames
    let bestOffset = 0, bestScore = -Infinity;
    for (let o = 0; o < period; o += 0.5) {
      let s = 0;
      for (let k = 0; o + k * period < env.length; k++) s += env[Math.round(o + k * period)];
      if (s > bestScore) { bestScore = s; bestOffset = o; }
    }
    const beats = [];
    for (let k = 0; ; k++) {
      const f = bestOffset + k * period;
      if (f >= env.length) break;
      beats.push(f / fps); // seconds
    }
    let bestPhase = 0, bestPhaseScore = -Infinity;
    for (let p = 0; p < 4; p++) {
      let s = 0;
      for (let k = p; k < beats.length; k += 4) s += env[Math.min(env.length - 1, Math.round(beats[k] * fps))];
      if (s > bestPhaseScore) { bestPhaseScore = s; bestPhase = p; }
    }
    return { beats, barPhase: bestPhase };
  }

  // Dynamic-programming beat tracker (Ellis, 2007). Picks the beat sequence that follows the
  // onsets while keeping the spacing close to the expected period. Returns beat times in seconds.
  function trackBeatsDP(env, fps, bpm, lambda = 50) {
    const n = env.length;
    const P = (60 * fps) / bpm; // expected beat period in envelope frames
    let mean = 0;
    for (let i = 0; i < n; i++) mean += env[i];
    mean /= Math.max(1, n);
    const e = new Float64Array(n);
    for (let i = 0; i < n; i++) e[i] = mean > 0 ? env[i] / mean : 0;

    const score = new Float64Array(n);
    const back = new Int32Array(n).fill(-1);
    const minLag = Math.max(1, Math.round(P / 2));
    const maxLag = Math.round(P * 2);
    for (let t = 0; t < n; t++) {
      let best = -Infinity, arg = -1;
      for (let lag = minLag; lag <= maxLag && t - lag >= 0; lag++) {
        const tau = t - lag;
        const s = score[tau] - lambda * Math.pow(Math.log(lag / P), 2); // penalise spacing away from P
        if (s > best) { best = s; arg = tau; }
      }
      if (arg >= 0 && best > 0) { score[t] = e[t] + best; back[t] = arg; }
      else { score[t] = e[t]; back[t] = -1; } // start a new beat sequence here
    }
    // Finish at the strongest point, then follow the back pointers to the start.
    let t = 0;
    for (let i = 0; i < n; i++) if (score[i] > score[t]) t = i;
    const frames = [];
    while (t >= 0) { frames.push(t); t = back[t]; }
    frames.reverse();
    return frames.map((f) => f / fps);
  }

  // Tempo from the median beat interval.
  function bpmFromBeats(beats) {
    const d = [];
    for (let i = 1; i < beats.length; i++) d.push(beats[i] - beats[i - 1]);
    if (!d.length) return 0;
    d.sort((a, b) => a - b);
    return 60 / d[Math.floor(d.length / 2)];
  }

  // Which of the 4 beat phases is the bar start (strongest onsets).
  function barPhaseOf(beats, env, fps) {
    let bestPhase = 0, bestScore = -Infinity;
    for (let p = 0; p < 4; p++) {
      let s = 0;
      for (let k = p; k < beats.length; k += 4) s += env[Math.min(env.length - 1, Math.round(beats[k] * fps))];
      if (s > bestScore) { bestScore = s; bestPhase = p; }
    }
    return bestPhase;
  }

  // The algorithm switcher. Each option has a tempo search range and a tracker.
  const ALGORITHMS = {
    autocorr: { label: 'Autocorrelation grid (basic)', tracker: 'grid', lo: 70, hi: 180 },
    dp: { label: 'Beat tracker 70–180 BPM', tracker: 'dp', lo: 70, hi: 180 },
    'dp-slow': { label: 'Beat tracker 60–110 BPM (half-time)', tracker: 'dp', lo: 60, hi: 110 },
  };

  // Full analysis of a decoded AudioBuffer with the chosen algorithm.
  function run(buf, buckets = 1200, algo = 'autocorr') {
    const cfg = ALGORITHMS[algo] || ALGORITHMS.autocorr;
    const x = mono(buf);
    const sr = buf.sampleRate;
    const { env, fps } = onsetEnvelope(x, sr);
    let bpm = estimateTempo(env, fps, cfg.lo, cfg.hi);
    let beats;
    if (cfg.tracker === 'dp') {
      beats = trackBeatsDP(env, fps, bpm);
      if (beats.length > 4) bpm = bpmFromBeats(beats);
    } else {
      beats = beatGrid(env, fps, bpm).beats;
    }
    return {
      duration: buf.duration,
      peaks: peaks(x, buckets),
      bpm,
      beats,
      barPhase: barPhaseOf(beats, env, fps),
      algo,
    };
  }

  return { run, ALGORITHMS, mono, peaks, onsetEnvelope, estimateTempo, beatGrid, trackBeatsDP };
})();
