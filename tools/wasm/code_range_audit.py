#!/usr/bin/env python3
"""Code-range audit (GS14, traps 26 and 40): in wasm a code "address" is a function-table index (0x10000-0x1ffff),
so vendor C that tells code from data by the numeric range or the high bits of a value, or measures code by
subtracting addresses, behaves differently in the port. This scans the pinned vendor tree for such tests and
checks every hit against port/tools/code_range_audit.tsv (file, line, pattern id, verdict, fix: no code text).
A hit with no row fails the build (a re-pin or a new pattern needs a fresh look); a row with no hit is reported
as stale. Usage: code_range_audit.py [--list]  (--list prints every hit with its row, or NEW)."""
import os
import re
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '../..'))
TBS = os.path.join(ROOT, 'vendor/alchemy/games/tbs')
TABLE = os.path.join(ROOT, 'port/tools/code_range_audit.tsv')

# pattern id -> regex over a line with its comments removed
PATTERNS = [
    ('shr24', re.compile(r'>>\s*2[4-7]\b')),                                   # top byte / bits 27-24 of a word
    ('topmask', re.compile(r'\b0x(?:0?[fF]000000|[fF][fF]000000|[fF]0000000|0?[eE]000000)u?\b')),
    ('region', re.compile(r'\b0x0?(?:[23689]000000|2040000|3008000|2008000|2010000)u?\b')),
    ('below64k', re.compile(r'(?:<=?|>=?)\s*(?:65536|0x10000|0xffff|0xFFFF)u?\b')),
    ('msgend', re.compile(r'\b(?:TRIGGER_RESULT_MESSAGE_END|FIND_FUNCTION_BITS|IWRAM_START|EWRAM_END)\b')),
    ('codediff', re.compile(r'\(u32\)\s*&?[A-Za-z_]\w*\s*-\s*\(u32\)\s*&?[A-Za-z_]\w*')),
]


def strip_comments(text):
    text = re.sub(r'/\*.*?\*/', lambda m: re.sub(r'[^\n]', ' ', m.group(0)), text, flags=re.S)
    text = re.sub(r'"(?:\\.|[^"\\\n])*"', '""', text)
    return re.sub(r'//[^\n]*', '', text)


def scan():
    hits = []
    for top in ('src', 'include'):
        for dirpath, dirs, files in os.walk(os.path.join(TBS, top)):
            dirs.sort()
            for name in sorted(files):
                if not name.endswith(('.c', '.h')):
                    continue
                path = os.path.join(dirpath, name)
                rel = os.path.relpath(path, TBS)
                text = strip_comments(open(path, encoding='utf-8', errors='replace').read())
                for n, line in enumerate(text.split('\n'), 1):
                    for pid, rx in PATTERNS:
                        if rx.search(line):
                            hits.append((rel, n, pid))
    return hits


def load_table():
    rows = {}
    for line in open(TABLE, encoding='utf-8'):
        if line.startswith('#') or not line.strip():
            continue
        f = line.rstrip('\n').split('\t')
        if f[0] == 'file':
            continue
        rows[(f[0], int(f[1]), f[2])] = f
    return rows


def run(listing=False):
    hits = scan()
    rows = load_table() if os.path.exists(TABLE) else {}
    new = [h for h in hits if h not in rows]
    stale = [k for k in rows if k not in set(hits)]
    if listing:
        for h in hits:
            r = rows.get(h)
            print(f'{h[0]}\t{h[1]}\t{h[2]}\t' + ('\t'.join(r[3:]) if r else 'NEW'))
    for k in stale:
        print(f'code_range_audit: stale row {k[0]}:{k[1]} {k[2]} (no such hit; re-pinned vendor?)')
    for h in new:
        print(f'code_range_audit: NEW unaudited {h[0]}:{h[1]} {h[2]} (add a row to port/tools/code_range_audit.tsv)')
    bad = [k for k, r in rows.items() if len(r) < 5 or r[3] not in ('data', 'safe', 'fixed', 'replaced', 'unused')]
    for k in bad:
        print(f'code_range_audit: row {k[0]}:{k[1]} {k[2]} has no verdict (data/safe/fixed/replaced/unused)')
    ok = not new and not bad and not stale
    print(f'code_range_audit: {len(hits)} hits, {len(rows)} rows, {len(new)} new, {len(stale)} stale: '
          + ('PASS' if ok else 'FAIL'))
    return ok


if __name__ == '__main__':
    sys.exit(0 if run(listing='--list' in sys.argv) else 1)
