import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface CreditEntry {
  asset: string;
  author: string;
  license: string;
  url: string;
}

// Neutral display name: cut at the first " (" or " –" so GT3 rows never expose brand text.
function neutralAssetName(cell: string): string {
  const cut = cell.search(/ \(| –/u);
  return (cut === -1 ? cell : cell.slice(0, cut)).trim();
}

export function parseCredits(markdown: string): CreditEntry[] {
  const entries: CreditEntry[] = [];
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 6) continue;
    const [asset, , author, license, url] = cells;
    if (!license.startsWith('CC-BY')) continue;
    if (!author || !url) throw new Error(`CC-BY row missing author or url: ${asset}`);
    entries.push({ asset: neutralAssetName(asset), author, license, url });
  }
  return entries;
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function main(): void {
  const markdown = readFileSync(join(ROOT, 'ASSETS_LICENSES.md'), 'utf8');
  const entries = parseCredits(markdown);
  writeFileSync(join(ROOT, 'public', 'credits.json'), `${JSON.stringify(entries, null, 2)}\n`);
  console.log(`wrote ${entries.length} credits to public/credits.json`);
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
