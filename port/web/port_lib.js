// Emscripten JS library of the PC layer (linked with --js-library). port_frame_ready is called by the frame
// driver (port/pc/hw.c) each time a frame is complete (line 160). The host sets Module.onFrame: when it returns
// a Promise (the page: wait for the next display refresh) the game is suspended there with ASYNCIFY and resumed
// when it settles; when it returns anything else (node runners) the game simply continues. When ASYNCIFY
// rewinds the stack to resume, this function is entered again: onFrame must not run a second time then.
addToLibrary({
  port_frame_ready__async: true,
  port_frame_ready: function () {
    if (Asyncify.state === Asyncify.State.Normal) {
      const r = Module.onFrame ? Module.onFrame() : null;
      if (!(r && typeof r.then === 'function')) return;
      Module.portFramePromise = r;
    }
    return Asyncify.handleAsync(() => Module.portFramePromise);
  },
});

// The game's soft reset (GS11, trap 36): A+B+Select+Start -> System_SoftReset -> Cart_Start, which port/pc/main.c
// runs as Port_SystemEntry -> here. On the GBA the jump to the cartridge entry drops the whole stack; here ASYNCIFY
// unwinds the wasm stack out of the running export (as a frame wait does) and the saved state is thrown away instead
// of rewound; once nothing of the old run is on the stack (a microtask later), the C stack pointer goes back to its
// base and Port_Restart runs System_Entry again. Memory and the hardware layer keep their state, as on the GBA.
// Module.onSoftReset (optional) is told first (the page clears its per-run state).
addToLibrary({
  port_soft_reset__async: true,
  port_soft_reset__deps: ['$stackRestore', 'emscripten_stack_get_base'],
  port_soft_reset: function () {
    return Asyncify.handleSleep(() => {
      queueMicrotask(() => {
        if (Asyncify.currData) { _free(Asyncify.currData); Asyncify.currData = null; }
        Asyncify.state = Asyncify.State.Normal;
        stackRestore(_emscripten_stack_get_base());
        if (Module.onSoftReset) Module.onSoftReset();
        try {
          Module._Port_Restart();
        } catch (e) {
          if (e !== 'unwind') { err('game stopped: ' + (e && e.stack || e)); throw e; }
        }
      });
    });
  },
});

// The link transport (port/pc/link_transport.h): link.c's channel to the other console, delegated to
// Module.linkTransport {connected(), playerId(), send(ch, Uint8Array), recv(ch) -> Uint8Array|null}. G6 uses
// the in-memory pair of port/web/link_loopback.js, G7 WebRTC data channels. Absent: never connected.
addToLibrary({
  port_link_connected: function () {
    const t = Module.linkTransport;
    return t && t.connected() ? 1 : 0;
  },
  port_link_player_id: function () {
    const t = Module.linkTransport;
    return t ? t.playerId() & 1 : 0;
  },
  port_link_send: function (channel, ptr, length) {
    const t = Module.linkTransport;
    if (t) t.send(channel, HEAPU8.slice(ptr, ptr + length));
  },
  port_link_recv: function (channel, ptr, max) {
    const t = Module.linkTransport;
    const m = t ? t.recv(channel) : null;
    if (!m) return -1;
    HEAPU8.set(m.length > max ? m.subarray(0, max) : m, ptr);
    return m.length;
  },
});
