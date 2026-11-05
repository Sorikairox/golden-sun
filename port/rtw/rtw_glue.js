// retrowser.app build (docs/RTW.md): the worker-side half of port/web/main.js, as an Emscripten --pre-js of the rtw
// target only. The game runs in the host's dedicated worker (no DOM); the host calls the rtw_* exports
// (port/rtw/rtw.c). port/web/port_lib.js's frame driver calls Module.onFrame at each frame end (line 160); here it
// hands the frame to port_rtw_frame (keys, options, picture) and returns a promise that settles when the next frame is
// due at the GBA's 59.7275 Hz on the worker's timer, so the game is suspended there (ASYNCIFY) as on the page. While
// the host has paused the game (rtw_pause) the promise waits. Saves, audio and the picture are pulled by the host.
// Not here (no host interface): the online link battle (port/web/net.js), The Lost Age's one-"Yes" party transfer from
// a Golden Sun save on the same site (port/web/transfer.js).
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
  Module['onFrame'] = () => {
    frames++;
    Module['_port_rtw_frame'](scriptKeys(frames));
    return new Promise((resolve) => {
      // always through a timer task, also when the frame is already due, so the host's messages (input, pause,
      // drains) are handled between frames even when the game runs behind
      const tick = () => {
        const now = performance.now();
        if (Module['_port_rtw_paused']()) { next = 0; setTimeout(tick, 50); return; }
        if (!next) next = now;
        if (now + 1 >= next) {
          next = Math.max(next + FRAME_MS, now - FRAME_MS);
          resolve();
        } else setTimeout(tick, Math.max(0, next - now - 1));
      };
      setTimeout(tick, 0);
    });
  };
  globalThis.__rtwGs = {
    Module,
    frames: () => frames,
    script(spans) { script = spans; },
    audio: () => ({ frames: Module['_port_rtw_audio_frames']() >>> 0, nonZero: Module['_port_rtw_audio_nonzero']() >>> 0 }),
  };
})();
