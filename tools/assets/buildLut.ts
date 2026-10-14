import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Warm highlight grade: highlights gain red, lose blue, luma and input green unchanged.
export function generateCubeLut(size = 33): string {
  const lines = [
    '# sim-game colour grade',
    'TITLE "grade"',
    `LUT_3D_SIZE ${size}`,
    'DOMAIN_MIN 0.0 0.0 0.0',
    'DOMAIN_MAX 1.0 1.0 1.0',
  ];
  const denom = size - 1;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const rr = r / denom;
        const gg = g / denom;
        const bb = b / denom;
        const luma = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
        const s = smoothstep(0.5, 1, luma);
        const outR = Math.min(1, Math.max(0, rr + 0.03 * s));
        const outB = Math.min(1, Math.max(0, bb - 0.03 * s));
        lines.push(`${outR.toFixed(6)} ${gg.toFixed(6)} ${outB.toFixed(6)}`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function main(): void {
  const out = join(ROOT, 'public', 'luts', 'grade.cube');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, generateCubeLut());
  console.log('wrote public/luts/grade.cube');
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}
