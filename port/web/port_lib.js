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
