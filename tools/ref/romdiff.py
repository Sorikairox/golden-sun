#!/usr/bin/env python3
"""Compare a built image with the player's ROM; print differing runs (addresses and lengths only, no bytes),
and say which map input section each run falls in. Usage: romdiff.py BUILT ROM [MAP] [MAX_ROWS]"""
import bisect, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mapparse

a, b = open(sys.argv[1], 'rb').read(), open(sys.argv[2], 'rb').read()
secs = sorted((s for s in mapparse.parse(sys.argv[3])[0] if s.size and 0x08000000 <= s.addr < 0x08800000),
              key=lambda s: s.addr) if len(sys.argv) > 3 else []
starts = [s.addr for s in secs]
rows = int(sys.argv[4]) if len(sys.argv) > 4 else 40
runs, i, n = [], 0, min(len(a), len(b))
while i < n:
    if a[i] != b[i]:
        j = i
        while j < n and a[j] != b[j]:
            j += 1
        if runs and i - runs[-1][1] < 16:
            runs[-1][1] = j
        else:
            runs.append([i, j])
        i = j
    else:
        i += 1
total = sum(j - i for i, j in runs)
print(f"size {'equal' if len(a) == len(b) else 'DIFFERENT'}; {len(runs)} differing runs, {total} bytes differ")
by = {}
for i, j in runs:
    k = bisect.bisect_right(starts, 0x08000000 + i) - 1
    where = (mapparse.short_obj(secs[k].obj) + ' ' + secs[k].name) if k >= 0 and secs[k].addr + secs[k].size > 0x08000000 + i else '(fill/other)'
    by.setdefault(where, [0, 0])
    by[where][0] += 1
    by[where][1] += j - i
for w, (c, t) in sorted(by.items(), key=lambda x: -x[1][1])[:rows]:
    print(f"  {t:8d} bytes {c:4d} runs  {w}")
