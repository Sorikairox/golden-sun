#!/usr/bin/env python3
"""Static check of asm2c's constant call targets (TLA4b, orchestrator trap 66).

D20 cannot see translated code calling into the middle of another routine: the test interpreter runs any address.
In the game such a call goes to Port_ResolveCode with an address that has no function and aborts. This check reads
the generated C of the build (build/wasm-tla/asm2c/tla_asm.c: asm2c's listings and hw2c's byte listings in one
file) and lists every constant call or branch target out of a translated routine (`a2c_call(0x...)`) that is no
bound entry point. Bound entry points:
  - a translated routine (asm2c's codemap, overlap entries included: an overlay's routines for its own overlay);
  - a row of the link's code map (build/wasm-tla/gen/code_map.ll: C functions, port functions, wrappers, veneers;
    an overlay's rows for that overlay);
  - Port_ResolveCode's soft-reset addresses (Cart_Start, Entry).
A target that is none of these must be in port/tla/call_targets_allow.tsv with a reason (names and addresses only),
or the build fails. Rows of the allow list no target uses any more are reported as stale (no failure).
Usage: python3 tools/wasm/call_targets.py [--out build/wasm-tla] [--write-all FILE]
"""
import argparse
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
SOFT_RESET = {0x08000000, 0x08000428}


def scan(cfile):
    """[(overlay or '', caller cname, target)] for every constant a2c_call, and asm2c's codemap rows."""
    calls, rows = [], set()
    fn = None
    rx_fn = re.compile(r'^void (a2c_(?:ov([0-9a-f]+)_)?[0-9a-f]{8})\(void\) \{$')
    rx_call = re.compile(r'a2c_(?:call|table)\(0x([0-9a-f]+)u\)')  # table: a computed call's slots (TLA4c)
    rx_row = re.compile(r'^  \{0x([0-9a-f]+)u, 0x([0-9a-f]+), a2c_')
    for line in open(cfile, encoding='utf-8'):
        m = rx_fn.match(line)
        if m:
            fn = (m.group(2) or '', m.group(1))
            continue
        if line.startswith('}'):
            fn = None
            continue
        if fn:
            for t in rx_call.findall(line):
                calls.append((fn[0], fn[1], int(t, 16) & ~1))
            continue
        m = rx_row.match(line)
        if m:
            ov = m.group(2)
            rows.add(('' if ov == '0' else ov, int(m.group(1), 16) & ~1))
    return calls, rows


def codemap_rows(ll):
    out = set()
    for a, ov in re.findall(r'\{ i32 (\d+), i32 (\d+), ptr @', open(ll, encoding='utf-8').read()):
        out.add(('' if ov == '0' else f'{int(ov):03x}', int(a) & ~1))
    return out


def load_allow(path):
    allow = {}
    if os.path.exists(path):
        for line in open(path, encoding='utf-8'):
            if line.startswith('#') or not line.strip():
                continue
            f = line.rstrip('\n').split('\t')
            if f[0] == 'target':
                continue
            allow[(f[1], int(f[0], 16) & ~1)] = f[2] if len(f) > 2 else ''
    return allow


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(ROOT, 'build/wasm-tla'))
    ap.add_argument('--allow', default=os.path.join(ROOT, 'port/tla/call_targets_allow.tsv'))
    ap.add_argument('--write-all', help='write every unbound target (target, overlay, callers) to FILE')
    args = ap.parse_args()
    calls, a2c_rows = scan(os.path.join(args.out, 'asm2c/tla_asm.c'))
    cm = codemap_rows(os.path.join(args.out, 'gen/code_map.ll'))
    bound = a2c_rows | cm
    unbound = {}
    for ov, caller, t in calls:
        if t in SOFT_RESET:
            continue
        key = (ov if ov and 0x02008000 <= t < 0x02010000 else '', t)  # the overlay area: that overlay's code
        if key in bound:
            continue
        unbound.setdefault(key, set()).add(caller)
    allow = load_allow(args.allow)
    # H4 (TLA4b): a call by the ROM load address of code copied to IWRAM runs the IWRAM translation (Port_TlaRunAddress)
    copies = []
    for line in open(os.path.join(ROOT, 'port/tla/symbols/sections.tsv'), encoding='utf-8'):
        f = line.rstrip('\n').split('\t')
        if len(f) > 3 and f[1].startswith('0x03') and f[2].startswith('0x08'):
            copies.append((int(f[2], 16), int(f[1], 16), int(f[3])))
    for (ov, t) in list(unbound):
        for rom, run, size in copies:
            if rom <= t < rom + size:
                callers = unbound.pop((ov, t))
                r = run + t - rom
                if ('', r) not in bound:
                    unbound.setdefault(('', r), set()).update(callers)
    new = {k: v for k, v in unbound.items() if k not in allow}
    stale = [k for k in allow if k not in unbound]
    if args.write_all:
        with open(args.write_all, 'w') as o:
            o.write('target\toverlay\tcallers\n')
            for (ov, t), c in sorted(unbound.items(), key=lambda x: (x[0][0], x[0][1])):
                o.write(f'{t:08x}\t{ov}\t{",".join(sorted(c))}\n')
    print(f'call targets: {len(calls)} constant a2c_call sites, {len(unbound)} unbound targets '
          f'({len(unbound) - len(new)} allowed, {len(new)} new), {len(stale)} stale allow rows: '
          f'{"FAIL" if new else "PASS"}')
    for (ov, t), c in sorted(new.items(), key=lambda x: (x[0][0], x[0][1]))[:40]:
        print(f'  new: 0x{t:08x} {("overlay " + ov) if ov else "main"} from {", ".join(sorted(c)[:4])}')
    for ov, t in stale[:20]:
        print(f'  stale: 0x{t:08x} {ov}')
    return 1 if new else 0


if __name__ == '__main__':
    sys.exit(main())
