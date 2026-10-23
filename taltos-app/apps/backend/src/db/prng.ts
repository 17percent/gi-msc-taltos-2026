/** Determinisztikus PRNG (mulberry32): ugyanaz a seed mindig ugyanazt a korpuszt adja (a prototípus seedGenerator.js-éből). */
export interface Rng {
  next(): number;
  int(n: number): number;
  between(min: number, max: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
  pickN<T>(items: readonly T[], n: number): T[];
  /** Determinisztikus, v4 formátumú UUID (az alkalmazás generál azonosítót, a seed ezt utánozza). */
  uuid(): string;
}

export function makeRng(seed: number): Rng {
  let state = seed >>> 0 || 1;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number): number => Math.floor(next() * n);
  const shuffle = <T>(items: readonly T[]): T[] => {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = int(i + 1);
      [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
    }
    return copy;
  };
  const hex = (): string =>
    Array.from({ length: 16 }, () => int(256).toString(16).padStart(2, '0')).join('');
  return {
    next,
    int,
    between: (min, max) => min + int(max - min + 1),
    chance: (p) => next() < p,
    pick: (items) => items[int(items.length)] as (typeof items)[number],
    shuffle,
    pickN: (items, n) => shuffle(items).slice(0, n),
    uuid: () => {
      const h = hex();
      const variant = (8 + int(4)).toString(16);
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
    },
  };
}
