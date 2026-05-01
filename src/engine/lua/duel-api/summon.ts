import fengari from "fengari";
import {
  isMaterialUsePrevented,
  type ContinuousEffectContextFactory,
  type MaterialUseKind,
} from "#duel/continuous-effects.js";
import {
  applyResponse,
  canSpecialSummonDuelCard,
  fusionSummonDuelCard,
  linkSummonDuelCard,
  ritualSummonDuelCard,
  sendDuelCardToGraveyard,
  specialSummonDuelCard,
  synchroSummonDuelCard,
  moveDuelCard,
  xyzSummonDuelCard,
} from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { normalSummonActions } from "#duel/summon.js";
import { positionFromMask, readCardUid, readGroupUids } from "#lua/api-utils.js";
import { availableMonsterZoneCount } from "#lua/duel-api/location.js";
import { pushGroupTable } from "#lua/group-api.js";
import type { CardPosition, DuelAction, DuelCardInstance, DuelLocation, DuelSession, DuelState, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

type LuaSummonType = "FusionSummon" | "SynchroSummon" | "XyzSummon" | "LinkSummon" | "RitualSummon";
type LuaSummonOrSetAction = Extract<DuelAction, { type: "normalSummon" | "tributeSummon" | "setMonster" }>;

export interface LuaDuelSummonApiHostState {
  operatedUids: string[];
  pendingSpecialSummonUids?: string[];
}

export function installDuelSummonApi(L: unknown, session: DuelSession, hostState: LuaDuelSummonApiHostState): void {
  pushBasicSummonHelper(L, "Summon", session, hostState, "normalSummon");
  pushBasicSummonHelper(L, "MSet", session, hostState, "setMonster");
  pushBasicSummonHelper(L, "SSet", session, hostState, "setSpellTrap");
  lua.lua_pushcfunction(L, (state: unknown) => pushSummonOrSetResult(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("SummonOrSet"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, true);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsSummonCancelable"));
  pushSummonHelper(L, "FusionSummon", session, hostState, "FusionSummon");
  pushSummonHelper(L, "SynchroSummon", session, hostState, "SynchroSummon");
  pushSummonHelper(L, "XyzSummon", session, hostState, "XyzSummon");
  pushSummonHelper(L, "LinkSummon", session, hostState, "LinkSummon");
  pushSummonHelper(L, "RitualSummon", session, hostState, "RitualSummon");
  lua.lua_pushcfunction(L, (state: unknown) => pushRitualMaterial(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetRitualMaterial"));
  lua.lua_pushcfunction(L, (state: unknown) => pushReleaseRitualMaterial(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("ReleaseRitualMaterial"));
  lua.lua_pushcfunction(L, (state: unknown) => pushPendulumSummon(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("PendulumSummon"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSpecialSummonStep(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("SpecialSummonStep"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSpecialSummonComplete(state, hostState));
  lua.lua_setfield(L, -2, to_luastring("SpecialSummonComplete"));
  lua.lua_pushcfunction(L, (state: unknown) => pushNegateSummon(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("NegateSummon"));
}

function pushBasicSummonHelper(L: unknown, fieldName: string, session: DuelSession, hostState: LuaDuelSummonApiHostState, type: "normalSummon" | "setMonster" | "setSpellTrap"): void {
  lua.lua_pushcfunction(L, (state: unknown) => pushBasicSummonResult(state, session, hostState, type));
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function pushSummonHelper(L: unknown, fieldName: string, session: DuelSession, hostState: LuaDuelSummonApiHostState, summonType: LuaSummonType): void {
  lua.lua_pushcfunction(L, (state: unknown) => pushLuaSummonResult(state, session, hostState, summonType));
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function pushSummonOrSetResult(L: unknown, session: DuelSession, hostState: LuaDuelSummonApiHostState): number {
  const player = readOptionalPlayer(L, 1) ?? session.state.turnPlayer;
  const targetUid = readFirstCardOrGroupUid(L, 2);
  const target = targetUid ? session.state.cards.find((candidate) => candidate.uid === targetUid) : undefined;
  if (!target) {
    setOperatedUids(hostState, []);
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const tributeUids = readCardCollectionUids(L, 4);
  const action = selectSummonOrSetAction(session.state, player, target, tributeUids);
  const result = action ? applyResponse(session, action) : { ok: false };
  setOperatedUids(hostState, result.ok ? [target.uid] : []);
  lua.lua_pushinteger(L, result.ok ? 1 : 0);
  return 1;
}

function selectSummonOrSetAction(
  state: DuelState,
  player: PlayerId,
  target: DuelCardInstance,
  tributeUids: string[],
): LuaSummonOrSetAction | undefined {
  const actions = normalSummonActions(state, player, [target]);
  const summon = actions.find((candidate): candidate is LuaSummonOrSetAction => candidate.type === "normalSummon" && candidate.uid === target.uid);
  if (summon) return summon;
  if (tributeUids.length > 0 && actions.some((candidate) => candidate.type === "tributeSummon" && candidate.uid === target.uid)) {
    return { type: "tributeSummon", player, uid: target.uid, tributeUids, label: `Tribute Summon ${target.name}` };
  }
  return actions.find((candidate): candidate is LuaSummonOrSetAction => candidate.type === "setMonster" && candidate.uid === target.uid);
}

function pushBasicSummonResult(L: unknown, session: DuelSession, hostState: LuaDuelSummonApiHostState, type: "normalSummon" | "setMonster" | "setSpellTrap"): number {
  const targetUid = readFirstCardOrGroupUid(L, 1);
  const target = targetUid ? session.state.cards.find((candidate) => candidate.uid === targetUid) : undefined;
  if (!target) {
    setOperatedUids(hostState, []);
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const tributeUids = type === "normalSummon" ? readCardCollectionUids(L, 3) : [];
  const result =
    type === "normalSummon" && tributeUids.length > 0
      ? applyResponse(session, { type: "tributeSummon", player: target.controller, uid: target.uid, tributeUids, label: `Tribute Summon ${target.name}` })
      : applyResponse(session, { type, player: target.controller, uid: target.uid, label: basicSummonLabel(type, target.name) });
  setOperatedUids(hostState, result.ok ? [target.uid] : []);
  lua.lua_pushinteger(L, result.ok ? 1 : 0);
  return 1;
}

function basicSummonLabel(type: "normalSummon" | "setMonster" | "setSpellTrap", name: string): string {
  if (type === "normalSummon") return `Normal Summon ${name}`;
  return `Set ${name}`;
}

function pushLuaSummonResult(L: unknown, session: DuelSession, hostState: LuaDuelSummonApiHostState, summonType: LuaSummonType): number {
  const targetUid = readCardUid(L, 1);
  const materialUids = readCardOrGroupUids(L, 2);
  const target = targetUid ? session.state.cards.find((candidate) => candidate.uid === targetUid) : undefined;
  if (!target) {
    setOperatedUids(hostState, []);
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  try {
    if (summonType === "FusionSummon") fusionSummonDuelCard(session.state, target.controller, target.uid, materialUids);
    else if (summonType === "SynchroSummon") synchroSummonDuelCard(session.state, target.controller, target.uid, materialUids);
    else if (summonType === "XyzSummon") xyzSummonDuelCard(session.state, target.controller, target.uid, materialUids);
    else if (summonType === "LinkSummon") linkSummonDuelCard(session.state, target.controller, target.uid, materialUids);
    else ritualSummonDuelCard(session.state, target.controller, target.uid, materialUids);
    setOperatedUids(hostState, [target.uid]);
    lua.lua_pushinteger(L, 1);
  } catch {
    setOperatedUids(hostState, []);
    lua.lua_pushinteger(L, 0);
  }
  return 1;
}

function pushRitualMaterial(L: unknown, session: DuelSession): number {
  const player = readOptionalPlayer(L, 1) ?? session.state.turnPlayer;
  const targetUid = readCardUid(L, 2);
  const target = targetUid ? session.state.cards.find((candidate) => candidate.uid === targetUid) : undefined;
  pushGroupTable(
    L,
    ritualMaterialCandidates(session.state, player, target).map((card) => card.uid),
  );
  return 1;
}

function pushReleaseRitualMaterial(L: unknown, session: DuelSession, hostState: LuaDuelSummonApiHostState): number {
  const reason = duelReason.release | duelReason.material | duelReason.ritual;
  const moved: string[] = [];
  for (const uid of readCardOrGroupUids(L, 1)) {
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    if (!card) continue;
    try {
      const result = sendDuelCardToGraveyard(session.state, uid, card.controller, reason, session.state.turnPlayer);
      if (result.location === "graveyard") moved.push(uid);
    } catch {
      // EDOPro-style helpers report successful material releases only.
    }
  }
  setOperatedUids(hostState, moved);
  lua.lua_pushinteger(L, moved.length);
  return 1;
}

function pushPendulumSummon(L: unknown, session: DuelSession, hostState: LuaDuelSummonApiHostState): number {
  const player = readOptionalPlayer(L, 1) ?? session.state.turnPlayer;
  const zoneCount = availableMonsterZoneCount(session, player, []);
  const scales = pendulumScales(session, player);
  if (!isMainPhaseForPlayer(session, player) || zoneCount <= 0 || !scales) {
    setOperatedUids(hostState, []);
    lua.lua_pushinteger(L, 0);
    return 1;
  }

  const [lowScale, highScale] = scales;
  const summonedUids: string[] = [];
  for (const card of pendulumSummonCandidates(session, player, lowScale, highScale).slice(0, zoneCount)) {
    try {
      const summoned = specialSummonDuelCard(session.state, card.uid, player);
      applySummonPosition(summoned, "faceUpAttack");
      summonedUids.push(card.uid);
    } catch {
      // EDOPro-style helpers report successful summons only.
    }
  }
  setOperatedUids(hostState, summonedUids);
  lua.lua_pushinteger(L, summonedUids.length);
  return 1;
}

function pushSpecialSummonStep(L: unknown, session: DuelSession, hostState: LuaDuelSummonApiHostState): number {
  const uid = readCardUid(L, 1);
  const target = uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
  const targetPlayer = readOptionalPlayer(L, 4) ?? target?.controller;
  const requestedPosition = lua.lua_isnumber(L, 7) ? positionFromMask(lua.lua_tointeger(L, 7)) : undefined;
  if (!uid || !target || targetPlayer === undefined) {
    lua.lua_pushboolean(L, false);
    return 1;
  }
  try {
    const summoned = specialSummonDuelCard(session.state, uid, targetPlayer);
    if (requestedPosition) applySummonPosition(summoned, requestedPosition);
    hostState.pendingSpecialSummonUids = [...(hostState.pendingSpecialSummonUids ?? []), uid];
    setOperatedUids(hostState, hostState.pendingSpecialSummonUids);
    lua.lua_pushboolean(L, true);
    return 1;
  } catch {
    lua.lua_pushboolean(L, false);
    return 1;
  }
}

function pushSpecialSummonComplete(L: unknown, hostState: LuaDuelSummonApiHostState): number {
  setOperatedUids(hostState, hostState.pendingSpecialSummonUids ?? []);
  hostState.pendingSpecialSummonUids = [];
  return 0;
}

function pushNegateSummon(L: unknown, session: DuelSession, hostState: LuaDuelSummonApiHostState): number {
  const negated: string[] = [];
  for (const uid of readCardOrGroupUids(L, 1)) {
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    if (!card || card.location !== "monsterZone" || card.summonType === undefined) continue;
    try {
      moveDuelCard(session.state, card.uid, "graveyard", card.controller, duelReason.disSummon, session.state.turnPlayer);
      delete card.summonType;
      delete card.summonPlayer;
      negated.push(uid);
    } catch {
      // EDOPro-style helpers report successful negations only.
    }
  }
  setOperatedUids(hostState, negated);
  lua.lua_pushinteger(L, negated.length);
  return 1;
}

function readFirstCardOrGroupUid(L: unknown, index: number): string | undefined {
  return readCardUid(L, index) ?? readGroupUids(L, index)[0];
}

function readCardOrGroupUids(L: unknown, index: number): string[] {
  const cardUid = readCardUid(L, index);
  return cardUid ? [cardUid] : readGroupUids(L, index);
}

function readCardCollectionUids(L: unknown, index: number): string[] {
  const directUids = readCardOrGroupUids(L, index);
  if (directUids.length > 0 || !lua.lua_istable(L, index)) return directUids;
  const count = lua.lua_rawlen(L, index);
  const uids: string[] = [];
  for (let luaIndex = 1; luaIndex <= count; luaIndex += 1) {
    lua.lua_rawgeti(L, index, luaIndex);
    const uid = readCardUid(L, -1);
    if (uid) uids.push(uid);
    lua.lua_pop(L, 1);
  }
  return uids;
}

function readOptionalPlayer(L: unknown, index: number): PlayerId | undefined {
  if (!lua.lua_isnumber(L, index)) return undefined;
  const value = lua.lua_tointeger(L, index);
  if (value !== 0 && value !== 1) return undefined;
  return value;
}

function ritualMaterialCandidates(state: DuelState, player: PlayerId, target: DuelCardInstance | undefined): DuelCardInstance[] {
  return state.cards
    .filter((card) => card.controller === player && canBeRitualMaterial(state, card, target))
    .sort((a, b) => locationSort(a.location) - locationSort(b.location) || a.sequence - b.sequence);
}

function canBeRitualMaterial(state: DuelState, card: DuelCardInstance, target: DuelCardInstance | undefined): boolean {
  return (
    isMonsterLike(card) &&
    (card.location === "hand" || card.location === "monsterZone") &&
    targetAllowsMaterial(target, card, "ritual") &&
    !isMaterialUsePrevented(state, card.uid, "ritual", createMaterialCheckContext(state))
  );
}

function pendulumSummonCandidates(session: DuelSession, player: PlayerId, lowScale: number, highScale: number): DuelCardInstance[] {
  return session.state.cards
    .filter((card) => canPendulumSummonCard(session, player, card, lowScale, highScale))
    .sort((a, b) => locationSort(a.location) - locationSort(b.location) || a.sequence - b.sequence);
}

function canPendulumSummonCard(session: DuelSession, player: PlayerId, card: DuelCardInstance, lowScale: number, highScale: number): boolean {
  if (card.controller !== player || !isPendulumMonster(card)) return false;
  if (card.location !== "hand" && !(card.location === "extraDeck" && card.faceUp)) return false;
  const level = card.data.level ?? 0;
  if (level <= lowScale || level >= highScale) return false;
  return canSpecialSummonDuelCard(session.state, card.uid, player);
}

function pendulumScales(session: DuelSession, player: PlayerId): [number, number] | undefined {
  const left = pendulumZoneCard(session, player, 0);
  const right = pendulumZoneCard(session, player, 1);
  if (!left || !right) return undefined;
  const low = Math.min(pendulumScale(left), pendulumScale(right));
  const high = Math.max(pendulumScale(left), pendulumScale(right));
  return low < high ? [low, high] : undefined;
}

function pendulumZoneCard(session: DuelSession, player: PlayerId, sequence: number): DuelCardInstance | undefined {
  return session.state.cards.find((card) => card.controller === player && card.location === "spellTrapZone" && card.sequence === sequence && isPendulumCard(card));
}

function pendulumScale(card: DuelCardInstance): number {
  return card.data.leftScale ?? card.data.rightScale ?? 0;
}

function targetAllowsMaterial(target: DuelCardInstance | undefined, card: DuelCardInstance, kind: MaterialUseKind): boolean {
  if (!target) return true;
  if (target.uid === card.uid) return false;
  const codes = cardCodes(card);
  if (kind === "ritual") return !target.data.ritualMaterials?.length || target.data.ritualMaterials.some((code) => codes.includes(code));
  return true;
}

function locationSort(location: DuelLocation): number {
  if (location === "hand") return 0;
  if (location === "monsterZone") return 1;
  return 2;
}

function createMaterialCheckContext(state: DuelState): ContinuousEffectContextFactory {
  return (effect, source, card) => ({
    duel: state,
    source,
    player: effect.controller,
    checkOnly: true,
    targetUids: card ? [card.uid] : [],
    log() {},
    moveCard(uid, to, controller) {
      return moveDuelCard(state, uid, to, controller);
    },
    negateChainLink() {
      return false;
    },
    setTargets() {},
    getTargets() {
      return card ? [card] : [];
    },
    setTargetPlayer() {},
    setTargetParam() {},
  });
}

function isMonsterLike(card: DuelCardInstance): boolean {
  return (cardTypeFlags(card) & 0x1) !== 0;
}

function isMainPhaseForPlayer(session: DuelSession, player: PlayerId): boolean {
  return session.state.turnPlayer === player && (session.state.phase === "main1" || session.state.phase === "main2");
}

function isPendulumMonster(card: DuelCardInstance): boolean {
  return isMonsterLike(card) && isPendulumCard(card);
}

function isPendulumCard(card: DuelCardInstance): boolean {
  return ((card.data.typeFlags ?? 0) & 0x1000000) !== 0;
}

function cardTypeFlags(card: DuelCardInstance): number {
  if (card.data.typeFlags !== undefined) return card.data.typeFlags;
  if (card.kind === "spell") return 0x2;
  if (card.kind === "trap") return 0x4;
  return 0x1;
}

function cardCodes(card: DuelCardInstance): string[] {
  return card.data.alias ? [card.code, card.data.alias] : [card.code];
}

function applySummonPosition(card: { position: CardPosition; faceUp: boolean }, position: CardPosition): void {
  card.position = position;
  card.faceUp = position !== "faceDownDefense";
}

function setOperatedUids(hostState: LuaDuelSummonApiHostState, uids: string[]): void {
  hostState.operatedUids.splice(0, hostState.operatedUids.length, ...uids);
}
