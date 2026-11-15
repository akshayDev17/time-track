/**
 * The public page's sample graphs: fixed made-up days, the same on every load (the board's
 * own seeded generator), one row of 30 days per demo timer, `null` for a day left out.
 */

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const MEANS = [95, 60, 40, 25, 70, 30, 50, 20, 45, 35];

export const SAMPLE_DAYS: (number | null)[][] = (() => {
  const r = rng(hash('public-sample'));
  return MEANS.map((m) => Array.from({ length: 30 }, () => (r() < 0.18 ? null : Math.round(m * (0.35 + r() * 1.3)))));
})();
