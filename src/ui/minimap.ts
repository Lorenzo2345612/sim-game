import type { SectorFlag } from '../race/flags';

export interface MinimapTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface MinimapCar {
  x: number;
  z: number;
  player: boolean;
  stopped: boolean;
}

/** Closed-loop arc-length thirds, cut points shared by adjacent sectors; sector 3 ends at centerline[0]. */
export function splitSectors(
  centerline: readonly [number, number][],
  fractions: readonly [number, number],
): [number, number][][] {
  const n = centerline.length;
  const seg = new Array<number>(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = centerline[i];
    const b = centerline[(i + 1) % n];
    seg[i] = Math.hypot(b[0] - a[0], b[1] - a[1]);
    total += seg[i];
  }
  const pointAt = (d: number): [number, number] => {
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const end = acc + seg[i];
      if (d <= end || i === n - 1) {
        const a = centerline[i];
        const b = centerline[(i + 1) % n];
        const t = seg[i] > 0 ? Math.min(1, Math.max(0, (d - acc) / seg[i])) : 0;
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      }
      acc = end;
    }
    return [centerline[0][0], centerline[0][1]];
  };
  const verts = new Array<number>(n);
  verts[0] = 0;
  for (let i = 1; i < n; i++) verts[i] = verts[i - 1] + seg[i - 1];
  const cuts = [0, fractions[0] * total, fractions[1] * total, total];
  const out: [number, number][][] = [];
  for (let k = 0; k < 3; k++) {
    const poly: [number, number][] = [pointAt(cuts[k])];
    for (let i = 1; i < n; i++) {
      if (verts[i] > cuts[k] && verts[i] < cuts[k + 1]) poly.push([centerline[i][0], centerline[i][1]]);
    }
    poly.push(pointAt(cuts[k + 1]));
    out.push(poly);
  }
  return out;
}

/** Sector stroke: green thin, yellow/double-yellow blink at 2 Hz; double-yellow is thickest. */
function fillSectorStyle(
  flag: SectorFlag,
  timeS: number,
  out: { color: string; width: number },
): { color: string; width: number } {
  if (flag === 'green') {
    out.color = GREEN_COLOR;
    out.width = 5;
    return out;
  }
  out.color = Math.floor(timeS * 4) % 2 === 0 ? YELLOW_ON : YELLOW_OFF;
  out.width = flag === 'double-yellow' ? 12 : 9;
  return out;
}

export function sectorStyle(flag: SectorFlag, timeS: number): { color: string; width: number } {
  return fillSectorStyle(flag, timeS, { color: GREEN_COLOR, width: 5 });
}

