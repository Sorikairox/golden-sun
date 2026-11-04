#!/usr/bin/env python3
"""Static check of K&R calls that pass fewer words than their target takes (TLA7, orchestrator trap 75).

A call of a K&R-declared function (`f()`) with fewer arguments than f's definition goes through link.py's
per-signature adapter `f$c<signature>`, which passes 0 for the missing words (adapter()). On the ARM they are what
the caller's registers hold: often its own incoming argument passed through (TLA6b: GameFlag_IsConditionActive tested
flag 0 for every condition). This check reads the link's glue (build/wasm-tla/gen/glue.ll) and lists every adapter
whose body calls its target with more arguments than the adapter takes. Each must be in
port/tla/short_knr_allow.tsv with a reason (what r0-r3 hold on the ARM and why 0 is right or harmless), or the
build fails; fix the others with c_rules (give the call its words). Stale allow rows are reported (no failure).
Usage: python3 tools/wasm/short_knr.py [--out build/wasm-tla]
"""
import argparse
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
ALLOW = os.path.join(ROOT, 'port/tla/short_knr_allow.tsv')
RX = re.compile(r'^define \S+ @"([^"]+\$c[^"]*)"\((.*?)\) \{\n(.*?)\n\}', re.M | re.S)
TYPE = r'(?:i1|i8|i16|i32|i64|ptr|float|double)\b'


def short_adapters(glue):
    """[(adapter, target, words passed, words taken)] for adapters that drop arguments their target takes."""
    out = []
    for m in RX.finditer(open(glue, encoding='utf-8').read()):
        name, params, body = m.groups()
        c = re.search(r'call \S+ @"([^"]+)"\((.*)\)', body)
        if not c:
            continue
        given = len(re.findall(TYPE, params))
        taken = len(re.findall(TYPE + r' (?:%|null|undef|0|-?\d)', c.group(2)))
        if taken > given:
            out.append((name, c.group(1), given, taken))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(ROOT, 'build/wasm-tla'))
    a = ap.parse_args()
    rows = short_adapters(os.path.join(a.out, 'gen', 'glue.ll'))
    allow = {}
    for line in open(ALLOW, encoding='utf-8'):
        f = line.rstrip('\n').split('\t')
        if line.startswith('#') or f[0] == 'adapter' or len(f) < 2:
            continue
        allow[f[0]] = f[1]
    new = [r for r in rows if r[0] not in allow]
    stale = sorted(set(allow) - {r[0] for r in rows})
    for name, target, given, taken in new:
        print(f'short K&R call: {name} passes {given} of {target}\'s {taken} words (not in port/tla/short_knr_allow.tsv)')
    for s in stale:
        print(f'short K&R call: stale allow row {s}')
    print(f'short K&R calls: {len(rows)} adapters drop words ({len(rows) - len(new)} allowed, {len(new)} new), '
          f'{len(stale)} stale allow rows: {"FAIL" if new else "PASS"}')
    return 1 if new else 0


if __name__ == '__main__':
    sys.exit(main())
