// Centred rank normalisation for multi-track fitness: rank within the population -> [-0.5, 0.5] (ties share the mean rank).
export function centeredRanks(values: ArrayLike<number>): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(0);
  if (n < 2) return out;
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => values[a] - values[b]);
  for (let i = 0; i < n; ) {
    let j = i;
    while (j + 1 < n && values[idx[j + 1]] === values[idx[i]]) j++;
    const r = (i + j) / 2 / (n - 1) - 0.5;
    for (let k = i; k <= j; k++) out[idx[k]] = r;
    i = j + 1;
  }
  return out;
}

// Sum of per-track centred ranks: long or slow tracks cannot dominate the selection.
export function rankSumFitness(perTrack: ArrayLike<number>[]): number[] {
  const n = perTrack[0].length;
  const sum = new Array<number>(n).fill(0);
  for (const f of perTrack) centeredRanks(f).forEach((r, i) => { sum[i] += r; });
  return sum;
}
