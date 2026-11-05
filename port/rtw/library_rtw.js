// retrowser.app build (docs/RTW.md): Emscripten --js-library of the rtw target only (tools/wasm/link.py PORT_RTW_OUT).
// env.rtw_* are the host imports of the retrowser standard (~/Code/retrowser spec/retrowser-v1.md 4.10): the host
// hands them to the factory as Module.rtw and they read memory themselves (spec 4.2), so the raw arguments pass
// through. Only what port/rtw/rtw.c uses is linked (GS1: rtw_option_changed; TLA: none).
addToLibrary({
  // standard 1.1: GS1's in-game Extra settings changed a manifest option; the host's menu and stored value follow
  rtw_option_changed: (id, value) => {
    const host = Module['rtw'];
    return host && host['rtw_option_changed'] ? host['rtw_option_changed'](id, value) | 0 : -1;
  },
});
