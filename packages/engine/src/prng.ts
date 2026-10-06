import type { PrngState } from './types';

function fnv1aHash(str: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function splitMix32(state: number): { value: number; next: number } {
  const next = (state + 0x9e3779b9) >>> 0;
  let z = next;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
  z = (z ^ (z >>> 16)) >>> 0;
  return { value: z, next };
}

/**
 * Initializes a deterministic 128-bit PRNG state from a seed string
 * (e.g. 64-char hex string from crypto.randomBytes(32) on the server).
 */
export function createPrngState(seed: string): PrngState {
  if (!seed || seed.trim().length === 0) {
    throw new Error('Seed must be a non-empty string');
  }
  const normalized = seed.trim();
  const h0 = fnv1aHash(normalized, 0x811c9dc5);
  const h1 = fnv1aHash(normalized + ':1', h0 ^ 0x9e3779b9);
  const h2 = fnv1aHash(normalized + ':2', h1 ^ 0x85ebca6b);
  const h3 = fnv1aHash(normalized + ':3', h2 ^ 0xc2b2ae35);

  const sm0 = splitMix32(h0);
  const sm1 = splitMix32(h1 ^ sm0.next);
  const sm2 = splitMix32(h2 ^ sm1.next);
  const sm3 = splitMix32(h3 ^ sm2.next);

  // Ensure state is never all zeros
  const s0 = sm0.value || 0x12345678;
  const s1 = sm1.value || 0x23456789;
  const s2 = sm2.value || 0x3456789a;
  const s3 = sm3.value || 0x456789ab;

  return { s0, s1, s2, s3 };
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/**
 * Pure xoshiro128** step returning a 32-bit unsigned integer and the next PRNG state.
 */
export function nextUint32(state: PrngState): { value: number; prngState: PrngState } {
  const result = Math.imul(rotl(Math.imul(state.s1, 5) >>> 0, 7), 9) >>> 0;
  const t = (state.s1 << 9) >>> 0;

  let s0 = state.s0;
  let s1 = state.s1;
  let s2 = (state.s2 ^ s0) >>> 0;
  let s3 = (state.s3 ^ s1) >>> 0;
  s1 = (s1 ^ s2) >>> 0;
  s0 = (s0 ^ s3) >>> 0;
  s2 = (s2 ^ t) >>> 0;
  s3 = rotl(s3, 11);

  return {
    value: result,
    prngState: { s0, s1, s2, s3 },
  };
}

/**
 * Returns an unbiased integer in [0, maxExclusive - 1] using rejection sampling.
 */
export function nextInt(
  state: PrngState,
  maxExclusive: number
): { value: number; prngState: PrngState } {
  if (maxExclusive <= 1) {
    return { value: 0, prngState: state };
  }
  const bound = maxExclusive >>> 0;
  const threshold = (0x100000000 - bound) % bound;
  let current = state;

  while (true) {
    const step = nextUint32(current);
    current = step.prngState;
    if (step.value >= threshold) {
      return {
        value: step.value % bound,
        prngState: current,
      };
    }
  }
}

/**
 * Pure Fisher-Yates shuffle using the seeded PRNG state.
 * Never mutates the input array.
 */
export function fisherYatesShuffle<T>(
  items: readonly T[],
  prngState: PrngState
): { shuffled: T[]; prngState: PrngState } {
  const result = items.slice();
  let currentPrng = prngState;

  for (let i = result.length - 1; i > 0; i--) {
    const step = nextInt(currentPrng, i + 1);
    currentPrng = step.prngState;
    const j = step.value;
    const temp = result[i]!;
    result[i] = result[j]!;
    result[j] = temp;
  }

  return {
    shuffled: result,
    prngState: currentPrng,
  };
}
