// emscripten JS library for the asm2c test module: a call out of translated code runs in the test interpreter;
// the trace build reports each translated instruction (diff_tla.cjs TRACE=1)
addToLibrary({ a2c_js_call: (addr) => Module.a2cCall(addr), a2c_js_trace: (addr) => Module.a2cTrace && Module.a2cTrace(addr) });
