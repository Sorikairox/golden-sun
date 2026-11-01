// Negative controls for the differential harness: pairs that must NOT compare equal (an original against a
// different port, or C's own operator), so a harness that compares nothing cannot pass. Also checks the
// interpreter's results against known values. Usage as diff.cjs.
'use strict';
const { Harness, load } = require('./harness');
(async () => {
  const [gameJs, rom] = process.argv.slice(2);
  const m = await load(gameJs, rom);
  const h = new Harness(m);
  let bad = 0;
  const expectDiff = (what, spec, args, opts) => {
    const d = h.compare(spec, args, opts);
    console.log(`${d ? 'ok  ' : 'BAD '} ${what}: ${d || 'compared equal'}`);
    if (!d) bad++;
  };
  // remainder sign: dividend XOR divisor, not C's (dividend): -7 % 2 differs? (-7 ^ 2) < 0 -> -1, C gives -1;
  // 7 % -2: original -1, C +1
  const cRem = (a, b) => (a % b) | 0;
  const ro = h.cpu.call(h.addr('IwramSignedRemainder'), [7, -2 >>> 0]) | 0;
  console.log(`${ro === -1 && cRem(7, -2) === 1 ? 'ok  ' : 'BAD '} IwramSignedRemainder(7, -2) = ${ro} (C's % gives ${cRem(7, -2)})`);
  if (!(ro === -1)) bad++;
  const q = h.cpu.call(h.addr('IwramUnsignedDivide'), [100, 7]);
  console.log(`${q === 14 ? 'ok  ' : 'BAD '} IwramUnsignedDivide(100, 7) = ${q}`);
  if (q !== 14) bad++;
  expectDiff('IwramSignedRemainder vs port IwramSignedDivide', { orig: h.addr('IwramSignedRemainder'), port: 'IwramSignedDivide', returns: 'u32' }, [1000, 7]);
  expectDiff('Trig_Sin vs port Trig_Cos', { orig: h.addr('Trig_Sin') | 1, port: 'Trig_Cos', returns: 'u32' }, [1234]);
  // memory: FillWords original vs ClearWords port with a nonzero value
  expectDiff('IwramFillWords(v=5) vs port IwramClearWords', { orig: h.addr('IwramFillWords'), port: 'IwramClearWords', returns: 'none' }, [0x02020000, 64, 5]);
  // memory effect only (same return): Heap_Release on an IWRAM vs EWRAM address
  expectDiff('Heap_Release original vs port HeapSlot_Release', { orig: h.addr('Heap_Release') | 1, port: 'HeapSlot_Release', returns: 'none' }, [0x03001000]);
  console.log(bad ? `${bad} negative controls failed` : 'all negative controls detected');
  process.exit(bad ? 1 : 0);
})();
