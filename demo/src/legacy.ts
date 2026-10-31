// Rounding from the first version, before split.ts did it itself.
export function roundHalfUp(amount: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.floor(amount * factor + 0.5) / factor;
}

export function roundAll(amounts: number[], decimals: number): number[] {
  return amounts.map((a) => roundHalfUp(a, decimals));
}
