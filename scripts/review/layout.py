"""Compare each built track centerline with its source GeoJSON: deviation stats + overlay PNG.
usage: python3 scripts/review/layout.py <outDir> [track ...]"""
import json, math, sys
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
R = 6371008.8


def project(coords):
    lons = [c[0] for c in coords]; lats = [c[1] for c in coords]
    lon0, lat0 = (min(lons) + max(lons)) / 2, (min(lats) + max(lats)) / 2
    k = R * math.pi / 180; c = math.cos(math.radians(lat0))
    return [((lon - lon0) * c * k, -(lat - lat0) * k) for lon, lat in coords]


def seg_dist(p, a, b):
    dx, dz = b[0] - a[0], b[1] - a[1]; l2 = dx * dx + dz * dz or 1e-12
    t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2))
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz)


def dist_to(p, poly):
    return min(seg_dist(p, poly[i], poly[(i + 1) % len(poly)]) for i in range(len(poly)))


def length(poly):
    return sum(math.dist(poly[i], poly[(i + 1) % len(poly)]) for i in range(len(poly)))


def main():
    out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
    cfg = {t["id"]: t for t in json.loads((ROOT / "tools/track-builder/tracks.json").read_text())}
    for tid in sys.argv[2:] or list(cfg):
        track = json.loads((ROOT / f"public/tracks/{tid}.json").read_text())
        gj = json.loads((ROOT / f"assets/source/tracks/{cfg[tid]['geojson']}.geojson").read_text())
        src = project(gj["features"][0]["geometry"]["coordinates"])
        if math.dist(src[0], src[-1]) < 1: src = src[:-1]
        ours = [tuple(p) for p in track["centerline"]]
        d1 = [dist_to(p, src) for p in ours[::5]]
        d2 = [dist_to(p, ours) for p in src]
        res = {"track": tid, "sourcePoints": len(src), "maxDevM": round(max(d1 + d2), 2), "meanDevM": round(sum(d1) / len(d1), 2),
               "lengthM": round(length(ours), 1), "sourceLengthM": round(length(src), 1), "officialM": track.get("officialLengthMeters")}
        print(json.dumps(res))
        xs = [p[0] for p in src + ours]; zs = [p[1] for p in src + ours]
        s = 1100 / max(max(xs) - min(xs), max(zs) - min(zs))
        P = lambda p: (50 + (p[0] - min(xs)) * s, 50 + (p[1] - min(zs)) * s)
        im = Image.new("RGB", (1200, 1200), "white"); dr = ImageDraw.Draw(im)
        dr.line([P(p) for p in src] + [P(src[0])], fill=(220, 0, 0), width=7)
        dr.line([P(p) for p in ours] + [P(ours[0])], fill=(0, 0, 0), width=2)
        dr.text((20, 15), f"{tid}: red = source GeoJSON, black = built. max dev {res['maxDevM']} m", fill="black")
        im.save(out / f"layout-{tid}.png")


main()
