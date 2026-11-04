// TLA9 "Bring party from Golden Sun" (docs/TLA9.md; TLA_PLAN 3.2 (c), user decisions 6): on The Lost Age's page, when
// the origin holds a Golden Sun ROM and a Golden Sun save with a cleared file, the player's only action is the game's
// own "Transfer data from Golden Sun?" -> Yes.
//  1. Before the TLA module starts (so only one 225 MiB module is alive), a headless Golden Sun instance (no canvas,
//     no audio, nothing written back) boots with the GS1 save and, at its first frame, runs GS1's own save code through
//     the port's call entry (Port_CallCode4, in every GS1 build): Save_InitializeWork, Save_LoadFileSummaries, then
//     Save_ReadPart for the chosen file's two parts into gSaveBuffer, Save_ReleaseWork: the calls
//     Save_ChooseAndLoadFile makes, minus the file menu. The 4,100 bytes from gSaveBuffer are exactly what GS1's cable
//     send (FileScreen_Run: Serial_StartSend(gSaveBuffer, 4100)) puts on the wire. The instance is then dropped.
//  2. The TLA module gets Port_TlaAutoTransferArm(1): its Transfer Method menu answers Link cable at once
//     (port/tla/hw/pc_tla.c, one-shot), and TLA's link transport gets a virtual Golden Sun partner that plays
//     FileScreen_Run's side of the exchange on link.c's wire format (payload "0000", TLA's "UVTS" greeting awaited,
//     then one 4,100-byte bulk), as tests/transfer_a.cjs's stand-in does. TLA's own receive and import do the rest.
// Several cleared files: the one with the longest play time (the furthest game) is taken, no chooser (docs/TLA9.md).
// Nothing applies (the menus stay the cartridge's) when the option is off, the origin has no GS1 ROM or save, or no
// file is cleared. Option stored as tla-gs1party=0 only when switched off (default on, the user's choice).
'use strict';
(function (root) {
  // GS1 (tbs-en) addresses, port/symbols/tbs-en.tsv: GS1's own save routines and data
  const GS1 = {
    Save_InitializeWork: 0x080056cc, Save_LoadFileSummaries: 0x08005c68, Save_ReadPart: 0x08005a78,
    Save_ReleaseWork: 0x08005cf8, gSaveWork: 0x03001f1c, gSaveBuffer: 0x02000000,
  };
  const SUMMARY = 0x1040, SUMMARY_SIZE = 64, FILES = 3, PART = 4096, SEND_BYTES = 4100;

  // GS1's own code reads the save: returns { files: [{file, level, playTime, cleared, name}], chosen, bytes } or null
  function gs1Export(m) {
    const H = m.HEAPU8, dv = new DataView(H.buffer);
    const call = (a, x = 0, y = 0) => m._Port_CallCode4(a, x, y, 0, 0) | 0;
    if (call(GS1.Save_InitializeWork) !== 0) { call(GS1.Save_ReleaseWork); return null; }
    call(GS1.Save_LoadFileSummaries);
    const work = dv.getUint32(GS1.gSaveWork, true);
    const files = [];
    for (let i = 0; i < FILES; i++) {
      const s = work + SUMMARY + i * SUMMARY_SIZE;
      const name = String.fromCharCode(...H.subarray(s + 0x10, s + 0x1c)).replace(/\0.*$/s, '');
      files.push({ file: i, level: H[s + 0x1c], playTime: dv.getUint32(s + 0x20, true), cleared: H[s + 0x31] !== 0,
        name: /^[\x20-\x7e]*$/.test(name) ? name : '' });
    }
    let chosen = -1;
    for (const f of files) if (f.level && f.cleared && (chosen < 0 || f.playTime > files[chosen].playTime)) chosen = f.file;
    let bytes = null;
    if (chosen >= 0) {
      const e = call(GS1.Save_ReadPart, chosen, GS1.gSaveBuffer) | call(GS1.Save_ReadPart, chosen + FILES, GS1.gSaveBuffer + PART);
      if (e === 0) bytes = H.slice(GS1.gSaveBuffer, GS1.gSaveBuffer + SEND_BYTES);
    }
    call(GS1.Save_ReleaseWork);
    return { files, chosen: bytes ? chosen : -1, bytes };
  }

  // Runs a headless GS1 instance (factory = GS1's game.js GoldenSun) with the ROM and save; resolves gs1Export's result
  function gs1Read(factory, rom, flash, extra = {}) {
    return new Promise((resolve, reject) => {
      let m = null, done = false;
      factory(Object.assign({
        print: () => {}, printErr: () => {},
        onFrame: () => {
          if (!done) {
            done = true;
            try { resolve(gs1Export(m)); } catch (e) { reject(e); }
          }
          return new Promise(() => {});   // never resumed: the instance stops here and is dropped
        },
      }, extra)).then((mod) => {
        m = mod;
        m.HEAPU8.set(rom, 0x08000000);
        m.HEAPU8.set(flash, m._Port_FlashMemory());
        m._Port_KeepFlash();
        try { m.callMain([]); } catch (e) { if (!done) { done = true; reject(e); } }
      }, reject);
    });
  }

  // The virtual Golden Sun partner: a link transport (port/pc/link_transport.h) for TLA (player 1, child) playing
  // FileScreen_Run's side on link.c's wire format (frame = 1, epoch, rxEpoch, 0, rxDone u16, 0 u16, frame u32,
  // payload[24]; bulk = 2, epoch, seq u16, size u32, bytes). step() once per TLA frame while active.
  function VirtualGs1(bytes, log = () => {}) {
    let f = 0, peerEpoch = 0, greetedAt = 0, sent = false;
    const inbox = [[], []];
    const payload = new Uint8Array(24);
    for (let i = 0; i < 4; i++) payload[4 + 2 * i] = 0x30;   // u16 '0','0','0','0' at payload+4
    const self = {
      done: false, doneAt: 0,
      connected: () => true,
      playerId: () => 1,
      send(ch, b) {   // TLA -> GS1
        if (ch !== 0) return;
        peerEpoch = b[1];
        const g = String.fromCharCode(b[16], b[18], b[20], b[22]);
        if (!greetedAt && g === 'UVTS') { greetedAt = f; log(`virtual GS1 f${f}: greeting UVTS heard`); }
        if (sent && !self.done && b[2] === 1 && (b[4] | b[5] << 8) >= 1) { self.done = true; self.doneAt = f; log(`virtual GS1 f${f}: the bulk consumed`); }
      },
      recv(ch) { return inbox[ch].length ? inbox[ch].shift() : null; },
      step() {   // GS1 -> TLA, one frame
        if (greetedAt && !sent && f >= greetedAt + 20) {   // wait(10) after the greeting, the window, wait(10)
          const msg = new Uint8Array(8 + bytes.length), dv = new DataView(msg.buffer);
          msg[0] = 2; msg[1] = 1; dv.setUint16(2, 1, true); dv.setUint32(4, bytes.length, true); msg.set(bytes, 8);
          inbox[1].push(msg); sent = true; log(`virtual GS1 f${f}: Serial_StartSend(gSaveBuffer, ${bytes.length})`);
        }
        const fr = new Uint8Array(36), dv = new DataView(fr.buffer);
        fr[0] = 1; fr[1] = 1; fr[2] = peerEpoch; dv.setUint32(8, ++f, true); fr.set(payload, 12);
        inbox[0].push(fr);
        if (inbox[0].length > 8) inbox[0].shift();   // the frame channel is unreliable: keep the newest few
      },
    };
    return self;
  }

  const api = { GS1, gs1Export, gs1Read, VirtualGs1, SEND_BYTES };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }

  // ---- the page (The Lost Age's only) ----
  if (root.GS_GAME !== 'tla') return;
  const params = new URLSearchParams(location.search);
  const K = 'tla-gs1party';
  let on = true;
  try { on = localStorage.getItem(K) !== '0'; } catch (e) { /* storage blocked: default on */ }
  if (params.get('gs1party') !== null) on = params.get('gs1party') !== '0';   // tests: ?gs1party=0/1 (not stored)
  const T = {
    on, data: null, tried: false, m: null, partner: null, base: null, after: 0, hits: 0,
    log: (s) => console.log('transfer: ' + s),
    show(s) { const el = document.getElementById('opt-gs1party-state'); if (el) el.textContent = s; },
    // load GS1's game.js from the site's root without replacing TLA's factory (both are named GoldenSun)
    async gs1Factory() {
      const mine = root.GoldenSun;
      const url = new URL('../game.js', location.href).href;
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url; s.onload = resolve; s.onerror = () => reject(new Error('no Golden Sun game.js at ' + url));
        document.head.appendChild(s);
      });
      const gs1 = root.GoldenSun;
      root.GoldenSun = mine;
      if (gs1 === mine) throw new Error('Golden Sun game.js did not load');
      return gs1;
    },
    // step 1: read the GS1 save with GS1's code (before the TLA module is made)
    async prepare(dbGet) {
      this.dbGet = dbGet;
      if (!this.on || this.tried) return;
      this.tried = true;
      try {
        const [rom, flash] = [await dbGet('rom'), await dbGet('flash')];
        if (!rom || rom.length !== 8388608 || !flash || flash.length !== 65536) { this.show('(no Golden Sun save on this site)'); this.log('no GS1 ROM/save'); return; }
        const t0 = performance.now();
        const factory = await this.gs1Factory();
        const r = await gs1Read(factory, rom, flash, { locateFile: (p) => new URL('../' + p, location.href).href });
        if (!r || r.chosen < 0) { this.show('(no cleared Golden Sun file)'); this.log('no cleared GS1 file'); return; }
        const f = r.files[r.chosen];
        this.data = r.bytes;
        this.show(`(ready: file ${f.file + 1}${f.name ? ', ' + f.name : ''}, Lv ${f.level})`);
        this.log(`GS1 file ${f.file + 1} read by GS1's code (${r.bytes.length} bytes; cleared files ${r.files.filter((x) => x.level && x.cleared).length}; ${Math.round(performance.now() - t0)} ms)`);
      } catch (e) { this.show('(could not read the Golden Sun save)'); console.warn('transfer: ' + (e.message || e)); }
    },
    // step 2: each TLA run (also after Return to title)
    attach(m) {
      this.m = m; this.partner = null; this.after = 0;
      this.hits = m._Port_TlaAutoTransferHits ? m._Port_TlaAutoTransferHits() : 0;
      this.base = m.linkTransport || null;
      const me = this;
      m.linkTransport = {   // the partner while a transfer runs, else whatever the page had (online play)
        connected: () => (me.partner ? true : !!(me.base && me.base.connected())),
        playerId: () => (me.partner ? 1 : me.base ? me.base.playerId() : 0),
        send: (ch, b) => (me.partner ? me.partner.send(ch, b) : me.base && me.base.send(ch, b)),
        recv: (ch) => (me.partner ? me.partner.recv(ch) : me.base ? me.base.recv(ch) : null),
      };
      this.arm();
    },
    arm() { if (this.m && this.m._Port_TlaAutoTransferArm) this.m._Port_TlaAutoTransferArm(this.on && this.data ? 1 : 0); },
    onFrame(m) {
      if (m !== this.m || !m._Port_TlaAutoTransferHits) return;
      const h = m._Port_TlaAutoTransferHits();
      if (h !== this.hits) {   // the Transfer Method menu answered Link cable: the partner joins
        this.hits = h;
        this.partner = VirtualGs1(this.data, this.log);
        this.log('Transfer Method: Link cable (automatic)');
      }
      const p = this.partner;
      if (!p) return;
      p.step();
      if (p.done && ++this.after > 600) {   // TLA has had the data for 10 s: the partner leaves, armed for another Yes
        this.partner = null; this.after = 0; this.arm();
      }
    },
    async set(v) {
      this.on = !!v;
      try { if (this.on) localStorage.removeItem(K); else localStorage.setItem(K, '0'); } catch (e) { /* storage blocked */ }
      if (!this.on) this.show('');
      if (this.on && !this.tried && this.dbGet) await this.prepare(this.dbGet);
      this.arm();
    },
  };
  root.GSTransfer = T;
  const box = document.getElementById('opt-gs1party'), row = document.getElementById('opt-gs1party-row');
  if (row) row.hidden = false;
  if (box) { box.checked = T.on; box.addEventListener('change', () => T.set(box.checked)); }
})(typeof self !== 'undefined' ? self : this);
