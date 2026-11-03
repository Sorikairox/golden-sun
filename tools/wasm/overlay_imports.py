"""Scene import veneers of TLA's overlays (TLA2b). Each scene overlay has its own import table, an assembly file
(src/scene/<scene>/import.s, and a few others) of entries

    NAME:
        overlay_veneer TARGET

that jump from the overlay to a main-image routine (often a far-call veneer TARGET = NAMEFar). The same NAME can
lead to different targets in different overlays (Func_02001d24, ...), so bind.py names an overlay's call of such a
NAME ovNNN_NAME (as it names the overlay's own functions) and link.py turns ovNNN_NAME into a veneer that calls
that overlay's TARGET (GS1's overlays use one global import list, system/overlay/imports.inc, which veneer_map
reads). Names and targets only; the files are read from the pinned vendor tree.
"""
import os
import re

import game

_cache = None
LABEL = re.compile(r'^([\w.]+):\s*$')
JUMP = re.compile(r'^\s*(?:overlay_veneer\s+|\.4byte\s+)([A-Za-z_][\w.]*)\s*$')


def parse(path):
    """[(NAME, TARGET)] of a veneer file: each label up to the next `overlay_veneer TARGET` (or the literal-pool
    form `ldr r4, [pc, #0]; bx r4; .4byte TARGET`) leads to TARGET; two labels can share one veneer."""
    out, labels = [], []
    for line in open(path, encoding='utf-8', errors='replace'):
        m = LABEL.match(line)
        if m:
            labels.append(m.group(1))
            continue
        m = JUMP.match(line)
        if m and labels:
            out += [(n, m.group(1)) for n in labels]
            labels = []
    return out


def imports():
    """{overlay id: {NAME: TARGET}} from the overlays' assembly objects (objects.tsv), {} for tbs."""
    global _cache
    if _cache is not None:
        return _cache
    _cache = {}
    if game.C.game == 'tbs':
        return _cache
    for line in open(game.sym('objects.tsv'), encoding='utf-8'):
        if line.startswith('#'):
            continue
        f = line.rstrip('\n').split('\t')
        if len(f) < 3 or f[0] in ('main', 'image') or f[2] not in ('code', 'mixed'):
            continue
        path = os.path.join(game.C.vendor, f[1] + '.s')
        if not os.path.exists(path):
            continue
        for name, target in parse(path):
            _cache.setdefault(f[0], {}).setdefault(name, target)
    return _cache


def far_calls():
    """{NAME: TARGET} of TLA's far-call veneers (src/gamepak/far_call/*.s, `NAMEFar: overlay_veneer NAME`; tbs
    spells them `export NAME, TARGET`, which link.py's veneer_map reads), {} for tbs."""
    out = {}
    if game.C.game == 'tbs':
        return out
    import glob
    for path in sorted(glob.glob(os.path.join(game.C.vendor, 'src/gamepak/far_call/*.s'))):
        for name, target in parse(path):
            out.setdefault(name, target)
    return out


def veneer_map():
    """{ovNNN_NAME: TARGET} of the overlays' imports and {NAME: TARGET} of the far calls, for link.py."""
    out = far_calls()
    out.update({f'ov{ov}_{name}': target for ov, m in imports().items() for name, target in m.items()})
    return out
