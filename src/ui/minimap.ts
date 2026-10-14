export interface MinimapTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
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

export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly layer: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly transform: MinimapTransform;
  private readonly size: number;
  private readonly dot = { x: 0, y: 0 };

  constructor(container: HTMLElement, centerline: readonly [number, number][], size = 160) {
    const ownerDoc = container.ownerDocument;
    this.size = size;
    this.transform = fitMinimap(centerline, size, size, PAD);

    this.canvas = ownerDoc.createElement('canvas');
    this.canvas.width = size;
    this.canvas.height = size;
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '12px';
    this.canvas.style.right = '12px';
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;
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

  update(carX: number, carZ: number): void {
    this.paint();
    toMinimap(this.transform, carX, carZ, this.dot);
    const ctx = this.ctx;
    ctx.fillStyle = DOT_COLOR;
    ctx.beginPath();
    ctx.arc(this.dot.x, this.dot.y, DOT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }

  dispose(): void {
    this.canvas.remove();
    this.canvas.width = 0;
    this.canvas.height = 0;
    this.layer.width = 0;
    this.layer.height = 0;
  }
}
