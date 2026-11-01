"""Asset leak check (PLAN G2, orchestrator trap 6): the wasm must contain none of the ROM's data.

Every 16-byte window (at 4-byte steps) of every ROM section that is not code (port/symbols/sections.tsv) and
that is not trivial (fewer than 6 distinct bytes, a constant-step run, or the hex digits) is looked up among all 16-byte windows of
game.wasm. A hit means game data was compiled in. The ROM is read only, in memory; nothing is written but
counts and section names.
Usage: leak_check.py GAME_WASM ROM ROOT   (or run(wasm, root) from build.py, ROM at /rom/baserom.gba)
"""
import os
import sys
from collections import Counter

ROM_BASE = 0x08000000
W = 16
# Not game data: the hex digits (libc's printf has them too) and byte runs counting up or down by a constant.
COMMON = {b'0123456789ABCDEF', b'0123456789abcdef'}


def trivial(win):
    if len(set(win)) < 6 or win in COMMON:
        return True
    d = (win[1] - win[0]) & 0xff
    return all(((win[i + 1] - win[i]) & 0xff) == d for i in range(len(win) - 1))


def run(wasm_path, root, rom_path='/rom/baserom.gba'):
    """Also checks each overlay's data against its uncompressed image when the reference build's
    port_work/g1/alchemy/overlays/resource_NNN.bin is present (tools/build_ref.sh)."""
    wasm = open(wasm_path, 'rb').read()
    rom = open(rom_path, 'rb').read()
    windows = {wasm[i:i + W] for i in range(len(wasm) - W + 1)}
    checked, hits, by_section, ovl_cache = 0, 0, Counter(), {}
    header = None
    for line in open(os.path.join(root, 'port/symbols/sections.tsv'), encoding='utf-8'):
        if line.startswith('#'):
            continue
        f = line.rstrip('\n').split('\t')
        if header is None:
            header = f
            continue
        r = dict(zip(header, f))
        if r['kind'] in ('code', 'ram'):
            continue
        if r['overlay']:
            binp = os.path.join(root, 'port_work/g1/alchemy/overlays', f"resource_{r['overlay']}.bin")
            if not os.path.exists(binp):
                continue
            image, start = ovl_cache.setdefault(binp, open(binp, 'rb').read()), int(r['address'], 16) - 0x02008000
        elif r['rom']:
            image, start = rom, int(r['rom'], 16) - ROM_BASE
        else:
            continue
        size = int(r['size'])
        for off in range(start, start + size - W + 1, 4):
            win = image[off:off + W]
            if trivial(win):
                continue
            checked += 1
            if win in windows:
                hits += 1
                by_section[f"{r['object']} {r['section']}"] += 1
    ok = hits == 0
    print(f'leak check: {checked} ROM data windows of {W} bytes looked up in {os.path.basename(wasm_path)} '
          f'({len(wasm)} bytes): {hits} found -> {"PASS" if ok else "FAIL"}')
    for name, n in by_section.most_common(15):
        print(f'  {n:6d}  {name}')
    return ok


if __name__ == '__main__':
    sys.exit(0 if run(sys.argv[1], sys.argv[3], sys.argv[2]) else 1)
