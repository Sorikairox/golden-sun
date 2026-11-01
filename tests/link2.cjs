// Two-instance link runner (G6, orchestrator D21): two separate game.wasm instances in one node process, player
// 0 (parent) and player 1 (child), each with its own flash, stepped in frame lockstep (A runs one frame, then B),
// wired by the in-memory transport pair of port/web/link_loopback.js (the same interface G7's WebRTC channels
// implement). Inputs are scripted per instance (tests/boot.cjs key syntax). Captures go to port_work/ (they show
// the game) as a_frame_N.png / b_frame_N.png, plus side-by-side sheets via tools/contact.cjs.
// Usage: node tests/link2.cjs game.js ROM FRAMES [--keys0 SPEC] [--keys1 SPEC] [--keys-file0 F] [--keys-file1 F]
//   [--flash FILE | --flash0 F --flash1 F] [--delay D] [--drop P] [--jitter J] [--seed S] [--fresh N]
//   [--probe0 F] [--probe1 F] [--shot 100,200] [--every N] [--out DIR] [--watch] [--hash] [--quiet]
//   [--silence F-G] [--cut F] [--rejoin G] [--stop0 F]
// Link robustness (GS10): --silence F-G drops every message both ways from frame F to G while both ends still say
// connected (a network drop: WebRTC keeps the channels open); --cut F: from frame F the partner is gone (connected()
// false on both ends, as net.js reports after a 'bye' / closed channel); --rejoin G: connected again at G (a new
// session with the same partner); --stop0 F: instance a stops stepping at F (its tab was closed), b runs on.
// --flash default: port_work/g7/flash_battle.sav, made from GS4's prologue save (port_work/g4/flash.sav) with the
// file summary's Djinn-flag count set to 1 (test only: the File Screen offers Battle only for such a file).
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { createLoopbackPair } = require('../port/web/link_loopback.js');

const KEY = { A: 1, B: 2, SELECT: 4, START: 8, RIGHT: 16, LEFT: 32, UP: 64, DOWN: 128, R: 256, L: 512 };
const ROOT = path.resolve(__dirname, '..');

function png(rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const t = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const x of b) c = t[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => {
    const l = Buffer.alloc(4); l.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([l, td, c]);
  };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih),
    chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function parseKeys(text) {
  return text.split(',').map((s) => s.replace(/#.*/, '').trim()).filter(Boolean).map((s) => {
    const [k, r0] = s.split('@'); const [r, per] = r0.split('/'); const [a, b] = r.split('-').map(Number);
    return { mask: k.split('+').reduce((m, n) => m | KEY[n], 0), a, b: b ?? a, per: +per || 0 };
  });
}
const keyFile = (fl) => fl.split(',').filter(Boolean).map((f) => fs.readFileSync(f, 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean).join(',')).join(',');

// The Battle option needs a file whose summary counts a Djinn flag (Save_ScanFileSummaries): set the count of the
// file in the sector holding part 0 and fix that sector's byte checksum (header u16 at 8, payload bytes 16..4087).
function battleFlash(src, dst) {
  const d = Buffer.from(fs.readFileSync(src));
  for (let s = 0; s < 16; s++) {
    const o = s * 4096;
    if (d.toString('latin1', o, o + 7) !== 'CAMELOT' || d[o + 7] !== 0) continue;
    if (d[o + 50] === 0) { d[o + 50] = 1; d.writeUInt16LE((d.readUInt16LE(o + 8) + 1) & 0xffff, o + 8); }
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, d);
  return dst;
}

// RAM addresses (port/symbols/tbs-en.tsv)
const A = { linkStatus: 0x03001f64, transfer: 0x02002220, peers: 0x02002020, work: 0x02002240, seed: 0x020023a8,
  rnd: 0x03001cb4, exch: 0x03001cb0 };

