// Preload: Math.random cycles through FIXED_RANDOM="a,b,c" (worker makeCar draws fuel, compound, wear in that order).
const v = (process.env.FIXED_RANDOM ?? '').split(',').filter(Boolean).map(Number);
if (v.length) { let i = 0; Math.random = () => v[i++ % v.length]; }
