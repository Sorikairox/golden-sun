#!/usr/bin/env python3
"""TLA4a: writes port/tla/hw/bindings.tsv, the names-only list of how each label of TLA's handwritten asm is provided
in the wasm build (for TLA2b / TLA4b's link stage). Inputs: build/tla_hw/census.tsv and objects.tsv
(hand_census.py), build/a2c/hw_test.report.tsv (tests/arm/tla/build_hw.sh), build/tla_hw/d20_hw.tsv
(tests/arm/tla/diff_hw.cjs), port/pc/*.c (GS1's port functions), the vendor .s veneer macros (names only).

kind:
  gs1     GS1's port function of the same routine (object bytes identical to GS1's, or identical but for pool words and
          BL offsets of moved symbols: hand_census.py), already D20-proven in GS1 (tools/test_arm.sh)
  a2c     asm2c translation of the linked bytes (hw2c.py), function a2c_<addr>; proof = diff_hw.cjs result
  bind    PC layer (BIOS SWI wrappers, IRQ entry, halt, cartridge entry): our function in port/pc
  veneer  far-call / overlay-import veneer: the symbol is an alias of its target
  data    a label on data or on code that is only entered from another routine (no entry of its own)
  left    not provided yet (see docs/TLA4.md)
Usage: python3 port/tla/hw/tools/make_bindings.py
"""
import os
import re
from collections import Counter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../..'))
VEND = os.path.join(ROOT, 'vendor/alchemy/games/tla/src')

# PC-layer binds: TLA symbol -> (our function, why)
BINDS = {
    'IwramIrqMain': ('Port_RaiseIrq', 'IRQ entry (msr/mrs, banked sp): port/pc/hw.c dispatches gIrqHandlers in IwramIrqMain\'s order (hook H1: check TLA\'s order and table)'),
    'SoundDriver_EnterVBlankUpdate': ('Port_TlaSoundEnterVBlank', 'VBlank sound entry: callbacks, then the self-patching resident mixer asm2c cannot translate (TLA4c): port/tla/hw/pc_tla.c runs the callbacks, mixes no PCM yet'),
    'Iwram_Halt': ('Port_BiosHalt', 'swi 3 (Halt) from IWRAM: the frame driver\'s halt (fiber yield, D8)'),
    'Bios_CpuSet': ('Bios_CpuSet', 'swi 0x0B: port/pc/bios.c (GBATEK); object bytes identical to GS1\'s'),
    'Bios_SoundBiasOff': ('Bios_SoundBiasOff', 'swi 0x19: port/pc/bios.c; identical to GS1\'s'),
    'Bios_SoundBiasOn': ('Bios_SoundBiasOn', 'swi 0x19: port/pc/bios.c; identical to GS1\'s'),
    'Bios_SoundDriverMode': ('Port_BiosNop', 'swi 0x1B (BIOS sound driver mode): no BIOS sound driver in the port (hook H2)'),
    'Bios_Swi23': ('Port_BiosNop', 'swi 0x23 (SoundDriverVSyncOn): no BIOS sound driver (hook H2)'),
    'Bios_SoundGetJumpList': ('Port_BiosSoundGetJumpList', 'swi 0x2A: the BIOS sound jump list (hook H2; GS1 copies its relocated template, MPlayJumpTableCopy)'),
    'Entry': ('main', 'cartridge entry (mode switches, stacks): the module entry port/pc/main.c'),
    'Irq_StopOnGamePakRemoved': ('Port_BiosStop', 'swi 3 after the cartridge is pulled: never in the port'),
    # heap_release's tail (local label + global alias Irq_HaltOnGamePakRemoved): `swi 3` (Stop) with no return, the
    # same path as GS1's Irq_StopOnGamePakRemoved -> Port_BiosStop (TLA4a2)
    'AlchemyUncreditedEnd_08013172': ('Port_BiosStop', 'swi 3 (Stop) after the cartridge is pulled, as GS1\'s Irq_StopOnGamePakRemoved: never in the port'),
    'Irq_HaltOnGamePakRemoved': ('Port_BiosStop', 'swi 3 (Stop) after the cartridge is pulled, as GS1\'s Irq_StopOnGamePakRemoved: never in the port'),
}
# GS1 ports that are not themselves D20 EQUIV (port/overrides.tsv: SoundMain mixes with Camelot's mixer; MPlayMain,
# ply_note, m4aSoundVSync in C, not EQUIV-tested): their TLA twins take the asm2c translation instead
GS1_NOT_EQUIV = {'SoundMain', 'MPlayMain', 'ply_note', 'm4aSoundVSync'}
BIND_OBJS = {'src/system/irq', 'src/system/iwram_halt', 'src/system/bios', 'src/system/bios_sound_bias_on',
             'src/sound/bios_sound_driver_mode', 'src/sound/sound_get_jump_list', 'src/system/entry'}


def tsv(path):
    rows = []
    lines = open(path).read().split('\n')
    head = lines[0].split('\t')
    for line in lines[1:]:
        if line:
            rows.append(dict(zip(head, line.split('\t'))))
    return rows


def pc_functions():
    out = set()
    rx = re.compile(r'^(?!static)[A-Za-z_][\w \*]*?\b([A-Za-z_]\w*)\s*\([^;]*\)\s*\{', re.M)
    d = os.path.join(ROOT, 'port/pc')
    for f in os.listdir(d):
        if f.endswith('.c'):
            out.update(rx.findall(open(os.path.join(d, f)).read()))
    return out


