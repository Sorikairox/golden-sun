// retrowser.app build (docs/RTW.md): the worker-side half of port/web/main.js, as an Emscripten --pre-js of the rtw
// target only. The game runs in the host's dedicated worker (no DOM); the host calls the rtw_* exports
// (port/rtw/rtw.c). port/web/port_lib.js's frame driver calls Module.onFrame at each frame end (line 160); here it
// hands the frame to port_rtw_frame (keys, options, picture) and returns a promise that settles when the next frame is
// due at the GBA's 59.7275 Hz, on the host's next display frame (RTW5) or else the worker's timer, so the game is
// suspended there (ASYNCIFY) as on the page. While
// the host has paused the game (rtw_pause) the promise waits. Saves, audio and the picture are pulled by the host.
// GS1's online link battle (RTW2) is all C (port/rtw/rtw_net.c): the host calls its rtw_net_* exports between frames
// and they only queue packets, so nothing here resumes the game for the network.
// GS37: The Lost Age's one-"Yes" party transfer from the Golden Sun save on this device (retrowser's saveFrom): rtw.c
// (port/rtw/rtw_tla_party.c) reads GS1's save and arms the Transfer Method menu to answer Link cable; here, once it
// has, a virtual Golden Sun plays FileScreen_Run's side of the cable on link.c's wire format (port/web/transfer.js's
// VirtualGs1, the same exchange: payload "0000" each frame, TLA's "UVTS" greeting awaited, 20 frames, one 4,100-byte
// bulk), as Module.linkTransport (port/web/port_lib.js). 600 frames after TLA took the bytes it leaves, armed again.
// Test hook (tests/rtw_e2e.mjs): globalThis.__rtwGs reads frames/audio and can hold keys by game frame, as main.js's
// window.__gsScript does for the page tests; nothing uses it in play.
(function () {
  'use strict';
  const FRAME_MS = 1000 / 59.7275;
  let next = 0;
  let frames = 0;
  let script = null;   // [{mask, a, b, per}] (tests only)
  const scriptKeys = (f) => {
    let k = 0;
    if (script) for (const s of script) if (f >= s.a && f <= s.b && (!s.per || (f - s.a) % s.per < 3)) k |= s.mask;
    return k;
  };
  // RTW5: the frame clock. The host calls rtw_input once per display frame (standard 4.4; rtw.c ->
  // Module.onHostFrame): a frame that is due (at 59.7275 Hz, up to half a frame early) starts on such a call, so the
  // game steps in time with the display instead of beating against it (on its own timer about 4 of every 60
  // pictures were shown twice or never, Chrome and WebKit alike). The worker's timer still runs a frame when the game
  // is behind (a host that ticks at 30 Hz, a slow frame) or when no display frames come (an older host, paused).
  let pending = null;          // the frame wait's resolve, while the game waits
  let lastHostFrame = -1e9;    // performance.now() of the last display frame
  const go = (now) => {
    next = Math.max(next + FRAME_MS, now - FRAME_MS);
    const r = pending; pending = null; r();
  };
  Module['onHostFrame'] = () => {
    const now = performance.now();
    lastHostFrame = now;
    if (!pending || Module['_port_rtw_paused']()) return;
    if (!next) next = now;
    if (now + FRAME_MS / 2 >= next) go(now);
  };
  function VirtualGs1(bytes) {
    let f = 0, peerEpoch = 0, greetedAt = 0, sent = false;
    const inbox = [[], []];
    const payload = new Uint8Array(24);
    for (let i = 0; i < 4; i++) payload[4 + 2 * i] = 0x30;   // u16 '0','0','0','0' at payload+4
    const self = {
      done: false,
      send(ch, b) {   // TLA -> GS1
        if (ch !== 0) return;
        peerEpoch = b[1];
        if (!greetedAt && String.fromCharCode(b[16], b[18], b[20], b[22]) === 'UVTS') greetedAt = f;
        if (sent && !self.done && b[2] === 1 && (b[4] | b[5] << 8) >= 1) self.done = true;
      },
      recv(ch) { return inbox[ch].length ? inbox[ch].shift() : null; },
      step() {   // GS1 -> TLA, one frame
        if (greetedAt && !sent && f >= greetedAt + 20) {   // wait(10) after the greeting, the window, wait(10)
          const msg = new Uint8Array(8 + bytes.length), dv = new DataView(msg.buffer);
          msg[0] = 2; msg[1] = 1; dv.setUint16(2, 1, true); dv.setUint32(4, bytes.length, true); msg.set(bytes, 8);
          inbox[1].push(msg); sent = true;
        }
        const fr = new Uint8Array(36), dv = new DataView(fr.buffer);
        fr[0] = 1; fr[1] = 1; fr[2] = peerEpoch; dv.setUint32(8, ++f, true); fr.set(payload, 12);
        inbox[0].push(fr);
        if (inbox[0].length > 8) inbox[0].shift();   // the frame channel is unreliable: keep the newest few
      },
    };
    return self;
  }
  const party = { hits: 0, partner: null, after: 0, bytes: null };
  Module['linkTransport'] = {   // only The Lost Age's transfer uses it (GS1's online link is rtw_net.c, in C)
    connected: () => !!party.partner,
    playerId: () => 1,
    send: (ch, b) => party.partner && party.partner.send(ch, b),
    recv: (ch) => (party.partner ? party.partner.recv(ch) : null),
  };
  function partyFrame() {
    const ptr = Module['_port_rtw_party'] && Module['_port_rtw_party']();
    if (!ptr) return;
    const h = Module['_Port_TlaAutoTransferHits']();
    if (h !== party.hits) {   // the Transfer Method menu answered Link cable: Golden Sun joins
      party.hits = h;
      party.bytes = party.bytes || Module.HEAPU8.slice(ptr, ptr + 4100);
      party.partner = VirtualGs1(party.bytes);
    }
    const p = party.partner;
    if (!p) return;
    p.step();
    if (p.done && ++party.after > 600) { party.partner = null; party.after = 0; Module['_Port_TlaAutoTransferArm'](1); }
  }
  Module['onFrame'] = () => {
    frames++;
    partyFrame();
    Module['_port_rtw_frame'](scriptKeys(frames));
    return new Promise((resolve) => {
      pending = resolve;
      // always through a timer task, also when the frame is already due, so the host's messages (input, pause,
      // drains) are handled between frames even when the game runs behind
      const tick = () => {
        if (pending !== resolve) return;  // this frame already started (a display frame or an earlier tick)
        const now = performance.now();
        if (Module['_port_rtw_paused']()) { next = 0; setTimeout(tick, 50); return; }
        if (!next) next = now;
        const ticking = now - lastHostFrame < 100;
        if (ticking ? now - FRAME_MS / 2 >= next : now + 1 >= next) go(now);
        else setTimeout(tick, ticking ? Math.max(4, next + FRAME_MS / 2 - now) : Math.max(0, next - now - 1));
      };
      setTimeout(tick, 0);
    });
  };
  globalThis.__rtwGs = {
    Module,
    frames: () => frames,
    script(spans) { script = spans; },
    // RTW2 (GS1, tests/rtw_net_e2e.mjs): the link session as port/rtw/rtw_net.c sees it
    net() {
      const f = Module['_port_rtw_net_info'];
      if (!f) return null;
      const k = ['on', 'me', 'peerState', 'connected', 'hashOk', 'hashBad', 'sent0', 'sent1', 'recv0', 'recv1', 'refused',
        'dropped', 'bad', 'battle', 'turn', 'hpOwn', 'hpEnemy', 'firstBad', 'resets', 'sessions', 'rtt', 'sinceHeard', 'bulkIn', 'bulkOut'];
      const o = {};
      k.forEach((n, i) => { o[n] = f(i); });
      return o;
    },
    party: () => (Module['_port_rtw_party_info'] ? { file: Module['_port_rtw_party_info'](0), level: Module['_port_rtw_party_info'](1),
      given: Module['_port_rtw_party_info'](2), hits: party.hits, done: !!(party.partner && party.partner.done) || party.after > 0 } : null),
    audio: () => ({ frames: Module['_port_rtw_audio_frames']() >>> 0, nonZero: Module['_port_rtw_audio_nonzero']() >>> 0 }),
  };
})();
