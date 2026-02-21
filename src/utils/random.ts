/**
 * Simple seeded PRNG (xoshiro128**).
 * Produces deterministic sequences per seed, but different seeds give different runs.
 * This lets us have variation across tournament runs while keeping individual runs reproducible.
 */
export class SeededRandom {
  private s: Uint32Array;

  constructor(seed: number) {
    // Splitmix32 to initialize state from a single seed
    this.s = new Uint32Array(4);
    for (let i = 0; i < 4; i++) {
      seed += 0x9e3779b9;
      let t = seed;
      t = Math.imul(t ^ (t >>> 16), 0x85ebca6b);
      t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35);
      this.s[i] = (t ^ (t >>> 16)) >>> 0;
    }
  }

  /** Returns a float in [0, 1). */
  next(): number {
    const s = this.s;
    const result = Math.imul(s[1] * 5, 7);
    const t = s[1] << 9;

    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = (s[3] << 11) | (s[3] >>> 21);

    return ((result << 7) | (result >>> 25)) / 4294967296 + 0.5;
  }

  /** Returns a float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Returns a gaussian-ish sample via Box-Muller. */
  gaussian(mean: number, stddev: number): number {
    const u1 = this.next();
    const u2 = this.next();
    const z = Math.sqrt(-2 * Math.log(u1 || 1e-10)) * Math.cos(2 * Math.PI * u2);
    return mean + z * stddev;
  }

  /** Returns true with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Pick a random element from an array. */
  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Shuffle array in place. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}
