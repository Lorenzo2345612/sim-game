#!/usr/bin/env python3
"""Inspect a GLB without dependencies: asset info, materials, triangles, world bbox and per-node world boxes.

Usage: python3 -I scripts/preview/glb_inspect.py <file.glb> [--nodes]
Run with -I: downloaded files are untrusted.
"""
import json
import struct
import sys


def load(path):
    b = open(path, 'rb').read()
    n = struct.unpack('<I', b[12:16])[0]
    return json.loads(b[20:20 + n])


def mul(a, b):
    return [sum(a[r + 4 * k] * b[k + 4 * c] for k in range(4)) for c in range(4) for r in range(4)]


def local(n):
    if 'matrix' in n:
        return n['matrix']
    t = n.get('translation', [0, 0, 0]); s = n.get('scale', [1, 1, 1]); x, y, z, w = n.get('rotation', [0, 0, 0, 1])
    m = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
         2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
         2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, 0, 0, 0, 1]
    for c in range(3):
        for r in range(3):
            m[4 * c + r] *= s[c]
    m[12], m[13], m[14] = t
    return m


def pt(m, p):
    return [m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r] for r in range(3)]


def main():
    g = load(sys.argv[1]); acc = g['accessors']
    print('asset', g.get('asset', {}).get('extras', {}).get('license', '?'), '|', g.get('asset', {}).get('extras', {}).get('title', ''))
    tris = {}
    for i, m in enumerate(g['meshes']):
        tris[i] = sum((acc[p['indices']]['count'] if 'indices' in p else acc[p['attributes']['POSITION']]['count']) // 3
                      for p in m['primitives'])
    print('meshes', len(g['meshes']), 'tris', sum(tris.values()), 'materials', len(g.get('materials', [])),
          'images', len(g.get('images', [])))
    for m in g.get('materials', []):
        print('  mat', m.get('name'), sorted(m.get('pbrMetallicRoughness', {}).keys()))
    out = []

    def walk(i, parent, label):
        n = g['nodes'][i]; m = mul(parent, local(n)); lab = n.get('name') or label
        if 'mesh' in n:
            lo = [1e9] * 3; hi = [-1e9] * 3
            for p in g['meshes'][n['mesh']]['primitives']:
                a = acc[p['attributes']['POSITION']]
                for cx in (a['min'][0], a['max'][0]):
                    for cy in (a['min'][1], a['max'][1]):
                        for cz in (a['min'][2], a['max'][2]):
                            q = pt(m, [cx, cy, cz]); lo = [min(u, v) for u, v in zip(lo, q)]; hi = [max(u, v) for u, v in zip(hi, q)]
            out.append((label if n.get('name', '').startswith(('Object', 'Mesh')) else lab, tris[n['mesh']], lo, hi))
        for c in n.get('children', []):
            walk(c, m, lab)

    ident = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    for r in g['scenes'][g.get('scene', 0)]['nodes']:
        walk(r, ident, 'root')
    lo = [min(o[2][k] for o in out) for k in range(3)]; hi = [max(o[3][k] for o in out) for k in range(3)]
    print('world bbox', [round(v, 3) for v in lo], [round(v, 3) for v in hi], 'size', [round(b - a, 3) for a, b in zip(lo, hi)])
    if '--nodes' in sys.argv:
        for name, t, a, b in sorted(out, key=lambda o: -o[1]):
            print(f'  {name[:40]:40} {t:7} {[round(v, 3) for v in a]} {[round(v, 3) for v in b]}')


if __name__ == '__main__':
    main()
