import type { DuelState, PlayerId } from "#duel/types.js";

export function copyPendingBattle(pendingBattle: NonNullable<DuelState["pendingBattle"]>): NonNullable<DuelState["pendingBattle"]> {
  return {
    ...copyBattleAttack(pendingBattle),
    ...(pendingBattle.replayPending === undefined ? {} : { replayPending: pendingBattle.replayPending }),
    ...(pendingBattle.battleDamageOverrides === undefined ? {} : { battleDamageOverrides: { ...pendingBattle.battleDamageOverrides } }),
    ...(pendingBattle.resultApplied === undefined ? {} : { resultApplied: pendingBattle.resultApplied }),
    ...(pendingBattle.deferredBattleDestroyed === undefined ? {} : { deferredBattleDestroyed: pendingBattle.deferredBattleDestroyed.map((record) => ({ ...record })) }),
  };
}

export function copyBattleAttack<T extends NonNullable<DuelState["currentAttack"]>>(battle: T): T {
  return {
    ...battle,
    ...(battle.replayTargetUids === undefined ? {} : { replayTargetUids: [...battle.replayTargetUids] }),
  };
}

export function assertSnapshotDeferredBattleDestroyed(records: unknown, path: string, cardUids: ReadonlySet<string>): void {
  if (!Array.isArray(records)) throw new Error(`Malformed duel snapshot: ${path} must be an array`);
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const recordPath = `${path}.${index}`;
    if (!isRecord(record)) throw new Error(`Malformed duel snapshot: ${recordPath} must be an object`);
    for (const key of Object.keys(record)) if (!deferredBattleDestroyedKeys.has(key)) throw new Error(`Malformed duel snapshot: ${recordPath}.${key} is not a known field`);
    if (typeof record.uid !== "string") throw new Error(`Malformed duel snapshot: ${recordPath}.uid must be a string`);
    if (typeof record.reasonCardUid !== "string") throw new Error(`Malformed duel snapshot: ${recordPath}.reasonCardUid must be a string`);
    if (!cardUids.has(record.uid)) throw new Error(`Malformed duel snapshot: ${recordPath}.uid must reference a card`);
    if (!cardUids.has(record.reasonCardUid)) throw new Error(`Malformed duel snapshot: ${recordPath}.reasonCardUid must reference a card`);
    assertSnapshotPlayerId(record.reasonPlayer, `${recordPath}.reasonPlayer`);
  }
}

const deferredBattleDestroyedKeys = new Set(["reasonCardUid", "reasonPlayer", "uid"]);

function assertSnapshotPlayerId(value: unknown, path: string): asserts value is PlayerId {
  if (value !== 0 && value !== 1) throw new Error(`Malformed duel snapshot: ${path} must be a player id`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
