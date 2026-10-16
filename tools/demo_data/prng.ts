// Small seeded random number generator so the same seed always gives the same data.
export interface Rng {
  next(): number // uniform [0,1)
  gauss(): number // standard normal
  range(lo: number, hi: number): number
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0
  const next = () => {
    // mulberry32
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    gauss() {
      let u = 0
      while (u === 0) u = next()
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next())
    },
    range(lo, hi) {
      return lo + (hi - lo) * next()
    },
  }
}
