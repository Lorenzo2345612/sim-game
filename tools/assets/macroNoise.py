"""Tileable fractal value noise, RGB = 4/16/64 periods across 512 px. Usage: macroNoise.py OUT.png"""
import random
import sys
from PIL import Image

SIZE = 512
SEED = 1
OCTAVES = 3


def smooth(t):
    return t * t * t * (t * (t * 6 - 15) + 10)


def value_noise(rng, cells):
    g = [[rng.random() for _ in range(cells)] for _ in range(cells)]
    step = cells / SIZE
    ax = []
    for x in range(SIZE):
        f = x * step
        i = int(f)
        ax.append((i, (i + 1) % cells, smooth(f - i)))
    out = []
    for y in range(SIZE):
        i, j, ty = ax[y]
        r0, r1 = g[i], g[j]
        row = []
        for x in range(SIZE):
            a, b, tx = ax[x]
            top = r0[a] + (r0[b] - r0[a]) * tx
            bot = r1[a] + (r1[b] - r1[a]) * tx
            row.append(top + (bot - top) * ty)
        out.append(row)
    return out


def fbm(rng, base):
    acc = [[0.0] * SIZE for _ in range(SIZE)]
    amp = 1.0
    for o in range(OCTAVES):
        n = value_noise(rng, base * 2 ** o)
        for y in range(SIZE):
            ar, nr = acc[y], n[y]
            for x in range(SIZE):
                ar[x] += nr[x] * amp
        amp *= 0.5
    return acc


def normalise(a):
    lo = min(min(r) for r in a)
    hi = max(max(r) for r in a)
    k = 255.0 / (hi - lo)
    return [[int(round((v - lo) * k)) for v in r] for r in a]


def main():
    rng = random.Random(SEED)
    ch = [normalise(fbm(rng, p)) for p in (4, 16, 64)]
    img = Image.new("RGB", (SIZE, SIZE))
    px = img.load()
    for y in range(SIZE):
        for x in range(SIZE):
            px[x, y] = (ch[0][y][x], ch[1][y][x], ch[2][y][x])
    img.save(sys.argv[1], optimize=True)


if __name__ == "__main__":
    main()
