import { uniqueUids } from "#lua/group-uid-utils.js";

export interface WeightedUidEntry {
  uid: string;
  value: number;
}

export function selectedWeightedEntries(entries: WeightedUidEntry[], selectedUids: string[]): WeightedUidEntry[] {
  return uniqueUids(selectedUids)
    .map((uid) => entries.find((entry) => entry.uid === uid))
    .filter((entry): entry is WeightedUidEntry => entry !== undefined);
}

export function findSumSelection(entries: WeightedUidEntry[], target: number, min: number, max: number, index: number, selected: string[], current: number): string[] | undefined {
  if (current === target && selected.length >= min && selected.length <= max) return [...selected];
  if (index >= entries.length || selected.length >= max) return undefined;
  for (let nextIndex = index; nextIndex < entries.length; nextIndex += 1) {
    const entry = entries[nextIndex];
    if (!entry) continue;
    selected.push(entry.uid);
    const found = findSumSelection(entries, target, min, max, nextIndex + 1, selected, current + entry.value);
    if (found) return found;
    selected.pop();
  }
  return undefined;
}

export function findSumGreaterSelection(entries: WeightedUidEntry[], target: number, min: number, max: number, index: number, selected: string[], current: number): string[] | undefined {
  if (current >= target && selected.length >= min && selected.length <= max) return [...selected];
  if (index >= entries.length || selected.length >= max) return undefined;
  for (let nextIndex = index; nextIndex < entries.length; nextIndex += 1) {
    const entry = entries[nextIndex];
    if (!entry) continue;
    selected.push(entry.uid);
    const found = findSumGreaterSelection(entries, target, min, max, nextIndex + 1, selected, current + entry.value);
    if (found) return found;
    selected.pop();
  }
  return undefined;
}

export function findSubGroupSelection(uids: string[], min: number, max: number, predicate: (selected: string[]) => boolean, index: number, selected: string[]): string[] | undefined {
  if (selected.length >= min && selected.length <= max && predicate(selected)) return [...selected];
  if (index >= uids.length || selected.length >= max) return undefined;
  for (let nextIndex = index; nextIndex < uids.length; nextIndex += 1) {
    const uid = uids[nextIndex];
    if (!uid) continue;
    selected.push(uid);
    const found = findSubGroupSelection(uids, min, max, predicate, nextIndex + 1, selected);
    if (found) return found;
    selected.pop();
  }
  return undefined;
}
