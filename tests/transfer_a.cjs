// TLA8 route (a): the games' own cable transfer, two instances in one node process (tests/link2.cjs's model): a GS1
// instance (player 0) with the test-only cleared save runs its hidden Send -> file -> Cable (tests/routes/gs1_send.keys,
// gs1_send_cable.keys), a TLA instance (player 1, empty save) answers "Transfer data from Golden Sun?" Yes -> Cable
// (tests/routes/tla/transfer_cable.keys), both through port/pc/link.c on the in-memory transport pair
// (port/web/link_loopback.js), stepped in frame lockstep. Prints the link events (greetings, bulk sizes), the size
// TLA's Func_02000b24 received, and RAM digests of TLA at the end; captures go to --out (port_work/).
// --virtual FILE: no GS1 instance; a GS1 stand-in on the same transport plays GS1's side of the exchange as
// FileScreen_Run does it (payload "0000", the "UVTS" greeting awaited, then one bulk of 4100 bytes) with the bytes of
// FILE: a dump of GS1's EWRAM taken with the cleared file loaded by Save_ChooseAndLoadFile (gSaveBuffer, 0x02000000)
// (the bytes route (a)'s Serial_StartSend(gSaveBuffer, 4100) sends). TEST ONLY.
// Usage: node tests/transfer_a.cjs [--frames N] [--gs1-flash F] [--virtual F] [--probe1 F,...] [--shot a,b] [--out DIR]
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createLoopbackPair } = require('../port/web/link_loopback.js');
const ROOT = path.resolve(__dirname, '..');
const HOME = process.env.HOME;
const KEY = { A: 1, B: 2, SELECT: 4, START: 8, RIGHT: 16, LEFT: 32, UP: 64, DOWN: 128, R: 256, L: 512 };
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const frames = +opt('--frames', 4000);
const out = path.resolve(opt('--out', path.join(ROOT, 'port_work/tla8/route_a')));
fs.mkdirSync(out, { recursive: true });
const shots = new Set((opt('--shot', '') || '').split(',').filter(Boolean).map(Number));
const virt = opt('--virtual', '');
const keyFile = (fl) => fl.split(',').filter(Boolean).map((f) => fs.readFileSync(path.resolve(ROOT, f), 'utf8').split('\n')
  .map((l) => l.replace(/#.*/, '').trim()).filter(Boolean).join(',')).join(',');
const parseKeys = (text) => text.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
  const [k, r0] = s.split('@'); const [r, per] = r0.split('/'); const [a, b] = r.split('-').map(Number);
  return { mask: k.split('+').reduce((m, n) => m | KEY[n], 0), a, b: b ?? a, per: +per || 0 };
});
function png(rgba, w, h) {
  const zlib = require('zlib');
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const t = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const x of b) c = t[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// GS1's side of the exchange as FileScreen_Run plays it, on link.c's wire format (port/pc/link.c: frame = 1, epoch,
// rxEpoch, 0, rxDone u16, 0 u16, frame u32, payload[24]; bulk = 2, epoch, seq u16, size u32, bytes)
function virtualGs1(end, bytes) {
  let f = 0, peerEpoch = 0, greetedAt = 0, sent = false, done = false;
  const payload = Buffer.alloc(24);
  Buffer.from('0\0' + '0\0' + '0\0' + '0\0', 'latin1').copy(payload, 4); // u16 '0','0','0','0' at payload+4
  return {
    step() {
      let m;
      while ((m = end.recv(0))) {
        const b = Buffer.from(m);
        peerEpoch = b[1];
        const pay = b.subarray(12, 36);
        if (!greetedAt && pay.toString('latin1', 4, 12) === 'U\0V\0T\0S\0') { greetedAt = f; console.log(`virtual GS1 f${f}: greeting UVTS heard`); }
        if (sent && !done && b[2] === 1 && b.readUInt16LE(4) >= 1) { done = true; console.log(`virtual GS1 f${f}: the bulk consumed (rxDone)`); }
      }
      while (end.recv(1)) { /* no bulk comes from TLA */ }
      if (greetedAt && !sent && f >= greetedAt + 20) { // wait(10) after the greeting, the window, wait(10)
        const msg = Buffer.alloc(8 + bytes.length);
        msg[0] = 2; msg[1] = 1; msg.writeUInt16LE(1, 2); msg.writeUInt32LE(bytes.length, 4); bytes.copy(msg, 8);
        end.send(1, new Uint8Array(msg)); sent = true; console.log(`virtual GS1 f${f}: Serial_StartSend(gSaveBuffer, ${bytes.length})`);
      }
      const fr = Buffer.alloc(36);
      fr[0] = 1; fr[1] = 1; fr[2] = peerEpoch; fr.writeUInt32LE(++f, 8); payload.copy(fr, 12);
      if (!done || f < 100000) end.send(0, new Uint8Array(fr));
    },
  };
}

async function main() {
  const pair = createLoopbackPair({});
  // the bulk messages on the wire (link.c: 2, epoch, seq, size u32, bytes): what each side really sent
  for (const [i, e] of pair.ends.entries()) {
    const send = e.send;
    e.send = (ch, bytes) => {
      if (ch === 1) console.log(`${i ? 'TLA' : virt ? 'GS1 stand-in' : 'GS1'} bulk on the wire: ${Buffer.from(bytes).readUInt32LE(4)} bytes` +
        (Buffer.from(bytes).readUInt32LE(4) === 0 && !i ? ' (GS1 link.c BULK_MAX 4096 < 4100: Serial_StartSend sends 0 bytes)' : ''));
      send(ch, bytes);
    };
  }
  const specs = [
    { name: 'gs1', js: path.join(ROOT, 'build/wasm/game.js'), rom: `${HOME}/roms/Golden_Sun_USA_Europe.gba`,
      flash: opt('--gs1-flash', path.join(ROOT, 'port_work/tla8/gs1_clear.sav')),
      keys: parseKeys(keyFile('tests/routes/gs1_send.keys,tests/routes/gs1_send_cable.keys')), probes: [] },
    { name: 'tla', js: path.join(ROOT, 'build/wasm-tla/game.js'), rom: `${HOME}/roms/Golden_Sun_The_Lost_Age_USA_Europe.gba`,
      flash: '', keys: parseKeys(keyFile('tests/routes/tla/transfer_cable.keys') + ',' + (opt('--keys1', '') || '')),
      probes: (opt('--probe1', '') || '').split(',').filter(Boolean).map((f) => require(path.resolve(f))) },
  ];
  const inst = [];
  for (let i = 0; i < 2; i++) {
    const sp = specs[i];
    if (i === 0 && virt) { inst.push({ name: 'gs1', virtual: virtualGs1(pair.ends[0], fs.readFileSync(virt).subarray(0, 4100)) }); continue; }
    const me = { name: sp.name, frame: 0, resume: null, arrived: null };
    me.wait = () => new Promise((r) => { me.arrived = r; });
    const first = me.wait();
    const factory = require(sp.js);
    me.m = await factory({
      print: () => {}, printErr: (s) => console.error(`[${sp.name}] ${s}`), linkTransport: pair.ends[i],
      onFrame: () => {
        me.frame++;
        const m = me.m;
        if (shots.has(me.frame)) fs.writeFileSync(path.join(out, `${sp.name}_${String(me.frame).padStart(5, '0')}.png`),
          png(Buffer.from(m.HEAPU8.buffer, m._Port_FrameBuffer(), 240 * 160 * 4), 240, 160));
        let k = 0;
        for (const s of sp.keys) if (me.frame >= s.a && me.frame <= s.b && (!s.per || (me.frame - s.a) % s.per < 3)) k |= s.mask;
        m._Port_SetKeys(k);
        for (const pr of sp.probes) pr(m, me.frame, k);
        return new Promise((r) => { me.resume = r; me.arrived(); });
      },
    });
    me.m.HEAPU8.set(fs.readFileSync(sp.rom), 0x08000000);
    if (sp.flash) { me.m.HEAPU8.set(fs.readFileSync(sp.flash), me.m._Port_FlashMemory()); me.m._Port_KeepFlash(); }
    me.first = first;
    inst.push(me);
  }
  for (const me of inst) if (me.m) { try { me.m.callMain([]); } catch (e) { console.error(`[${me.name}] stopped:`, e); process.exit(2); } }
  await Promise.all(inst.filter((me) => me.m).map((me) => me.first));
  const tla = inst[1];
  const H = () => tla.m.HEAPU8;
  const u16 = (a) => H()[a] | H()[a + 1] << 8;
  let last = '', recvAt = 0;
  // TLA's link globals (port/tla/symbols/tla-en.tsv): gSerialReceivedSize, gSerialReceiveDest, the peer's greeting
  const A = { recvSize: 0x02005354, recvDest: 0x020055d0, peerSig: 0x02003874 };
  for (let f = 1; f < frames; f++) {
    pair.tick();
    for (const me of inst) {
      if (me.virtual) { me.virtual.step(); continue; }
      const p = me.wait(); const r = me.resume; me.resume = null; r(); await p;
    }
    const s = `TLA bulk in ${tla.m._Port_LinkStat(2)} received size ${u16(A.recvSize)}` +
      (inst[0].m ? `, GS1 bulk out ${inst[0].m._Port_LinkStat(3)}` : '');
    if (s !== last) { console.log(`f${f}: ${s}`); last = s; if (!recvAt && tla.m._Port_LinkStat(2)) recvAt = f; }
  }
  const ram = crypto.createHash('sha1');
  for (const [a, n] of [[0x02000000, 0x40000], [0x03000000, 0x8000]]) ram.update(H().subarray(a, a + n));
  const units = crypto.createHash('sha1').update(H().subarray(0x02000520, 0x02000520 + 8 * 0x14c)).digest('hex').slice(0, 12);
  console.log(`route_a end f${frames}: TLA received a bulk at f${recvAt || '-'}; TLA ram ${ram.digest('hex').slice(0, 16)} units ${units}`);
}
main();
