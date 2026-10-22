// Copies the trained difficulty genomes to public/ai-models/ for the in-game neural AI (task 269).
// npx tsx scripts/evolve/export-models.mts  (or: npm run export-ai-models)
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { padGenome } from '../../src/ai/neuralPolicy';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const srcRoot = join(here, 'models');
const outFlag = process.argv.indexOf('--out');
const outRoot =
  outFlag !== -1 && process.argv[outFlag + 1] ? resolve(process.argv[outFlag + 1]) : join(root, 'public/ai-models');
const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'] as const;

interface IndexJson {
  line?: string;
  difficulties?: Record<string, string>;
}

interface GenomeJson {
  gen: number;
  nIn: number;
  line?: string;
  avgLap: number;
  bestLap: number;
  weights: number[];
  setup?: Record<string, number>;
}

// <track>-<car>[-racing|-mintime] source dirs; per track/car the fastest expert wins and its whole set is exported.
const groups = new Map<string, { dir: string; expert: number }[]>();
const dirs = existsSync(srcRoot)
  ? readdirSync(srcRoot).filter((d) => existsSync(join(srcRoot, d, 'index.json')))
  : [];
for (const dir of dirs) {
  const idx = JSON.parse(readFileSync(join(srcRoot, dir, 'index.json'), 'utf8')) as IndexJson;
  const file = idx.difficulties?.expert;
  if (!file) continue;
  const expert = (JSON.parse(readFileSync(join(srcRoot, dir, file), 'utf8')) as GenomeJson).bestLap;
  const key = dir.replace(/-(racing|mintime)$/, '');
  const list = groups.get(key) ?? [];
  list.push({ dir, expert });
  groups.set(key, list);
}

const index: Record<string, string[]> = {};
for (const [key, list] of groups) {
  const { dir } = list.reduce((a, b) => (b.expert < a.expert ? b : a));
  const idx = JSON.parse(readFileSync(join(srcRoot, dir, 'index.json'), 'utf8')) as IndexJson;
  const present: string[] = [];
  const outDir = join(outRoot, key);
  mkdirSync(outDir, { recursive: true });
  let line = 'center';
  for (const difficulty of DIFFICULTIES) {
    const file = idx.difficulties?.[difficulty];
    if (!file) continue;
    const genome = JSON.parse(readFileSync(join(srcRoot, dir, file), 'utf8')) as GenomeJson;
    line = genome.line ?? idx.line ?? 'center';
    const padded = padGenome(genome.weights);
    if (!padded) throw new Error(`Invalid genome length ${genome.weights.length} in ${dir}/${file}`);
    const out = {
      net: 2,
      nIn: genome.nIn,
      line,
      avgLap: genome.avgLap,
      bestLap: genome.bestLap,
      gen: genome.gen,
      weights: Array.from(padded),
      ...(genome.setup ? { setup: genome.setup } : {}),
    };
    writeFileSync(join(outDir, `${difficulty}.json`), JSON.stringify(out));
    present.push(difficulty);
  }
  if (line === 'mintime') {
    copyFileSync(join(here, 'lines', `${key}-mintime.json`), join(outDir, 'line-mintime.json'));
  }
  if (present.length > 0) index[key] = present;
}
mkdirSync(outRoot, { recursive: true });
writeFileSync(join(outRoot, 'index.json'), JSON.stringify(index, null, 1));
const outLabel = outRoot.startsWith(root) ? relative(root, outRoot) : outRoot;
console.log(`exported ${Object.keys(index).length} track-car model set(s) to ${outLabel}`);
