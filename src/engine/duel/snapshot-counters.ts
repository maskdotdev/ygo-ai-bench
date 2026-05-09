export function assertSnapshotCounterRecord(record: unknown, path: string): void {
  if (!isRecord(record)) throw new Error(`Malformed duel snapshot: ${path} must be an object`);
  for (const [key, value] of Object.entries(record)) {
    if (!/^\d+$/.test(key)) throw new Error(`Malformed duel snapshot: ${path} must use numeric keys`);
    assertSnapshotNonNegativeInteger(value, `${path}.${key}`);
  }
}

export function assertSnapshotCounterBuckets(record: unknown, path: string): void {
  if (!isRecord(record)) throw new Error(`Malformed duel snapshot: ${path} must be an object`);
  for (const [key, value] of Object.entries(record)) {
    if (!/^\d+$/.test(key)) throw new Error(`Malformed duel snapshot: ${path} must use numeric keys`);
    if (!isRecord(value)) throw new Error(`Malformed duel snapshot: ${path}.${key} must be an object`);
    if (value.permanent !== undefined) assertSnapshotNonNegativeInteger(value.permanent, `${path}.${key}.permanent`);
    if (value.resetWhileNegated !== undefined) assertSnapshotNonNegativeInteger(value.resetWhileNegated, `${path}.${key}.resetWhileNegated`);
  }
}

function assertSnapshotNonNegativeInteger(value: unknown, path: string): void {
  if (typeof value !== "number") throw new Error(`Malformed duel snapshot: ${path} must be a number`);
  if (!Number.isInteger(value) || value < 0) throw new Error(`Malformed duel snapshot: ${path} must be a non-negative integer`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
