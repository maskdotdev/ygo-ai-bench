export function uniqueUids(uids: string[]): string[] {
  return [...new Set(uids)];
}

export function selectGroupUids(uids: string[], min: number, max: number): string[] {
  const boundedMin = Math.max(0, min);
  if (uids.length < boundedMin) return [];
  const limit = max > 0 ? Math.max(boundedMin, max) : uids.length;
  return uids.slice(0, limit);
}

export function sameUidSet(a: string[], b: string[]): boolean {
  const uniqueA = uniqueUids(a);
  const uniqueB = uniqueUids(b);
  return uniqueA.length === uniqueB.length && uniqueA.every((uid) => uniqueB.includes(uid));
}
