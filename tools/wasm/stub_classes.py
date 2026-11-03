"""Classes of the TLA build's logged stubs (TLA2b), from build/wasm-tla/stubs.tsv and the address map:

  place  main | overlay NNN (an ovNNN_ name: called from overlay NNN) | none (the name is in no map)
  class  asm-listing   defined by a listing-asm object (recon/tla/raw, TLA5 translates it)
         asm-hand      defined by a hand-written .s of games/tla/src (TLA4/TLA5)
         c-left-out    defined by a C object clang does not take yet (build/wasm-tla/ll_failed.tsv)
         c-dropped     defined by C that is compiled (a definition bind.py dropped, or another name)
         elsewhere-c / elsewhere-asm  an overlay's name that this overlay does not define, defined by C or asm in
                       another overlay or the main image (a call the vendor resolves by address)
         unmapped      in no map (port names, linker symbols, names of left-out C)

Writes build/<out>/stub_classes.tsv (name, place, class, defining object) and build/<out>/asm_stubs.tsv (the real
assembly routines still stubbed: name, place, object; the list TLA4/TLA5 consume). Names and paths only.
Usage: PORT_GAME=tla python3 tools/wasm/stub_classes.py [--commit FILE]  (also run by link.py for TLA)."""
import os
import re
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import game  # noqa: E402


def _rows(path):
    hdr = None
    for line in open(path, encoding='utf-8'):
        if line.startswith('#'):
            continue
        f = line.rstrip('\n').split('\t')
        if hdr is None:
            hdr = f
            continue
        yield dict(zip(hdr, f))


def kind_of(obj, failed):
    if obj in failed:
        return 'c-left-out'
    if os.path.exists(os.path.join(game.C.vendor, obj + '.c')):
        return 'c-dropped'
    if obj.startswith(('out/', 'recon/')) or '/recon/' in obj:
        return 'asm-listing'
    if os.path.exists(os.path.join(game.C.vendor, obj + '.s')):
        return 'asm-hand'
    return 'asm-listing' if 'raw/' in obj else 'unknown'


def classify(out=None):
    out = out or game.C.out
    main = {r['name']: r['object'] for r in _rows(game.sym('MAP.tsv')) if r.get('kind') == 'code'}
    ovl = {}
    anywhere = defaultdict(set)
    for r in _rows(game.sym('MAP-overlays.tsv')):
        if r.get('kind') == 'code':
            ovl[(r['overlay'], r['name'])] = r['object']
            anywhere[r['name']].add(r['object'])
    failed_path = os.path.join(out, 'll_failed.tsv')
    failed = {r['object'] for r in _rows(failed_path)} if os.path.exists(failed_path) else set()
    res = []
    for r in _rows(os.path.join(out, 'stubs.tsv')):
        name = r['name']
        m = re.match(r'ov([0-9a-f]{3})_(.+)$', name)
        if m:
            ov, base = m.groups()
            place = 'overlay'
            if (ov, base) in ovl:
                obj = ovl[(ov, base)]
                cls = kind_of(obj, failed)
            else:
                objs = sorted(anywhere.get(base, set()) | ({main[base]} if base in main else set()))
                obj = ','.join(objs)[:120]
                kinds = {kind_of(o, failed) for o in objs}
                cls = ('elsewhere-c' if any(k.startswith('c-') for k in kinds) else 'elsewhere-asm') if objs \
                    else 'unmapped'
        elif name in main:
            place, obj = 'main', main[name]
            cls = kind_of(obj, failed)
        else:
            objs = sorted(anywhere.get(name, set()))
            place, obj = ('overlay', ','.join(objs)[:120]) if objs else ('none', '')
            cls = ({kind_of(o, failed) for o in objs}.pop() if len({kind_of(o, failed) for o in objs}) == 1
                   else 'mixed') if objs else 'unmapped'
        res.append((name, place, cls, obj))
    with open(os.path.join(out, 'stub_classes.tsv'), 'w') as f:
        f.write('name\tplace\tclass\tobject\n')
        for row in res:
            f.write('\t'.join(row) + '\n')
    with open(os.path.join(out, 'asm_stubs.tsv'), 'w') as f:
        f.write('name\tplace\tclass\tobject\n')
        for row in res:
            if row[2].startswith('asm-'):
                f.write('\t'.join(row) + '\n')
    c = Counter((p, k) for _, p, k, _ in res)
    print('stub classes: ' + ', '.join(f'{p} {k} {n}' for (p, k), n in sorted(c.items())))
    return res


if __name__ == '__main__':
    rows = classify()
    if '--commit' in sys.argv:  # names only (no bytes): the asm routines TLA4/TLA5 still owe
        path = sys.argv[sys.argv.index('--commit') + 1]
        with open(path, 'w') as f:
            f.write('# TLA: assembly routines the wasm build still stubs (tools/wasm/stub_classes.py, TLA2b): name, place\n'
                    '# (main or overlay), class (asm-listing: recon/tla/raw listing; asm-hand: games/tla/src .s), object.\n'
                    '# Names and paths only. Regenerate: PORT_GAME=tla python3 tools/wasm/stub_classes.py --commit FILE\n')
            f.write('name\tplace\tclass\tobject\n')
            for row in sorted(rows):
                if row[2].startswith('asm-'):
                    f.write('\t'.join(row) + '\n')
