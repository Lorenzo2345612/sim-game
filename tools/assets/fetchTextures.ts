import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

interface TextureSet {
  surface: string;
  id: string;
}

const SETS: TextureSet[] = [
  { surface: 'asphalt', id: 'Asphalt010' },
  { surface: 'grass', id: 'Grass005' },
  { surface: 'gravel', id: 'Gravel041' },
  { surface: 'concrete', id: 'Concrete030' },
  { surface: 'metal', id: 'Metal032' },
];

// Zip member suffixes and their target names
const CHANNELS = [
  { suffix: 'Color', out: 'color.jpg' },
  { suffix: 'NormalGL', out: 'normal.jpg' },
  { suffix: 'Roughness', out: 'roughness.jpg' },
];

async function downloadSet({ surface, id }: TextureSet): Promise<void> {
  const outDir = join('public/textures', surface);
  const missing = CHANNELS.map((c) => join(outDir, c.out)).filter((p) => !existsSync(p));
  if (missing.length === 0) {
    console.log(`${id}: files exist, skipping`);
    return;
  }
  const url = `https://ambientcg.com/get?file=${id}_1K-JPG.zip`;
  const res = await fetch(url, { redirect: 'follow' });
  if (res.status !== 200) {
    throw new Error(`${id}: HTTP ${res.status} for ${url}`);
  }
  const work = mkdtempSync(join(tmpdir(), 'fetchTextures-'));
  try {
    const zipPath = join(work, `${id}.zip`);
    writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
    const zipDir = join(work, 'unpacked');
    execFileSync('unzip', ['-o', zipPath, '-d', zipDir]);
    mkdirSync(outDir, { recursive: true });
    for (const { suffix, out } of CHANNELS) {
      const src = join(zipDir, `${id}_1K-JPG_${suffix}.jpg`);
      if (!existsSync(src)) {
        throw new Error(`${id}: ${id}_1K-JPG_${suffix}.jpg missing in zip`);
      }
      copyFileSync(src, join(outDir, out));
    }
    console.log(`${id}: wrote 3 files -> ${outDir}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  for (const set of SETS) {
    await downloadSet(set);
  }
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entry) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