/** Uniform scale to fit points in width×height with `padding` px on each side, centred; north-up. */
export function fitMinimap(
  points: readonly [number, number][],
  width: number,
  height: number,
  padding: number,
): MinimapTransform {
  if (points.length === 0) {
    return { scale: 1, offsetX: width / 2, offsetY: height / 2 };
  }
  let minX = points[0][0];
  let maxX = minX;
  let minZ = points[0][1];
  let maxZ = minZ;
  for (let i = 1; i < points.length; i++) {
    const x = points[i][0];
    const z = points[i][1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const extentX = maxX - minX;
  const extentZ = maxZ - minZ;
  const availW = Math.max(width - padding * 2, 0);
  const availH = Math.max(height - padding * 2, 0);
  let scale = 1;
  if (points.length > 1 && (extentX > 0 || extentZ > 0)) {
    const scaleX = extentX > 0 ? availW / extentX : Infinity;
    const scaleZ = extentZ > 0 ? availH / extentZ : Infinity;
    const fit = Math.min(scaleX, scaleZ);
    if (Number.isFinite(fit) && fit > 0) scale = fit;
  }
  const offsetX = padding + (availW - extentX * scale) / 2 - minX * scale;
  const offsetY = padding + (availH - extentZ * scale) / 2 - minZ * scale;
  return { scale, offsetX, offsetY };
}

/** px x = worldX*scale + offsetX ; px y = worldZ*scale + offsetY (−Z world maps to smaller y, i.e. up). */
export function toMinimap(
  t: MinimapTransform,
  worldX: number,
  worldZ: number,
  out: { x: number; y: number },
): { x: number; y: number } {
  out.x = worldX * t.scale + t.offsetX;
  out.y = worldZ * t.scale + t.offsetY;
  return out;
}

const PAD = 8;
const DOT_RADIUS = 4;
const BG = 'rgba(0, 0, 0, 0.55)';
const DOT_COLOR = '#e02020';
const LINE_COLOR = '#ffffff';
const START_HALF = 8;
const AI_COLOR = '#9aa4b2';
const AI_RADIUS = 7;
const STOPPED_COLOR = '#ff3b30';
const PLAYER_COLOR = '#2f7dff';
const CAR_RADIUS = 10;
const CROSS_HALF = 5;
const GREEN_COLOR = '#e8edf3';
const YELLOW_ON = '#ffd400';
const YELLOW_OFF = '#a08600';

export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly layer: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly transform: MinimapTransform;
  private readonly size: number;
  private readonly dot = { x: 0, y: 0 };
  private readonly centerline: readonly [number, number][];
  private sectorPx: number[][] | null = null;
  private startPx: number[] | null = null;
  /** Offscreen background + sector strokes + start line (302): lazy, race mode only. */
  private sectorLayer: HTMLCanvasElement | null = null;
  private sectorCtx: CanvasRenderingContext2D | null = null;
  private readonly sectorColors: string[] = ['', '', ''];
  private readonly sectorWidths = [0, 0, 0];
  private sectorCacheN = -1;
  private readonly styleTmp = { color: GREEN_COLOR, width: 5 };
  /** Counts from the last updateRace (debug hook 302). */
  readonly stats = { size: 0, ai: 0, player: 0, stopped: 0 };

  constructor(container: HTMLElement, centerline: readonly [number, number][], size = 160) {
    const ownerDoc = container.ownerDocument;
    this.size = size;
    this.centerline = centerline;
    this.stats.size = size;
    this.transform = fitMinimap(centerline, size, size, PAD);

    this.canvas = ownerDoc.createElement('canvas');
    this.canvas.width = size;
    this.canvas.height = size;
    this.canvas.className = 'minimap';
    ownerDoc.documentElement?.style?.setProperty('--minimap-size', `${size}px`);
    container.appendChild(this.canvas);

    this.layer = ownerDoc.createElement('canvas');
    this.layer.width = size;
    this.layer.height = size;

    const ctx = this.canvas.getContext('2d');
    const layerCtx = this.layer.getContext('2d');
    if (!ctx || !layerCtx) throw new Error('minimap: 2d context unavailable');
    this.ctx = ctx;

    this.drawTrack(layerCtx, centerline);
    this.paint();
  }

  private drawTrack(ctx: CanvasRenderingContext2D, centerline: readonly [number, number][]): void {
    const t = this.transform;
    ctx.lineWidth = 3;
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (centerline.length > 0) {
      const out = { x: 0, y: 0 };
      ctx.beginPath();
      const p0 = toMinimap(t, centerline[0][0], centerline[0][1], out);
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < centerline.length; i++) {
        const p = toMinimap(t, centerline[i][0], centerline[i][1], out);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
    if (centerline.length > 1) {
      const dx = (centerline[1][0] - centerline[0][0]) * t.scale;
      const dz = (centerline[1][1] - centerline[0][1]) * t.scale;
      const len = Math.hypot(dx, dz);
      if (len > 0) {
        const s = toMinimap(t, centerline[0][0], centerline[0][1], { x: 0, y: 0 });
        const px = -dz / len;
        const py = dx / len;
        ctx.beginPath();
        ctx.moveTo(s.x - px * START_HALF, s.y - py * START_HALF);
        ctx.lineTo(s.x + px * START_HALF, s.y + py * START_HALF);
        ctx.stroke();
      }
    }
  }

  private paint(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.size, this.size);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, this.size, this.size);
    ctx.drawImage(this.layer, 0, 0);
  }

  /** Sector polylines and the start line in screen px, computed once on first updateRace. */
  private prepareRace(): void {
    if (this.sectorPx !== null) return;
    const layer = this.canvas.ownerDocument.createElement('canvas');
    layer.width = this.size;
    layer.height = this.size;
    const sctx = layer.getContext('2d');
    if (!sctx) throw new Error('minimap: 2d context unavailable');
    this.sectorLayer = layer;
    this.sectorCtx = sctx;
    const out: number[][] = [];
    const pt = { x: 0, y: 0 };
    for (const poly of splitSectors(this.centerline, [1 / 3, 2 / 3])) {
      const flat = new Array<number>(poly.length * 2);
      for (let i = 0; i < poly.length; i++) {
        toMinimap(this.transform, poly[i][0], poly[i][1], pt);
        flat[2 * i] = pt.x;
        flat[2 * i + 1] = pt.y;
      }
      out.push(flat);
    }
    this.sectorPx = out;
    this.startPx = [0, 0, 0, 0];
    if (this.centerline.length > 1) {
      const a = toMinimap(this.transform, this.centerline[0][0], this.centerline[0][1], { x: 0, y: 0 });
      const b = toMinimap(this.transform, this.centerline[1][0], this.centerline[1][1], { x: 0, y: 0 });
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len > 0) {
        const px = -dy / len;
        const py = dx / len;
        this.startPx = [
          a.x - px * START_HALF, a.y - py * START_HALF,
          a.x + px * START_HALF, a.y + py * START_HALF,
        ];
      }
    }
  }

  update(carX: number, carZ: number): void {
    this.paint();
    toMinimap(this.transform, carX, carZ, this.dot);
    const ctx = this.ctx;
    ctx.fillStyle = DOT_COLOR;
    ctx.beginPath();
    ctx.arc(this.dot.x, this.dot.y, DOT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Repaints the offscreen sector layer only when a sector's style changes (302 perf). */
  private syncSectorLayer(
    sectors: number[][],
    start: number[],
    flags: readonly SectorFlag[],
    timeS: number,
  ): void {
    const nSec = Math.min(3, flags.length, sectors.length);
    let changed = nSec !== this.sectorCacheN;
    for (let s = 0; s < nSec && !changed; s++) {
      fillSectorStyle(flags[s], timeS, this.styleTmp);
      changed = this.sectorColors[s] !== this.styleTmp.color || this.sectorWidths[s] !== this.styleTmp.width;
    }
    if (!changed) return;
    const sctx = this.sectorCtx;
    if (sctx === null) return;
    sctx.clearRect(0, 0, this.size, this.size);
    sctx.fillStyle = BG;
    sctx.fillRect(0, 0, this.size, this.size);
    sctx.lineJoin = 'round';
    sctx.lineCap = 'round';
    for (let s = 0; s < nSec; s++) {
      fillSectorStyle(flags[s], timeS, this.styleTmp);
      this.sectorColors[s] = this.styleTmp.color;
      this.sectorWidths[s] = this.styleTmp.width;
      const pts = sectors[s];
      sctx.lineWidth = this.styleTmp.width;
      sctx.strokeStyle = this.styleTmp.color;
      sctx.beginPath();
      sctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) sctx.lineTo(pts[i], pts[i + 1]);
      sctx.stroke();
    }
    this.sectorCacheN = nSec;
    sctx.lineWidth = 3;
    sctx.strokeStyle = LINE_COLOR;
    sctx.beginPath();
    sctx.moveTo(start[0], start[1]);
    sctx.lineTo(start[2], start[3]);
    sctx.stroke();
  }

  /** Race mode: sector polylines coloured by flag, then every car. No allocations per call. */
  updateRace(cars: readonly MinimapCar[], flags: readonly SectorFlag[], timeS: number): void {
    this.prepareRace();
    const sectors = this.sectorPx;
    const start = this.startPx;
    const layer = this.sectorLayer;
    if (sectors === null || start === null || layer === null) return;
    this.syncSectorLayer(sectors, start, flags, timeS);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.size, this.size);
    ctx.drawImage(layer, 0, 0);
    let ai = 0;
    let player = 0;
    let stopped = 0;
    const out = this.dot;
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < cars.length; i++) {
        const c = cars[i];
        if (pass === 0) {
          if (c.player || c.stopped) continue;
          ai++;
        } else if (pass === 1) {
          if (c.player || !c.stopped) continue;
          stopped++;
        } else {
          if (!c.player) continue;
          player++;
          if (c.stopped) stopped++;
        }
        toMinimap(this.transform, c.x, c.z, out);
        ctx.beginPath();
        if (pass === 0) {
          ctx.fillStyle = AI_COLOR;
          ctx.arc(out.x, out.y, AI_RADIUS, 0, Math.PI * 2);
          ctx.fill();
        } else if (pass === 1) {
          ctx.fillStyle = STOPPED_COLOR;
          ctx.arc(out.x, out.y, CAR_RADIUS, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = LINE_COLOR;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(out.x - CROSS_HALF, out.y - CROSS_HALF);
          ctx.lineTo(out.x + CROSS_HALF, out.y + CROSS_HALF);
          ctx.moveTo(out.x + CROSS_HALF, out.y - CROSS_HALF);
          ctx.lineTo(out.x - CROSS_HALF, out.y + CROSS_HALF);
          ctx.stroke();
        } else {
          ctx.fillStyle = PLAYER_COLOR;
          ctx.arc(out.x, out.y, CAR_RADIUS, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = LINE_COLOR;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(out.x, out.y, CAR_RADIUS, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
    this.stats.ai = ai;
    this.stats.player = player;
    this.stats.stopped = stopped;
  }

  dispose(): void {
    this.canvas.remove();
    this.canvas.width = 0;
    this.canvas.height = 0;
    this.layer.width = 0;
    this.layer.height = 0;
    if (this.sectorLayer !== null) {
      this.sectorLayer.width = 0;
      this.sectorLayer.height = 0;
    }
  }
}
