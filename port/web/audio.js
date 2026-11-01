// Sound (session GS-audio): the game's samples (port/pc/apu.c, 32768 Hz stereo, drained once a frame) go to an
// AudioWorklet through a small queue (about 60-250 ms), resampled there to the device rate; ScriptProcessor where
// AudioWorklet is missing. Audio starts on the first user gesture (key, click, touch: the touch pad counts, the
// listeners are on window in the capture phase). It never paces or stalls the game: when audio is not running the
// samples are drained and dropped, and the worklet drops its oldest data past 250 ms. Mute and volume live in the
// page menu, stored per browser (localStorage `gs-audio`, try/catch).
'use strict';
(function () {
  const RATE = 32768;
  const KEY = 'gs-audio';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (_) { return {}; } };
  const save = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (_) { /* private mode */ } };
  const st = Object.assign({ muted: false, volume: 0.8 }, load());
  const stats = { state: 'off', kind: '', posted: 0, postedNonZero: 0, workletFrames: 0, workletNonZero: 0, dropped: 0 };
  let ctx = null, gain = null, node = null, starting = false;

  // the queue and resampler, shared by the worklet (as source text) and the ScriptProcessor fallback
  const QUEUE = `
    class GsQueue {
      constructor(rate, outRate) { this.q = []; this.len = 0; this.pos = 0; this.step = rate / outRate; this.max = rate / 4;
        this.frames = 0; this.nonZero = 0; this.dropped = 0; }
      push(c) { this.q.push(c); this.len += c.length / 2;
        while (this.len > this.max && this.q.length > 1) { const d = this.q.shift(); this.len -= d.length / 2; this.dropped += d.length / 2; this.pos = 0; } }
      fill(L, R) {
        for (let i = 0; i < L.length; i++) {
          if (!this.q.length) { L[i] = 0; R[i] = 0; continue; }
          const c = this.q[0], n = c.length / 2, k = this.pos | 0, f = this.pos - k, k1 = k + 1 < n ? k + 1 : k;
          L[i] = c[2 * k] + (c[2 * k1] - c[2 * k]) * f; R[i] = c[2 * k + 1] + (c[2 * k1 + 1] - c[2 * k + 1]) * f;
          if (L[i] !== 0 || R[i] !== 0) this.nonZero++;
          this.pos += this.step;
          while (this.q.length && this.pos >= this.q[0].length / 2) { this.pos -= this.q[0].length / 2; this.len -= this.q[0].length / 2; this.q.shift(); }
        }
        this.frames += L.length;
      }
    }`;
  const WORKLET = QUEUE + `
    class GsAudio extends AudioWorkletProcessor {
      constructor() { super(); this.g = new GsQueue(${RATE}, sampleRate); this.t = 0;
        this.port.onmessage = (e) => this.g.push(e.data); }
      process(inputs, outputs) {
        const o = outputs[0]; this.g.fill(o[0], o[1] || o[0]);
        if (++this.t % 50 === 0) this.port.postMessage({ frames: this.g.frames, nonZero: this.g.nonZero, dropped: this.g.dropped });
        return true;
      }
    }
    registerProcessor('gs-audio', GsAudio);`;

  async function begin() {
    if (ctx || starting) { if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); return; }
    starting = true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { stats.state = 'unsupported'; return; }
      ctx = new AC({ latencyHint: 'interactive' });
      gain = ctx.createGain();
      gain.connect(ctx.destination);
      apply();
      if (ctx.audioWorklet && window.AudioWorkletNode) {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
        await ctx.audioWorklet.addModule(url);
        node = new AudioWorkletNode(ctx, 'gs-audio', { numberOfInputs: 0, outputChannelCount: [2] });
        node.port.onmessage = (e) => { stats.workletFrames = e.data.frames; stats.workletNonZero = e.data.nonZero; stats.dropped = e.data.dropped; };
        stats.kind = 'worklet';
      } else {
        const g = new (new Function(QUEUE + '; return GsQueue;')())(RATE, ctx.sampleRate);
        node = ctx.createScriptProcessor(2048, 0, 2);
        node.onaudioprocess = (e) => {
          g.fill(e.outputBuffer.getChannelData(0), e.outputBuffer.getChannelData(1));
          stats.workletFrames = g.frames; stats.workletNonZero = g.nonZero; stats.dropped = g.dropped;
        };
        node.port = { postMessage: (c) => g.push(c) };
        stats.kind = 'scriptprocessor';
      }
      node.connect(gain);
      if (ctx.state !== 'running') await ctx.resume();
    } catch (e) {
      console.warn('audio: ' + (e.message || e));
      stats.state = 'error';
    } finally {
      starting = false;
      if (ctx) stats.state = ctx.state;
    }
  }
  for (const ev of ['keydown', 'pointerdown', 'pointerup', 'touchend', 'click']) addEventListener(ev, begin, { capture: true, passive: true });

  function apply() {
    if (gain) gain.gain.value = st.muted ? 0 : st.volume;
    const m = document.getElementById('opt-mute'), v = document.getElementById('opt-volume');
    if (m) m.checked = st.muted;
    if (v) v.value = Math.round(st.volume * 100);
  }

  // main.js, once a frame: drain the game's samples; send them on when audio runs, else drop them
  function feed(m) {
    if (!m._Port_AudioDrain) return;
    const live = ctx && node && ctx.state === 'running' && !st.muted;
    if (ctx) stats.state = ctx.state;
    for (;;) {
      const n = m._Port_AudioDrain();
      if (!n) break;
      if (live) {
        const s = new Int16Array(m.HEAPU8.buffer, m._Port_AudioBuffer(), n * 2);
        const c = new Float32Array(n * 2);
        let nz = 0;
        for (let i = 0; i < n * 2; i++) { c[i] = s[i] / 32768; if (c[i] !== 0) nz = 1; }
        node.port.postMessage(c, c.buffer ? [c.buffer] : undefined);
        stats.posted += n; if (nz) stats.postedNonZero += n;
      }
      if (n < 4096) break;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const m = document.getElementById('opt-mute'), v = document.getElementById('opt-volume');
    if (m) m.addEventListener('change', () => { st.muted = m.checked; save(st); apply(); });
    if (v) v.addEventListener('input', () => { st.volume = (+v.value || 0) / 100; save(st); apply(); });
    apply();
  });

  window.GSAudio = { feed, stats: () => Object.assign({}, stats, { muted: st.muted, volume: st.volume, rate: ctx ? ctx.sampleRate : 0 }) };
})();