async function main() {
  const args = process.argv.slice(2);
  const [gameJs, romPath, framesArg] = args;
  const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const frames = +framesArg || 600;
  const out = path.resolve(opt('--out', path.join(ROOT, 'port_work/g7/run')));
  fs.mkdirSync(out, { recursive: true });
  const shots = new Set((opt('--shot', '') || '').split(',').filter(Boolean).map(Number));
  const every = +opt('--every', 0);
  const watch = args.includes('--watch'), quiet = args.includes('--quiet');
  const def = path.join(ROOT, 'port_work/g7/flash_battle.sav');
  const flashAll = opt('--flash', '') || battleFlash(path.join(ROOT, 'port_work/g4/flash.sav'), def);
  const flashes = [opt('--flash0', flashAll), opt('--flash1', flashAll)];
  const keys = [0, 1].map((i) => parseKeys([opt('--keys' + i, ''), keyFile(opt('--keys-file' + i, ''))].filter(Boolean).join(',')));
  // --probe0/--probe1 FILE[,FILE]: tests/boot.cjs-style probes ((m, frame, keys) => void) for one instance
  const probes = [0, 1].map((i) => (opt('--probe' + i, '') || '').split(',').filter(Boolean).map((f) => require(path.resolve(f))));
  const pair = createLoopbackPair({ delay: +opt('--delay', 0), drop: +opt('--drop', 0), jitter: +opt('--jitter', 0), seed: +opt('--seed', 1) });
  // GS10 robustness wrappers around the pair's ends
  const [silA, silB] = (opt('--silence', '') || '0-0').split('-').map(Number);
  const cutAt = +opt('--cut', 0), rejoinAt = +opt('--rejoin', 0), stop0 = +opt('--stop0', 0);
  let simFrame = 0, simDropped = 0;
  const silent = () => silA && simFrame >= silA && simFrame <= silB;
  for (const e of pair.ends) {
    const send = e.send;
    // frames sent during a silence are lost; bulk (reliable) is held and delivered when the silence ends, as SCTP
    // retransmits it once the path is back
    e.held = [];
    e.send = (ch, bytes) => { if (silent()) { if (ch === 1) e.held.push(bytes); else simDropped++; return; } send(ch, bytes); };
    e.flush = () => { for (const b of e.held.splice(0)) send(1, b); };
  }
  const rom = fs.readFileSync(romPath);
  const factory = require(path.resolve(gameJs));
  const names = ['a', 'b'];
  const inst = [];
  const shotFiles = [];

  for (let i = 0; i < 2; i++) {
    const me = { i, frame: 0, resume: null, arrived: null, log: [] };
    me.wait = () => new Promise((r) => { me.arrived = r; });
    let first = me.wait();
    me.m = await factory({
      print: (s) => { if (!quiet) console.log(`[${names[i]}] ${s}`); },
      printErr: (s) => console.error(`[${names[i]}] ${s}`),
      linkTransport: pair.ends[i],
      onFrame: () => {
        me.frame++;
        const m = me.m;
        if (shots.has(me.frame) || (every && me.frame % every === 0)) {
          const f = path.join(out, `${names[i]}_frame_${String(me.frame).padStart(5, '0')}.png`);
          fs.writeFileSync(f, png(Buffer.from(m.HEAPU8.buffer, m._Port_FrameBuffer(), 240 * 160 * 4), 240, 160));
        }
        let k = 0;
        for (const s of keys[i]) if (me.frame >= s.a && me.frame <= s.b && (!s.per || (me.frame - s.a) % s.per < 3)) k |= s.mask;
        m._Port_SetKeys(k);
        for (const pr of probes[i]) pr(m, me.frame, k);
        return new Promise((r) => { me.resume = r; me.arrived(); });
      },
    });
    me.m.HEAPU8.set(rom, 0x08000000);
    me.m.HEAPU8.set(fs.readFileSync(flashes[i]), me.m._Port_FlashMemory());
    me.m._Port_KeepFlash();
    if (opt('--fresh', '')) me.m._Port_LinkSetFreshFrames(+opt('--fresh'));
    inst.push(me);
    me.first = first;
  }
  const H = (i) => inst[i].m.HEAPU8;
  const u16 = (i, a) => H(i)[a] | H(i)[a + 1] << 8;
  const u32 = (i, a) => (H(i)[a] | H(i)[a + 1] << 8 | H(i)[a + 2] << 16 | H(i)[a + 3] << 24) >>> 0;
  const asc = (i, a, n) => Array.from(H(i).subarray(a, a + n), (c) => (c >= 32 && c < 127 ? String.fromCharCode(c) : '.')).join('');
  const t0 = Date.now();
  for (const me of inst) { try { me.m.callMain([]); } catch (e) { console.error(`[${names[me.i]}] stopped:`, e); process.exit(2); } }
  await Promise.all(inst.map((me) => me.first));
  const last = ['', ''];
  // --hash: at each change of gBattleRandomSeed (the parent sends the turn's seed and both adopt it), record per
  // side the seed and a hash of the battle units seen from that side; the two sides must mirror each other:
  // a's party unit 0 = b's enemy unit 0 (unit 128) and the reverse. Names (the "Enemy" prefix) and the side byte
  // (0x12a) are left out.
  const turns = [[], []], lastSeed = [0, 0];
  const unitHash = (i, a) => { let h = 0x811c9dc5; for (let k = 15; k < 332; k++) if (k !== 0x12a) h = Math.imul(h ^ H(i)[a + k], 0x01000193); return (h >>> 0).toString(16).padStart(8, '0'); };
  const hashTurn = (i) => {
    const eu = u32(i, 0x03001f28), seed = u32(i, A.seed);
    if (!eu || seed === lastSeed[i]) return;
    lastSeed[i] = seed;
    const party = 0x02000240 + 0x2c0;
    turns[i].push({ seed, own: unitHash(i, party), enemy: unitHash(i, eu), hp: [u16(i, party + 0x38), u16(i, eu + 0x38)], f: inst[i].frame });
  };
  for (let f = 1; f < frames; f++) {
    pair.tick();
    simFrame = f;
    if (cutAt && f === cutAt) { pair.setConnected(false); console.log(`f${f}: link cut (partner gone)`); }
    if (rejoinAt && f === rejoinAt) { pair.setConnected(true); console.log(`f${f}: link back (new session)`); }
    if (silA && f === silA) console.log(`f${f}: silence starts (no messages either way until f${silB})`);
    if (silA && f === silB + 1) for (const e of pair.ends) e.flush();
    for (const me of inst) {
      if (stop0 && me.i === 0 && f >= stop0) continue;
      const p = me.wait();
      const r = me.resume; me.resume = null; r();
      await p;
    }
    if (args.includes('--hash')) { hashTurn(0); hashTurn(1); }
    if (watch) {
      for (let i = 0; i < 2; i++) {
        if (!u16(i, A.exch)) continue;
        const peer = 1 - i;
        const s = `link ${u16(i, A.linkStatus) & 3} own '${asc(i, A.transfer + 4, 16)}' peer '${asc(i, A.peers + peer * 24 + 4, 16)}' xfer ${Array.from(H(i).subarray(A.transfer, A.transfer + 4)).join('.')} ` +
          `bulk in/out ${inst[i].m._Port_LinkStat(2)}/${inst[i].m._Port_LinkStat(3)} seed ${u32(i, A.seed).toString(16)}`;
        if (s !== last[i]) { console.log(`f${f} ${names[i]}: ${s}`); last[i] = s; }
      }
    }
  }
  const ms = Date.now() - t0;
  if (args.includes('--hash')) {
    let ok = 0, bad = 0;
    for (let k = 0; k < Math.max(turns[0].length, turns[1].length); k++) {
      const a = turns[0][k], b = turns[1][k];
      const same = a && b && a.seed === b.seed && a.own === b.enemy && a.enemy === b.own;
      same ? ok++ : bad++;
      console.log(`check ${k + 1}: ${a ? `a f${a.f} seed ${a.seed.toString(16)} hp ${a.hp} units ${a.own}/${a.enemy}` : 'a -'} | ` +
        `${b ? `b f${b.f} seed ${b.seed.toString(16)} hp ${b.hp} units ${b.own}/${b.enemy}` : 'b -'} ${same ? 'AGREE' : 'DIFFER'}`);
    }
    const la = turns[0][turns[0].length - 1], lb = turns[1][turns[1].length - 1];
    const res = !la || !lb ? 'no battle' : la.hp[0] === 0 && lb.hp[1] === 0 ? 'b won (a down on both screens)' : la.hp[1] === 0 && lb.hp[0] === 0 ? 'a won (b down on both screens)' : `open (a ${la.hp}, b ${lb.hp})`;
    console.log(`hash: ${ok} checkpoints agree, ${bad} differ; result: ${res}`);
  }
  // side-by-side sheet of the captured frames, a | b per row
  const fr = [...new Set(fs.readdirSync(out).filter((n) => /^a_frame_\d+\.png$/.test(n)).map((n) => n.slice(2)))].sort();
  const pairs = fr.filter((n) => fs.existsSync(path.join(out, 'b_' + n)));
  for (let s = 0; s < pairs.length; s += 12) {
    const files = pairs.slice(s, s + 12).flatMap((n) => [path.join(out, 'a_' + n), path.join(out, 'b_' + n)]);
    const sheet = path.join(out, `sheet_${String(s / 12).padStart(2, '0')}.png`);
    execFileSync('node', [path.join(ROOT, 'tools/contact.cjs'), sheet, '4', ...files]);
    shotFiles.push(sheet);
  }
  // RAM digest per instance (EWRAM + IWRAM): equal digests across two runs = a deterministic run
  const digest = (i) => { let h = 0x811c9dc5; const b = H(i); for (const [lo, n] of [[0x02000000, 0x40000], [0x03000000, 0x8000]]) for (let k = lo; k < lo + n; k++) h = Math.imul(h ^ b[k], 0x01000193); return (h >>> 0).toString(16).padStart(8, '0'); };
  console.log(`ram digest a ${digest(0)} b ${digest(1)}`);
  const st = (i, k) => inst[i].m._Port_LinkStat(k);
  console.log(`link2: ${frames} lockstep frames in ${ms} ms (${(frames / (ms / 1000)).toFixed(0)} fps per pair); ` +
    `transport: ${pair.stats.sent[0]} frame msgs (${pair.stats.dropped} dropped, ${simDropped} silenced), ${pair.stats.sent[1]} bulk; ` +
    `a: late ${st(0, 1)} bulk in/out ${st(0, 2)}/${st(0, 3)}; b: late ${st(1, 1)} bulk in/out ${st(1, 2)}/${st(1, 3)}; ` +
    `sheets: ${shotFiles.map((f) => path.relative(process.cwd(), f)).join(' ') || 'none'}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(2); });
