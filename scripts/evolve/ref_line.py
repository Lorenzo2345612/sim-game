#!/usr/bin/env python3
"""Reference lap (ghost JSON) -> min-time line cache {pts, v} used by `--line mintime`.

usage: python3 -I scripts/evolve/ref_line.py <ghost.json> <track.json> <out.json> [--clamp 7.9]
"""
import json, math, sys


def main(argv):
    ghost_p, track_p, out_p = argv[1:4]
    clamp = float(argv[argv.index('--clamp') + 1]) if '--clamp' in argv else None
    g = json.load(open(ghost_p))
    t = json.load(open(track_p))
    cl = t['centerline']
    n = len(cl)
    hw = t['widthMeters'] / 2
    lim = clamp if clamp is not None else hw + 0.4
    cum = [0.0]
    for i in range(1, n):
        cum.append(cum[-1] + math.dist(cl[i - 1], cl[i]))
    L = cum[-1] + math.dist(cl[-1], cl[0])

    def proj(x, z, hint):
        best = None
        for di in range(-40, 41):
            i = (hint + di) % n
            j = (i + 1) % n
            ax, az = cl[i]
            bx, bz = cl[j]
            dx, dz = bx - ax, bz - az
            l2 = dx * dx + dz * dz
            u = max(0.0, min(1.0, ((x - ax) * dx + (z - az) * dz) / l2))
            d = math.hypot(x - ax - u * dx, z - az - u * dz)
            if best is None or d < best[0]:
                lat = (dx * (z - az) - dz * (x - ax)) / math.sqrt(l2)
                best = (d, i, cum[i] + u * math.sqrt(l2), lat)
        return best

    S = g['samples']
    hint = min(range(n), key=lambda i: math.dist(cl[i], (S[0][1], S[0][3])))
    obs = []  # (s, lat, v)
    for k, s in enumerate(S):
        _, hint, sa, lat = proj(s[1], s[3], hint)
        p = S[k - 1] if k else S[-1]
        dt = s[0] - p[0] if k else None
        v = math.dist((p[1], p[3]), (s[1], s[3])) / dt if dt else None
        obs.append((sa, lat, v))
    obs[0] = (obs[0][0], obs[0][1], obs[1][2])
    bins = set(int(o[0] // 50) for o in obs)
    if len(bins) < int(L // 50):
        raise SystemExit(f'Invalid reference lap: covers {len(bins)} of {int(L // 50)} 50 m bins')
    obs.sort()
    ext = [(o[0] - L, o[1], o[2]) for o in obs[-20:]] + obs + [(o[0] + L, o[1], o[2]) for o in obs[:20]]

    def interp(sq, idx):
        lo, hi = 0, len(ext) - 1
        while hi - lo > 1:
            m = (lo + hi) // 2
            if ext[m][0] <= sq: lo = m
            else: hi = m
        a, b = ext[lo], ext[hi]
        w = 0 if b[0] == a[0] else (sq - a[0]) / (b[0] - a[0])
        return a[idx] + w * (b[idx] - a[idx])

    lat = [interp(cum[i], 1) for i in range(n)]
    vel = [interp(cum[i], 2) for i in range(n)]
    sm = lambda a: [sum(a[(i + d) % n] for d in range(-3, 4)) / 7 for i in range(n)]
    lat, vel = sm(lat), sm(vel)
    pts = []
    for i in range(n):
        a, b = cl[(i - 1) % n], cl[(i + 1) % n]
        tx, tz = b[0] - a[0], b[1] - a[1]
        l = math.hypot(tx, tz) or 1
        q = max(-lim, min(lim, lat[i]))
        pts.append([cl[i][0] - tz / l * q, cl[i][1] + tx / l * q])
    tlap = sum(math.dist(pts[i], pts[(i + 1) % n]) / ((vel[i] + vel[(i + 1) % n]) / 2) for i in range(n))
    json.dump({'pts': pts, 'v': vel, 'tRacing': g['lapTime'], 'tMin': tlap, 'maxRatio': 1, 'source': 'ref'}, open(out_p, 'w'))
    print(f'ref line: {n} pts, lap {g["lapTime"]:.2f} s, integrated {tlap:.2f} s, v {min(vel):.1f}-{max(vel):.1f} m/s, |lat| max {max(abs(x) for x in lat):.2f} (clamp {lim})')


if __name__ == '__main__':
    main(sys.argv)
