const PRIMITIVE = 0x11d;

/**
 * Multiplies two field elements in GF(256). Both operands and the result are
 * bytes (0–255).
 */
export function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    // Multiply `z` by 2, reducing modulo the primitive polynomial.
    z = (z << 1) ^ ((z >>> 7) * PRIMITIVE);
    // Conditionally add `x` when bit `i` of `y` is set.
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}
