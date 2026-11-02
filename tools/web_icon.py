#!/usr/bin/env python3
"""Draws the page's generic home-screen icon (GS-deploy): a plain sun (disc + 12 rays) on a dark square, our own
drawing, no game art. Full-bleed square with the sun inside the maskable safe zone (centre 80 %), so one picture
serves as 'any' and 'maskable'. Writes port/web/icon-192.png, icon-512.png and apple-touch-icon.png (180).
Pure Python (zlib PNG, 4x4 supersampling). Usage: python3 tools/web_icon.py"""
import math, os, struct, zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BG = (16, 16, 20)
SUN = (217, 166, 43)   # the page's accent colour


def inside(x, y):
    """x, y in [-1, 1]; True if the point is on the sun."""
    r = math.hypot(x, y)
    if r <= 0.36:
        return True
    if r < 0.44 or r > 0.70:
        return False
    a = math.atan2(y, x) % (math.pi / 6)
    half = 0.11 * (0.70 - r) / 0.26 + 0.03   # rays taper outwards
    return abs(a - math.pi / 12) * r < half * 0.5


def draw(n):
    ss = 4
    rows = []
    for py in range(n):
        row = bytearray([0])
        for px in range(n):
            hit = 0
            for sy in range(ss):
                for sx in range(ss):
                    x = ((px + (sx + 0.5) / ss) / n) * 2 - 1
                    y = ((py + (sy + 0.5) / ss) / n) * 2 - 1
                    hit += inside(x, y)
            t = hit / (ss * ss)
            row += bytes(round(BG[i] + (SUN[i] - BG[i]) * t) for i in range(3))
        rows.append(bytes(row))
    raw = b''.join(rows)
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', n, n, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


for name, n in (('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180)):
    with open(os.path.join(ROOT, 'port/web', name), 'wb') as f:
        f.write(draw(n))
    print(f'{name}: {n}x{n}')
