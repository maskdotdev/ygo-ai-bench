export function createRng(seed: string | number = Date.now()): () => number {
  let value = Number(seed);
  if (!Number.isFinite(value)) {
    value = String(seed).split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  }
  value = Math.abs(Math.floor(value)) || 1;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

export function shuffle<T>(items: T[], seed: string | number): T[] {
  const rng = createRng(seed);
  const copy = items.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap] as T, copy[index] as T];
  }
  return copy;
}
