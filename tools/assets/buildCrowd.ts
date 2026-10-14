import { createServer, type Server } from 'node:http';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE_DIR = join(ROOT, 'assets', 'source', 'crowd');
const OUT_DIR = join(ROOT, 'public', 'textures', 'crowd');
const CELL = 128;
const GRID = 8;
const ATLAS_SIZE = GRID * CELL;
const MIN_FILLED_CELLS = 48;
const MAX_MEAN_SATURATION = 0.35;
// Same launch flags as scripts/review/lib.mjs (SwiftShader, deterministic raster).
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'];

interface BakeOutput {
  atlasBase64: string;
  cells: boolean[];
  meanSaturation: number;
}

const PAGE_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<script type="importmap">
{
  "imports": {
    "three": "/vendor/three/build/three.module.js",
    "three/addons/": "/vendor/three/examples/jsm/"
  }
}
</script>
</head>
<body>
<script type="module" src="/app.js"></script>
</body>
</html>
`;

const PAGE_JS = `
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const CELL = 128;
const GRID = 8;
const ATLAS_SIZE = GRID * CELL;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Luminance copy of a glTF map: the clothing tint supplies the colour, the map the detail.
function lumaMap(source) {
  const image = source.image;
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const v = 115 + 0.55 * (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]);
    px[i] = v;
    px[i + 1] = v;
    px[i + 2] = v;
  }
  ctx.putImageData(data, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

function meshMaterials(obj) {
  if (!obj.isMesh) return [];
  return Array.isArray(obj.material) ? obj.material : [obj.material];
}

function prepareModel(model) {
  model.traverse(function (obj) {
    if (obj.isMesh) obj.frustumCulled = false;
    for (const material of meshMaterials(obj)) {
      if (material.map) {
        material.map = lumaMap(material.map);
        material.needsUpdate = true;
      }
    }
  });
}

function applyTint(model, tint) {
  model.traverse(function (obj) {
    for (const material of meshMaterials(obj)) {
      if (material.color) material.color.copy(tint);
    }
  });
}

function frameCamera(camera, box) {
  const height = box.max.y - box.min.y;
  const width = box.max.x - box.min.x;
  const bottom = box.min.y + 0.45 * height;
  const top = box.max.y + 0.05 * height;
  let size = top - bottom;
  if (width * 1.15 > size) size = width * 1.15;
  const cx = (box.min.x + box.max.x) / 2;
  const cy = (bottom + top) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  // Frustum extents are camera-space; the camera sits on (cx, cy) looking down -Z.
  camera.left = -size / 2;
  camera.right = size / 2;
  camera.top = size / 2;
  camera.bottom = -size / 2;
  camera.position.set(cx, cy, cz + 5);
  camera.lookAt(cx, cy, cz);
  camera.updateProjectionMatrix();
}

function toBase64(bytes) {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

async function main() {
  const config = await (await fetch('/config.json')).json();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(CELL, CELL, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x909090, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(1.2, 2.2, 3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.55);
  fill.position.set(-2.5, 0.8, 1.2);
  scene.add(fill);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 20);
  const loader = new GLTFLoader();
  const bases = [];
  for (const name of config.files) {
    const gltf = await loader.loadAsync('/glb/' + name);
    const model = gltf.scene;
    prepareModel(model);
    model.updateMatrixWorld(true);
    bases.push({ model: model, box: new THREE.Box3().setFromObject(model) });
  }

  const atlas = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4);
  const cells = [];
  const cellPixels = new Uint8Array(CELL * CELL * 4);
  const gl = renderer.getContext();
  let satSum = 0;
  let satCount = 0;

  for (let i = 0; i < GRID * GRID; i++) {
    const base = bases[i % bases.length];
    const variant = Math.floor(i / bases.length);
    const rng = mulberry32(i);
    const tint = new THREE.Color().setHSL(rng(), rng() * 0.3, 0.5 + rng() * 0.2);
    applyTint(base.model, tint);
    scene.add(base.model);
    frameCamera(camera, base.box);
    renderer.render(scene, camera);
    gl.readPixels(0, 0, CELL, CELL, gl.RGBA, gl.UNSIGNED_BYTE, cellPixels);
    scene.remove(base.model);

    const mirror = variant % 2 === 1;
    const col = i % GRID;
    const row = Math.floor(i / GRID);
    let filled = false;
    for (let y = 0; y < CELL; y++) {
      const srcY = CELL - 1 - y;
      for (let x = 0; x < CELL; x++) {
        const s = (srcY * CELL + (mirror ? CELL - 1 - x : x)) * 4;
        const d = ((row * CELL + y) * ATLAS_SIZE + (col * CELL + x)) * 4;
        atlas[d] = cellPixels[s];
        atlas[d + 1] = cellPixels[s + 1];
        atlas[d + 2] = cellPixels[s + 2];
        atlas[d + 3] = cellPixels[s + 3];
        if (cellPixels[s + 3] > 0) {
          filled = true;
          const r = cellPixels[s] / 255;
          const g = cellPixels[s + 1] / 255;
          const b = cellPixels[s + 2] / 255;
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          satSum += max <= 0 ? 0 : (max - min) / max;
          satCount += 1;
        }
      }
    }
    cells.push(filled);
  }

  window.__CROWD_BAKE__ = {
    atlasBase64: toBase64(atlas),
    cells: cells,
    meanSaturation: satCount > 0 ? satSum / satCount : 0,
  };
}

main().catch(function (err) {
  window.__CROWD_BAKE__ = { error: String((err && err.message) || err) };
});
`;

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function parseBakeOutput(value: unknown): BakeOutput {
  if (typeof value !== 'object' || value === null) throw new Error('crowd bake produced no result');
  const result = value as Record<string, unknown>;
  if (typeof result.error === 'string') throw new Error(`crowd bake failed: ${result.error}`);
  if (typeof result.atlasBase64 !== 'string') throw new Error('crowd bake result missing atlasBase64');
  if (!Array.isArray(result.cells) || result.cells.length !== GRID * GRID) {
    throw new Error('crowd bake result missing cells');
  }
  if (typeof result.meanSaturation !== 'number') throw new Error('crowd bake result missing meanSaturation');
  return {
    atlasBase64: result.atlasBase64,
    cells: result.cells.map((cell) => cell === true),
    meanSaturation: result.meanSaturation,
  };
}

function contentType(path: string): string {
  if (path.endsWith('.js') || path.endsWith('.mjs')) return 'application/javascript';
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

function serve(root: string, urlPath: string, res: (code: number, type: string, body: Buffer) => void): void {
  const target = resolve(root, '.' + urlPath);
  if (target !== root && !target.startsWith(root + sep)) {
    res(403, 'text/plain', Buffer.from('forbidden'));
    return;
  }
  try {
    res(200, contentType(target), readFileSync(target));
  } catch {
    res(404, 'text/plain', Buffer.from('not found'));
  }
}

async function startServer(files: string[]): Promise<{ url: string; close: () => Promise<void> }> {
  const threeDir = join(ROOT, 'node_modules', 'three');
  const server: Server = createServer((req, res) => {
    const urlPath = (req.url ?? '/').split('?')[0];
    const reply = (code: number, type: string, body: Buffer): void => {
      res.writeHead(code, { 'content-type': type });
      res.end(body);
    };
    if (urlPath === '/' || urlPath === '/index.html') {
      reply(200, 'text/html', Buffer.from(PAGE_HTML));
    } else if (urlPath === '/app.js') {
      reply(200, 'application/javascript', Buffer.from(PAGE_JS));
    } else if (urlPath === '/config.json') {
      reply(200, 'application/json', Buffer.from(JSON.stringify({ files })));
    } else if (urlPath.startsWith('/vendor/three/')) {
      serve(threeDir, urlPath.slice('/vendor/three'.length), reply);
    } else if (urlPath.startsWith('/glb/')) {
      const name = urlPath.slice('/glb/'.length);
      if (!files.includes(name)) {
        reply(404, 'text/plain', Buffer.from('not found'));
        return;
      }
      reply(200, 'model/gltf-binary', readFileSync(join(SOURCE_DIR, name)));
    } else {
      reply(404, 'text/plain', Buffer.from('not found'));
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('crowd bake server has no port');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

export async function buildCrowd(): Promise<BakeOutput> {
  const files = readdirSync(SOURCE_DIR)
    .filter((file) => file.endsWith('.glb'))
    .sort();
  if (files.length === 0) throw new Error(`no character glbs in ${SOURCE_DIR}`);
  const server = await startServer(files);
  const browser = await chromium.launch({ headless: true, args: ARGS });
  try {
    const page = await browser.newPage({ viewport: { width: 256, height: 256 }, deviceScaleFactor: 1 });
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(message.text());
    });
    await page.goto(server.url);
    try {
      await page.waitForFunction(
        () => (window as unknown as { __CROWD_BAKE__?: unknown }).__CROWD_BAKE__ !== undefined,
        undefined,
        { timeout: 300000 },
      );
    } catch (err) {
      throw new Error(`crowd bake page did not finish: ${pageErrors.join(' | ') || String(err)}`, {
        cause: err,
      });
    }
    const result = parseBakeOutput(await page.evaluate(() => (window as unknown as { __CROWD_BAKE__?: unknown }).__CROWD_BAKE__));
    await page.close();
    return result;
  } finally {
    await browser.close();
    await server.close();
  }
}

export function writeCrowdAtlas(result: BakeOutput): void {
  const atlas = Buffer.from(result.atlasBase64, 'base64');
  const expected = ATLAS_SIZE * ATLAS_SIZE * 4;
  if (atlas.length !== expected) throw new Error(`atlas is ${atlas.length} bytes, expected ${expected}`);
  const filled = result.cells.filter(Boolean).length;
  if (filled < MIN_FILLED_CELLS) throw new Error(`only ${filled} non-empty cells, need ${MIN_FILLED_CELLS}`);
  if (!(result.meanSaturation < MAX_MEAN_SATURATION)) {
    throw new Error(`mean saturation ${result.meanSaturation} is not below ${MAX_MEAN_SATURATION}`);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'atlas.png'), encodePng(ATLAS_SIZE, ATLAS_SIZE, atlas));
  writeFileSync(
    join(OUT_DIR, 'atlas.json'),
    `${JSON.stringify({ cells: result.cells, meanSaturation: result.meanSaturation }, null, 2)}\n`,
  );
  console.log(
    `wrote public/textures/crowd/atlas.png (${ATLAS_SIZE}x${ATLAS_SIZE}, ${filled} filled cells, mean saturation ${result.meanSaturation.toFixed(4)})`,
  );
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  (async () => {
    writeCrowdAtlas(await buildCrowd());
  })().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