def gs1_names_by_rom():
    d = {}
    for line in open(os.path.join(ROOT, 'port/symbols/tbs-en.tsv')):
        f = line.rstrip('\n').split('\t')
        if len(f) > 4 and f[2].startswith('0x') and f[4] == 'code':
            d.setdefault(int(f[2], 16), []).append(f[0])
    return d


def veneers():
    out = {}
    for dp, _, fs in os.walk(VEND):
        for fn in fs:
            if not fn.endswith('.s'):
                continue
            p = os.path.join(dp, fn)
            if not re.search(r'far_call/|/import\.s$|/entry\.s$', p):
                continue
            cur = None
            for line in open(p, errors='replace'):
                s = line.split('@')[0].strip()
                m = re.match(r'([A-Za-z_]\w*):$', s)
                if m:
                    cur = m.group(1)
                    continue
                m = re.match(r'\w*veneer\s+([A-Za-z_]\w*)', s)
                if m:
                    rel = os.path.relpath(p, os.path.join(ROOT, 'vendor/alchemy/games/tla'))[:-2]
                    if cur:
                        out[cur] = (m.group(1), rel)
                        cur = None
                    else:  # overlay entry table: the slot jumps to the overlay's own routine
                        out.setdefault(f'{rel}#{m.group(1)}', (m.group(1), rel))
    return out


def main():
    b = os.path.join(ROOT, 'build')
    census = tsv(os.path.join(b, 'tla_hw/census.tsv'))
    objv = {r['object']: r['verdict'] for r in tsv(os.path.join(b, 'tla_hw/objects.tsv'))}
    report = {r['name']: r for r in tsv(os.path.join(b, 'a2c/hw_test.report.tsv'))}
    d20 = {}
    for r in tsv(os.path.join(b, 'tla_hw/d20_hw.tsv')):
        d20[r['name']] = f"{r['result']} {r['cases']}"
    ip = os.path.join(b, 'tla_hw/internal_labels.txt')
    internal = set(open(ip).read().split()) if os.path.exists(ip) else set()
    pcf = pc_functions()
    byrom = gs1_names_by_rom()
    rows = []
    for r in census:
        if r['kind'] != 'code':
            continue
        names = r['names'].split(',')
        name = [n for n in names if not n.startswith('.')][0] if any(not n.startswith('.') for n in names) else names[0]
        obj, addr = r['object'], r['addr']
        aliases = ','.join(n for n in names if n != name and not n.startswith('.'))
        if obj in BIND_OBJS or name in BINDS:
            fn, why = BINDS.get(name, ('', 'data in a bound object'))
            rows.append((name, fn or '-', 'bind' if fn else 'data', obj, why, aliases))
            continue
        twin = r['gs1_twin']
        if not twin and r['verdict'] == 'bytes-found':
            cand = byrom.get(int(r['gs1_addr'], 16), [])
            twin = next((c for c in cand if c in pcf), cand[0] if cand else '')
        ov = objv.get(obj, '')
        if twin in pcf and twin not in GS1_NOT_EQUIV and (ov in ('same', 'reloc') or r['verdict'] in ('same', 'reloc')):
            rows.append((name, twin, 'gs1', obj, f'GS1 twin: bytes {ov or r["verdict"]}; GS1 D20 EQUIV (tools/test_arm.sh)', aliases))
            continue
        # the report and D20 key a routine by its label in the listing: with a local name dropped (hw2c), the global
        # alias (AlchemyUncreditedEnd_08013162 -> Heap_Release)
        key = next((n for n in [name] + aliases.split(',') if n in report), name)
        rep = report.get(key)
        if name in internal and not rep:
            rows.append((name, '-', 'data', obj, 'not an entry: a label inside the routine before it, local or only branched to (hw2c: its flow continues past it)', aliases))
            continue
        if r['mode'] == 'data' or (rep and rep['result'] != 'ok' and ('ARM NV' in rep['reason'] or 'flow leaves' in rep['reason'])):
            rows.append((name, '-', 'data', obj, 'data label, or code entered only from the routine before it', aliases))
            continue
        if rep and rep['result'] == 'ok':
            res = d20.get(key, 'untested 0')
            k = 'a2c' if not res.startswith('FAIL') else 'left'
            rows.append((name, f'a2c_{int(addr, 16):08x}', k, obj, f'D20 {res}', aliases))
            continue
        rows.append((name, '-', 'left', obj, rep['reason'] if rep else 'no translation', aliases))
    for sym, (tgt, obj) in sorted(veneers().items()):
        rows.append((sym, tgt, 'veneer', obj, 'alias of the target (far call / overlay import)', ''))
    out = os.path.join(ROOT, 'port/tla/hw/bindings.tsv')
    with open(out, 'w') as o:
        o.write('# TLA4a: how each label of The Lost Age\'s handwritten asm (games/tla/src/**/*.s at f6c08e64) is provided in the\n'
                '# wasm build. Names only (no ROM bytes). Written by port/tla/hw/tools/make_bindings.py; kinds and proofs in\n'
                '# docs/TLA4.md. A veneer row named obj#Target is an unnamed overlay entry-table slot.\n')
        o.write('symbol\tport\tkind\tobject\tproof\taliases\n')
        for x in rows:
            o.write('\t'.join(x) + '\n')
    print(out, dict(Counter(x[2] for x in rows)))
    for x in rows:
        if x[2] in ('left',):
            print('  left:', x[0], x[3], x[4])


if __name__ == '__main__':
    main()
