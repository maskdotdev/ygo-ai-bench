import { findCard, getCards, moveDuelCard, pushDuelLog, recordPreviousDuelCardState, requireControlledCard } from "#duel/card-state.js";
import { duelActivity, recordFlipSummonActivity, recordNormalSetActivity, recordNormalSummonActivity, recordSpecialSummonActivity } from "#duel/activity.js";
import { markProcedureComplete } from "#duel/procedure-status.js";
import { duelReason } from "#duel/reasons.js";
import { availableForcedMonsterZoneCount, firstOpenForcedMonsterZoneSequence } from "#duel/forced-monster-zones.js";
import { tributeUnitCount } from "#duel/double-tribute.js";
import { canUseFusionSubstitute } from "#duel/fusion-substitute.js";
import { currentCardMatchesCode, currentCardMatchesSetcode, currentLinkMaterialCodes, currentLinkMaterialMatchesSetcode } from "#duel/card-code-state.js";
import { cardTypeFlags, currentAttribute, currentLevel, currentLink, currentRace, currentRank } from "#duel/card-stats.js";
import { hasNormalSummonCountAvailable } from "#duel/extra-normal-summon.js";
import { cardCombinations, materialCodesMatch, selectMaterialUidsForCodes, type MaterialCodeMatchOptions } from "#duel/summon-materials.js";
import { isSummonTypeMaskMatch, summonTypeMaskFromCard } from "#duel/summon-type-codes.js";
import type { CardPosition, DuelAction, DuelCardInstance, DuelEventName, DuelLocation, DuelState, PlayerId } from "#duel/types.js";

const typeGemini = 0x800;
const summonTypeGemini = 0x12000000;

export type DuelEventCollector = (eventName: DuelEventName, eventCard?: DuelCardInstance) => void;
export interface DuelMaterialMoveResult {
  card: DuelCardInstance;
  collectedSentToGraveyard?: boolean;
}
export type DuelMaterialMover = (uid: string, controller: PlayerId, reason: number, targetUid?: string) => DuelMaterialMoveResult;
export type DuelOverlayMaterialMover = (uid: string, controller: PlayerId, reason: number, targetUid?: string) => DuelCardInstance;
export type DuelMaterialPredicate = (uid: string, targetUid?: string) => boolean;
export type DuelNormalSummonPredicate = (card: DuelCardInstance) => boolean;
type ExtraDeckSummonType = "fusion" | "synchro" | "Xyz" | "Link";
type SynchroMaterialCodes = { tuner: string; nonTuners: string[] };

export function normalSummon(state: DuelState, player: PlayerId, uid: string, collectEvent: DuelEventCollector, canSummonWithoutTribute: DuelNormalSummonPredicate = () => false, canUseNormalSummonCount: DuelNormalSummonPredicate = (card) => hasNormalSummonCountAvailable(state, player, card)): void {
  const fieldCard = findCard(state, uid);
  if (fieldCard?.location === "monsterZone") {
    geminiNormalSummon(state, player, fieldCard, collectEvent, canUseNormalSummonCount);
    return;
  }
  const card = requireControlledCard(state, player, uid, "hand");
  if (card.kind !== "monster") throw new Error(`${card.name} is not a monster`);
  if (tributeRangeForNormalSummon(card).min > 0 && !canSummonWithoutTribute(card)) throw new Error(`${card.name} requires a Tribute Summon`);
  if (!canUseNormalSummonCount(card)) throw new Error("Normal Summon is not available");
  const sequence = requireForcedMonsterZoneSequence(state, player, duelReason.summon, card);
  collectEvent("normalSummoning", card);
  moveDuelCard(state, uid, "monsterZone", player, duelReason.summon);
  card.sequence = sequence;
  card.position = "faceUpAttack";
  card.summonType = "normal";
  card.summonPlayer = player;
  card.summonPhase = state.phase;
  card.summonMaterialUids = [];
  markProcedureComplete(card);
  state.players[player].normalSummonAvailable = false;
  recordNormalSummonActivity(state, player, card);
  pushDuelLog(state, "normalSummon", player, card.name, "Normal Summoned from hand");
  collectEvent("normalSummoned", card);
}

function geminiNormalSummon(state: DuelState, player: PlayerId, card: DuelCardInstance, collectEvent: DuelEventCollector, canUseNormalSummonCount: DuelNormalSummonPredicate): void {
  if (!canGeminiNormalSummonDuelCard(state, player, card, canUseNormalSummonCount)) throw new Error(`${card.name} cannot be Gemini Summoned`);
  recordPreviousDuelCardState(state, card);
  collectEvent("normalSummoning", card);
  card.summonType = "normal";
  card.summonTypeCode = summonTypeGemini;
  card.summonPlayer = player;
  card.summonPhase = state.phase;
  card.summonMaterialUids = [];
  markProcedureComplete(card);
  state.players[player].normalSummonAvailable = false;
  recordNormalSummonActivity(state, player, card);
  pushDuelLog(state, "normalSummon", player, card.name, "Gemini Summoned on the field");
  collectEvent("normalSummoned", card);
}

export function setMonster(state: DuelState, player: PlayerId, uid: string, collectEvent?: DuelEventCollector, canUseNormalSummonCount: DuelNormalSummonPredicate = (card) => hasNormalSummonCountAvailable(state, player, card)): void {
  const card = requireControlledCard(state, player, uid, "hand");
  if (card.kind !== "monster") throw new Error(`${card.name} is not a monster`);
  if (tributeRangeForNormalSummon(card).min > 0) throw new Error(`${card.name} requires tributes to Set`);
  if (!canUseNormalSummonCount(card)) throw new Error("Normal Summon is not available");
  const sequence = requireForcedMonsterZoneSequence(state, player, duelReason.rule, card);
  moveDuelCard(state, uid, "monsterZone", player, duelReason.rule);
  card.sequence = sequence;
  card.position = "faceDownDefense";
  card.faceUp = false;
  state.players[player].normalSummonAvailable = false;
  recordNormalSetActivity(state, player, card);
  pushDuelLog(state, "setMonster", player, card.name, "Set from hand");
  collectEvent?.("monsterSet", card);
}

export function tributeSetDuelCard(
  state: DuelState,
  player: PlayerId,
  uid: string,
  tributeUids: string[],
  moveMaterial: DuelMaterialMover = defaultMaterialMover(state),
  canReleaseMaterial: DuelMaterialPredicate = () => true,
  collectEvent?: DuelEventCollector,
  canUseNormalSummonCount: DuelNormalSummonPredicate = (card) => hasNormalSummonCountAvailable(state, player, card),
): void {
  const card = requireControlledCard(state, player, uid, "hand");
  if (card.kind !== "monster") throw new Error(`${card.name} is not a monster`);
  if (!canUseNormalSummonCount(card)) throw new Error("Normal Summon is not available");
  const { uniqueTributes, tributeUnits } = validateNormalTributes(state, player, card, tributeUids, canReleaseMaterial);
  releaseNormalTributes(state, player, card, uniqueTributes, moveMaterial, `Tributed to Set ${card.name}`, collectEvent);
  const sequence = requireForcedMonsterZoneSequence(state, player, duelReason.rule, card);
  moveDuelCard(state, uid, "monsterZone", player, duelReason.rule);
  card.sequence = sequence;
  card.position = "faceDownDefense";
  card.faceUp = false;
  card.summonType = "tribute";
  card.summonPlayer = player;
  card.summonPhase = state.phase;
  card.summonMaterialUids = uniqueTributes;
  markProcedureComplete(card);
  state.players[player].normalSummonAvailable = false;
  recordNormalSetActivity(state, player, card);
  pushDuelLog(state, "setMonster", player, card.name, `Tribute Set with ${tributeUnits} tribute(s)`);
  collectEvent?.("monsterSet", card);
}

export function tributeSummonDuelCard(
  state: DuelState,
  player: PlayerId,
  uid: string,
  tributeUids: string[],
  collectEvent: DuelEventCollector,
  moveMaterial: DuelMaterialMover = defaultMaterialMover(state),
  canReleaseMaterial: DuelMaterialPredicate = () => true,
  canUseNormalSummonCount: DuelNormalSummonPredicate = (card) => hasNormalSummonCountAvailable(state, player, card),
  summonTypeCode?: number,
): void {
  const card = requireControlledCard(state, player, uid, "hand");
  if (card.kind !== "monster") throw new Error(`${card.name} is not a monster`);
  if (!canUseNormalSummonCount(card)) throw new Error("Normal Summon is not available");
  const { uniqueTributes, tributeUnits } = validateNormalTributes(state, player, card, tributeUids, canReleaseMaterial);
  releaseNormalTributes(state, player, card, uniqueTributes, moveMaterial, `Tributed for ${card.name}`, collectEvent);

  collectEvent("normalSummoning", card);
  const sequence = requireForcedMonsterZoneSequence(state, player, duelReason.summon, card);
  moveDuelCard(state, uid, "monsterZone", player, duelReason.summon);
  card.sequence = sequence;
  card.position = "faceUpAttack";
  card.faceUp = true;
  card.summonType = "tribute";
  if (summonTypeCode !== undefined) card.summonTypeCode = summonTypeCode;
  else delete card.summonTypeCode;
  card.summonPlayer = player;
  card.summonPhase = state.phase;
  card.summonMaterialUids = uniqueTributes;
  markProcedureComplete(card);
  state.players[player].normalSummonAvailable = false;
  recordNormalSummonActivity(state, player, card);
  pushDuelLog(state, "tributeSummon", player, card.name, `Tribute Summoned with ${tributeUnits} tribute(s)`);
  collectEvent("normalSummoned", card);
}

function validateNormalTributes(
  state: DuelState,
  player: PlayerId,
  card: DuelCardInstance,
  tributeUids: string[],
  canReleaseMaterial: DuelMaterialPredicate,
): { uniqueTributes: string[]; tributeUnits: number } {
  const tributeRange = tributeRangeForNormalSummon(card);
  if (tributeRange.max <= 0) throw new Error(`${card.name} does not require tributes`);
  const uniqueTributes = [...new Set(tributeUids)];
  if (uniqueTributes.length !== tributeUids.length) throw new Error("Tributes must be unique");
  const tributeUnits = uniqueTributes.reduce((sum, tributeUid) => sum + tributeUnitCount(state, requireControlledCard(state, player, tributeUid, "monsterZone"), card), 0);
  if (tributeUnits < tributeRange.min || tributeUnits > tributeRange.max) throw new Error(`${card.name} requires ${formatTributeRange(tributeRange)} tribute(s)`);
  for (const tributeUid of uniqueTributes) {
    const tribute = requireControlledCard(state, player, tributeUid, "monsterZone");
    if (!canReleaseMaterial(tribute.uid, card.uid)) throw new Error(`${tribute.name} cannot be released`);
  }
  return { uniqueTributes, tributeUnits };
}

function releaseNormalTributes(
  state: DuelState,
  player: PlayerId,
  card: DuelCardInstance,
  uniqueTributes: string[],
  moveMaterial: DuelMaterialMover,
  detail: string,
  collectEvent?: DuelEventCollector,
): void {
  for (const tributeUid of uniqueTributes) {
    const result = moveMaterial(tributeUid, player, duelReason.release | duelReason.summon, card.uid);
    pushDuelLog(state, "release", player, result.card.name, detail);
    if (collectEvent) collectSentToGraveyard(result, collectEvent);
  }
}

export function flipSummonDuelCard(state: DuelState, player: PlayerId, uid: string, collectEvent: DuelEventCollector): DuelCardInstance {
  const card = requireControlledCard(state, player, uid, "monsterZone");
  if (card.position !== "faceDownDefense") throw new Error(`${card.name} is not face-down defense`);
  if (!canFlipSummonDuelCard(state, player, card)) throw new Error(`${card.name} cannot be Flip Summoned this turn`);
  collectEvent("flipSummoning", card);
  card.position = "faceUpAttack";
  card.faceUp = true;
  card.summonType = "flip";
  card.summonPlayer = player;
  card.summonPhase = state.phase;
  card.summonMaterialUids = [];
  markProcedureComplete(card);
  recordFlipSummonActivity(state, player, card);
  pushDuelLog(state, "flipSummon", player, card.name, "Flip Summoned");
  collectEvent("flipSummoned", card);
  return card;
}

export function fusionSummonDuelCard(
  state: DuelState,
  player: PlayerId,
  uid: string,
  materialUids: string[],
  collectEvent: DuelEventCollector,
  moveMaterial: DuelMaterialMover = defaultMaterialMover(state),
  canUseMaterial: DuelMaterialPredicate = () => true,
): DuelCardInstance {
  const { card, materials } = requireExtraDeckSummonMaterials(state, player, uid, materialUids, cardDataMaterials(state, player, uid, "fusion"), "fusion", ["hand", "monsterZone"], canUseMaterial);
  for (const material of materials) {
    collectEvent("preUsedAsMaterial", material);
    const result = moveMaterial(material.uid, player, duelReason.material | duelReason.fusion);
    pushDuelLog(state, "fusionMaterial", player, material.name, `Used for ${card.name}`);
    collectSentToGraveyard(result, collectEvent);
    collectEvent("usedAsMaterial", result.card);
  }

  collectEvent("specialSummoning", card);
  const sequence = requireForcedMonsterZoneSequenceAfterMaterials(state, player, materialUids, duelReason.summon | duelReason.specialSummon | duelReason.fusion, card);
  moveDuelCard(state, uid, "monsterZone", player, duelReason.summon | duelReason.specialSummon | duelReason.fusion);
  card.sequence = sequence;
  card.position = "faceUpAttack";
  card.faceUp = true;
  card.summonType = "fusion";
  card.summonPlayer = player;
  card.summonPhase = state.phase;
  card.summonMaterialUids = [...materialUids];
  markProcedureComplete(card);
  recordSpecialSummonActivity(state, player, card);
  pushDuelLog(state, "fusionSummon", player, card.name, `Fusion Summoned with ${materialUids.length} material(s)`);
  collectEvent("specialSummoned", card);
  return card;
}

export function synchroSummonDuelCard(
  state: DuelState,
  player: PlayerId,
  uid: string,
  materialUids: string[],
  collectEvent: DuelEventCollector,
  moveMaterial: DuelMaterialMover = defaultMaterialMover(state),
  canUseMaterial: DuelMaterialPredicate = () => true,
): DuelCardInstance {
  const { card, materials } = requireSynchroSummonMaterials(state, player, uid, materialUids, canUseMaterial);
  for (const material of materials) {
    collectEvent("preUsedAsMaterial", material);
    const result = moveMaterial(material.uid, player, duelReason.material | duelReason.synchro);
    pushDuelLog(state, "synchroMaterial", player, material.name, `Used for ${card.name}`);
    collectSentToGraveyard(result, collectEvent);
    collectEvent("usedAsMaterial", result.card);
  }

  collectEvent("specialSummoning", card);
  const sequence = requireForcedMonsterZoneSequenceAfterMaterials(state, player, materialUids, duelReason.summon | duelReason.specialSummon | duelReason.synchro, card);
  moveDuelCard(state, uid, "monsterZone", player, duelReason.summon | duelReason.specialSummon | duelReason.synchro);
  card.sequence = sequence;
  card.position = "faceUpAttack";
  card.faceUp = true;
  card.summonType = "synchro";
  card.summonPlayer = player;
  card.summonPhase = state.phase;
  card.summonMaterialUids = [...materialUids];
  markProcedureComplete(card);
  recordSpecialSummonActivity(state, player, card);
  pushDuelLog(state, "synchroSummon", player, card.name, `Synchro Summoned with ${materialUids.length} material(s)`);
  collectEvent("specialSummoned", card);
  return card;
}

export function xyzSummonDuelCard(
  state: DuelState,
  player: PlayerId,
  uid: string,
  materialUids: string[],
  collectEvent: DuelEventCollector,
  moveMaterial: DuelOverlayMaterialMover = defaultOverlayMaterialMover(state),
  canUseMaterial: DuelMaterialPredicate = () => true,
): DuelCardInstance {
  const { card, materials } = requireXyzSummonMaterials(state, player, uid, materialUids, canUseMaterial);
  card.overlayUids = [];
  for (const material of materials) {
    collectEvent("preUsedAsMaterial", material);
    const overlay = moveMaterial(material.uid, player, duelReason.material | duelReason.xyz, card.uid);
    card.overlayUids.push(overlay.uid);
    pushDuelLog(state, "xyzMaterial", player, material.name, `Attached to ${card.name}`);
    collectEvent("usedAsMaterial", overlay);
  }

  collectEvent("specialSummoning", card);
  const sequence = requireForcedMonsterZoneSequenceAfterMaterials(state, player, materialUids, duelReason.summon | duelReason.specialSummon | duelReason.xyz, card);
  moveDuelCard(state, uid, "monsterZone", player, duelReason.summon | duelReason.specialSummon | duelReason.xyz);
  card.sequence = sequence;
  card.position = "faceUpAttack";
  card.faceUp = true;
  card.summonType = "xyz";
  card.summonPlayer = player;
  card.summonPhase = state.phase;
  card.summonMaterialUids = [...materialUids];
  markProcedureComplete(card);
  recordSpecialSummonActivity(state, player, card);
  pushDuelLog(state, "xyzSummon", player, card.name, `Xyz Summoned with ${materialUids.length} material(s)`);
  collectEvent("specialSummoned", card);
  return card;
}

export function linkSummonDuelCard(
  state: DuelState,
  player: PlayerId,
  uid: string,
  materialUids: string[],
  collectEvent: DuelEventCollector,
  moveMaterial: DuelMaterialMover = defaultMaterialMover(state),
  canUseMaterial: DuelMaterialPredicate = () => true,
): DuelCardInstance {
  const { card, materials } = requireLinkSummonMaterials(state, player, uid, materialUids, canUseMaterial);
  for (const material of materials) {
    collectEvent("preUsedAsMaterial", material);
    const result = moveMaterial(material.uid, player, duelReason.material | duelReason.link);
    pushDuelLog(state, "linkMaterial", player, material.name, `Used for ${card.name}`);
    collectSentToGraveyard(result, collectEvent);
    collectEvent("usedAsMaterial", result.card);
  }

  collectEvent("specialSummoning", card);
  const sequence = requireForcedMonsterZoneSequenceAfterMaterials(state, player, materialUids, duelReason.summon | duelReason.specialSummon | duelReason.link, card);
  moveDuelCard(state, uid, "monsterZone", player, duelReason.summon | duelReason.specialSummon | duelReason.link);
  card.sequence = sequence;
  card.position = "faceUpAttack";
  card.faceUp = true;
  card.summonType = "link";
  card.summonPlayer = player;
  card.summonPhase = state.phase;
  card.summonMaterialUids = [...materialUids];
  markProcedureComplete(card);
  recordSpecialSummonActivity(state, player, card);
  pushDuelLog(state, "linkSummon", player, card.name, `Link Summoned with ${materialUids.length} material(s)`);
  collectEvent("specialSummoned", card);
  return card;
}

export function ritualSummonDuelCard(
  state: DuelState,
  player: PlayerId,
  uid: string,
  materialUids: string[],
  collectEvent: DuelEventCollector,
  moveMaterial: DuelMaterialMover = defaultMaterialMover(state),
  canUseMaterial: DuelMaterialPredicate = () => true,
  position: CardPosition = "faceUpAttack",
): DuelCardInstance {
  const card = requireControlledCard(state, player, uid, "hand");
  const requiredMaterials = card.data.ritualMaterials ?? [];
  if (card.kind !== "monster") throw new Error(`${card.name} is not a ritual monster`);
  if (requiredMaterials.length === 0) throw new Error(`${card.name} does not define ritual materials`);
  if (new Set(materialUids).size !== materialUids.length) throw new Error(`${card.name} ritual materials must be unique`);
  const materials = materialUids.map((materialUid) => requireControlledCard(state, player, materialUid));
  if (materials.some((material) => material.uid === card.uid)) throw new Error(`${card.name} cannot use itself as ritual material`);
  if (!materialCodesMatch(materials, requiredMaterials, currentMaterialMatchOptions(state))) throw new Error(`${card.name} ritual materials are not legal`);
  for (const material of materials) {
    if ((material.location !== "hand" && material.location !== "monsterZone") || !isMonsterLike(state, material)) throw new Error(`${material.name} cannot be used as ritual material`);
    if (!canUseMaterial(material.uid)) throw new Error(`${material.name} cannot be used as ritual material`);
  }
  requireSummonZoneAfterMaterials(state, player, materialUids, duelReason.summon | duelReason.specialSummon | duelReason.ritual, card);

  for (const material of materials) {
    collectEvent("preUsedAsMaterial", material);
    const result = moveMaterial(material.uid, player, duelReason.material | duelReason.ritual);
    pushDuelLog(state, "ritualMaterial", player, material.name, `Used for ${card.name}`);
    collectSentToGraveyard(result, collectEvent);
    collectEvent("usedAsMaterial", result.card);
  }

  collectEvent("specialSummoning", card);
  const sequence = requireForcedMonsterZoneSequenceAfterMaterials(state, player, materialUids, duelReason.summon | duelReason.specialSummon | duelReason.ritual, card);
  moveDuelCard(state, uid, "monsterZone", player, duelReason.summon | duelReason.specialSummon | duelReason.ritual);
  card.sequence = sequence;
  card.position = position;
  card.faceUp = position !== "faceDownDefense";
  card.summonType = "ritual";
  card.summonPlayer = player;
  card.summonPhase = state.phase;
  card.summonMaterialUids = [...materialUids];
  markProcedureComplete(card);
  recordSpecialSummonActivity(state, player, card);
  pushDuelLog(state, "ritualSummon", player, card.name, `Ritual Summoned with ${materialUids.length} material(s)`);
  collectEvent("specialSummoned", card);
  return card;
}

function defaultMaterialMover(state: DuelState): DuelMaterialMover {
  return (uid, controller, reason) => ({ card: moveDuelCard(state, uid, "graveyard", controller, reason) });
}

function defaultOverlayMaterialMover(state: DuelState): DuelOverlayMaterialMover {
  return (uid, controller, reason) => moveDuelCard(state, uid, "overlay", controller, reason);
}

function collectSentToGraveyard(result: DuelMaterialMoveResult, collectEvent: DuelEventCollector): void {
  if (!result.collectedSentToGraveyard && result.card.location === "graveyard") collectEvent("sentToGraveyard", result.card);
}

export function normalSummonActions(state: DuelState, player: PlayerId, hand: DuelCardInstance[], canSummonWithoutTribute: DuelNormalSummonPredicate = () => false): DuelAction[] {
  const actions: DuelAction[] = [];
  for (const card of hand.filter((candidate) => candidate.kind === "monster")) {
    if (!hasNormalSummonCountAvailable(state, player, card)) continue;
    if (availableForcedMonsterZoneCount(state, player, [], 0, duelReason.summon, card) <= 0) continue;
    const tributeRange = tributeRangeForNormalSummon(card);
    if (tributeRange.min === 0 || canSummonWithoutTribute(card)) actions.push({ type: "normalSummon", player, uid: card.uid, label: `Normal Summon ${card.name}` });
    if (tributeRange.min === 0 && availableForcedMonsterZoneCount(state, player, [], 0, duelReason.rule, card) > 0) actions.push({ type: "setMonster", player, uid: card.uid, label: `Set ${card.name}` });
  }
  return actions;
}

function requireForcedMonsterZoneSequence(state: DuelState, player: PlayerId, reason: number, card: DuelCardInstance): number {
  const sequence = firstOpenForcedMonsterZoneSequence(state, player, [], 0, reason, card);
  if (sequence === undefined) throw new Error(`monsterZone is full for player ${player}`);
  return sequence;
}

export function geminiNormalSummonActions(state: DuelState, player: PlayerId): Extract<DuelAction, { type: "normalSummon" }>[] {
  return getCards(state, player, "monsterZone")
    .filter((card) => canGeminiNormalSummonDuelCard(state, player, card))
    .map((card) => ({ type: "normalSummon", player, uid: card.uid, label: `Normal Summon ${card.name} again` }));
}

export function canGeminiNormalSummonDuelCard(state: DuelState, player: PlayerId, card: DuelCardInstance, canUseNormalSummonCount: DuelNormalSummonPredicate = (candidate) => hasNormalSummonCountAvailable(state, player, candidate)): boolean {
  return (
    canUseNormalSummonCount(card) &&
    card.controller === player &&
    card.location === "monsterZone" &&
    card.faceUp &&
    card.kind === "monster" &&
    ((card.data.typeFlags ?? 0) & typeGemini) !== 0 &&
    !hasGeminiStatus(card)
  );
}

function hasGeminiStatus(card: DuelCardInstance): boolean {
  return card.summonTypeCode === summonTypeGemini && card.location === "monsterZone" && card.previousLocation === "monsterZone" && card.faceUp;
}

export function tributeSummonActions(state: DuelState, player: PlayerId, hand: DuelCardInstance[], canReleaseMaterial: DuelMaterialPredicate = () => true): DuelAction[] {
  return tributeNormalActions(state, player, hand, "tributeSummon", "Tribute Summon", canReleaseMaterial);
}

export function tributeSetActions(state: DuelState, player: PlayerId, hand: DuelCardInstance[], canReleaseMaterial: DuelMaterialPredicate = () => true): DuelAction[] {
  return tributeNormalActions(state, player, hand, "tributeSet", "Tribute Set", canReleaseMaterial);
}

function tributeNormalActions(state: DuelState, player: PlayerId, hand: DuelCardInstance[], type: "tributeSummon" | "tributeSet", labelVerb: string, canReleaseMaterial: DuelMaterialPredicate): DuelAction[] {
  const actions: DuelAction[] = [];
  for (const card of hand.filter((candidate) => candidate.kind === "monster")) {
    if (!hasNormalSummonCountAvailable(state, player, card)) continue;
    const tributeRange = tributeRangeForNormalSummon(card);
    const availableTributes = getCards(state, player, "monsterZone").filter((material) => isMonsterLike(state, material) && canReleaseMaterial(material.uid, card.uid));
    if (tributeRange.max <= 0 || availableTributes.reduce((sum, material) => sum + tributeUnitCount(state, material, card), 0) < tributeRange.min) continue;
    for (let tributeCount = Math.max(1, tributeRange.min); tributeCount <= tributeRange.max; tributeCount += 1) {
      for (const tributeUids of tributeCombinations(state, availableTributes, tributeCount, card)) {
        const reason = type === "tributeSummon" ? duelReason.summon : duelReason.rule;
        if (availableForcedMonsterZoneCount(state, player, tributeUids, 0, reason, card) <= 0) continue;
        const tributeNames = tributeUids.map((tributeUid) => findCard(state, tributeUid)?.name ?? tributeUid).join(", ");
        actions.push({ type, player, uid: card.uid, tributeUids, label: `${labelVerb} ${card.name} using ${tributeNames}` });
      }
    }
  }
  return actions;
}

export function flipSummonActions(state: DuelState, player: PlayerId): DuelAction[] {
  return getCards(state, player, "monsterZone")
    .filter((card) => card.position === "faceDownDefense" && canFlipSummonDuelCard(state, player, card))
    .map((card) => ({ type: "flipSummon", player, uid: card.uid, label: `Flip Summon ${card.name}` }));
}

function canFlipSummonDuelCard(state: DuelState, player: PlayerId, card: DuelCardInstance): boolean {
  if (card.controller !== player) return false;
  return !state.activityHistory.some((record) => record.player === player && record.cardUid === card.uid && (record.activity === duelActivity.summon || record.activity === duelActivity.normalSummon));
}

export function fusionSummonActions(state: DuelState, player: PlayerId, canUseMaterial: DuelMaterialPredicate = () => true): DuelAction[] {
  const materialPool = getCards(state, player, "hand")
    .filter((card) => card.kind === "monster" && canUseMaterial(card.uid))
    .concat(getCards(state, player, "monsterZone").filter((card) => isMonsterLike(state, card) && canUseMaterial(card.uid)));
  const actions: DuelAction[] = [];
  for (const card of getCards(state, player, "extraDeck")) {
    if (!isMonsterLike(state, card)) continue;
    for (const materialUids of findFusionMaterialUidSets(state, player, materialPool, card)) {
      const materialNames = materialUids.map((materialUid) => findCard(state, materialUid)?.name ?? materialUid).join(", ");
      actions.push({ type: "fusionSummon", player, uid: card.uid, materialUids, label: `Fusion Summon ${card.name} using ${materialNames}` });
    }
  }
  return actions;
}

export function synchroSummonActions(state: DuelState, player: PlayerId, canUseMaterial: DuelMaterialPredicate = () => true): DuelAction[] {
  const materialPool = getCards(state, player, "monsterZone").filter((card) => isMonsterLike(state, card));
  const actions: DuelAction[] = [];
  for (const card of getCards(state, player, "extraDeck")) {
    if (!isMonsterLike(state, card)) continue;
    for (const materialUids of findSynchroMaterialUidSets(state, materialPool, card)) {
      if (materialUids.some((materialUid) => !canUseMaterial(materialUid, card.uid))) continue;
      if (!hasSummonZoneAfterMaterials(state, player, materialUids, duelReason.summon | duelReason.specialSummon | duelReason.synchro, card)) continue;
      const materialNames = materialUids.map((materialUid) => findCard(state, materialUid)?.name ?? materialUid).join(", ");
      actions.push({ type: "synchroSummon", player, uid: card.uid, materialUids, label: `Synchro Summon ${card.name} using ${materialNames}` });
    }
  }
  return actions;
}

export function xyzSummonActions(state: DuelState, player: PlayerId, canUseMaterial: DuelMaterialPredicate = () => true): DuelAction[] {
  const materialPool = getCards(state, player, "monsterZone").filter((card) => isMonsterLike(state, card));
  const actions: DuelAction[] = [];
  for (const card of getCards(state, player, "extraDeck")) {
    if (!isMonsterLike(state, card)) continue;
    for (const materialUids of findXyzMaterialUidSets(state, materialPool, card)) {
      if (materialUids.some((materialUid) => !canUseMaterial(materialUid, card.uid))) continue;
      if (!hasSummonZoneAfterMaterials(state, player, materialUids, duelReason.summon | duelReason.specialSummon | duelReason.xyz, card)) continue;
      const materialNames = materialUids.map((materialUid) => findCard(state, materialUid)?.name ?? materialUid).join(", ");
      actions.push({ type: "xyzSummon", player, uid: card.uid, materialUids, label: `Xyz Summon ${card.name} using ${materialNames}` });
    }
  }
  return actions;
}

export function linkSummonActions(state: DuelState, player: PlayerId, canUseMaterial: DuelMaterialPredicate = () => true): DuelAction[] {
  const materialPool = getCards(state, player, "monsterZone").filter((card) => isMonsterLike(state, card) && canUseMaterial(card.uid));
  const actions: DuelAction[] = [];
  for (const card of getCards(state, player, "extraDeck")) {
    if (!isMonsterLike(state, card)) continue;
    for (const materialUids of findLinkMaterialUidSets(state, materialPool, card)) {
      if (!hasSummonZoneAfterMaterials(state, player, materialUids, duelReason.summon | duelReason.specialSummon | duelReason.link, card)) continue;
      const materialNames = materialUids.map((materialUid) => findCard(state, materialUid)?.name ?? materialUid).join(", ");
      actions.push({ type: "linkSummon", player, uid: card.uid, materialUids, label: `Link Summon ${card.name} using ${materialNames}` });
    }
  }
  return actions;
}

export function ritualSummonActions(state: DuelState, player: PlayerId, hand: DuelCardInstance[], canUseMaterial: DuelMaterialPredicate = () => true): DuelAction[] {
  const materialPool = hand
    .filter((card) => card.kind === "monster" && canUseMaterial(card.uid))
    .concat(getCards(state, player, "monsterZone").filter((card) => isMonsterLike(state, card) && canUseMaterial(card.uid)));
  const actions: DuelAction[] = [];
  for (const card of hand.filter((candidate) => candidate.kind === "monster" && candidate.data.ritualMaterials?.length)) {
    for (const materialUids of findSummonMaterialUidSets(state, player, materialPool.filter((material) => material.uid !== card.uid), card.data.ritualMaterials ?? [], currentMaterialMatchOptions(state), duelReason.summon | duelReason.specialSummon | duelReason.ritual, card)) {
      const materialNames = materialUids.map((materialUid) => findCard(state, materialUid)?.name ?? materialUid).join(", ");
      actions.push({ type: "ritualSummon", player, uid: card.uid, materialUids, label: `Ritual Summon ${card.name} using ${materialNames}` });
    }
  }
  return actions;
}

function extraDeckSummonActions(
  state: DuelState,
  player: PlayerId,
  materialPool: DuelCardInstance[],
  type: Extract<DuelAction["type"], "fusionSummon" | "synchroSummon" | "xyzSummon" | "linkSummon">,
  label: string,
  materialCodes: (card: DuelCardInstance) => string[] | undefined,
): DuelAction[] {
  const actions: DuelAction[] = [];
  for (const card of getCards(state, player, "extraDeck")) {
    if (!isMonsterLike(state, card)) continue;
    const requiredCodes = materialCodes(card);
    if (!requiredCodes?.length) continue;
    const options = type === "fusionSummon" ? fusionMaterialMatchOptions(state, card) : currentMaterialMatchOptions(state);
    const reason = summonMaterialReason(type);
    for (const materialUids of findSummonMaterialUidSets(state, player, materialPool, requiredCodes, options, reason, card)) {
      const materialNames = materialUids.map((materialUid) => findCard(state, materialUid)?.name ?? materialUid).join(", ");
      actions.push({ type, player, uid: card.uid, materialUids, label: `${label} Summon ${card.name} using ${materialNames}` });
    }
  }
  return actions;
}

function tributeRangeForNormalSummon(card: DuelCardInstance): { min: number; max: number } {
  if (card.data.normalTributes !== undefined) {
    const count = Math.max(0, card.data.normalTributes);
    return { min: count, max: count };
  }
  const base = baseNormalTributeCount(card);
  const min = Math.max(0, card.data.normalTributeMin ?? base);
  const max = Math.max(min, card.data.normalTributeMax ?? min);
  return { min, max };
}

function formatTributeRange(range: { min: number; max: number }): string {
  return range.min === range.max ? `${range.min}` : `${range.min}-${range.max}`;
}

function baseNormalTributeCount(card: DuelCardInstance): number {
  const level = card.data.level ?? 4;
  if (level >= 7) return 2;
  if (level >= 5) return 1;
  return 0;
}

function tributeCombinations(state: DuelState, cards: DuelCardInstance[], count: number, tributeTarget?: DuelCardInstance): string[][] {
  if (count === 0) return [[]];
  if (cards.reduce((sum, card) => sum + tributeUnitCount(state, card, tributeTarget), 0) < count) return [];
  const results: string[][] = [];
  for (let index = 0; index < cards.length; index += 1) {
    const head = cards[index];
    if (!head) continue;
    const remaining = count - tributeUnitCount(state, head, tributeTarget);
    if (remaining < 0) continue;
    for (const tail of tributeCombinations(state, cards.slice(index + 1), remaining, tributeTarget)) {
      results.push([head.uid, ...tail]);
    }
  }
  return results;
}

function findMaterialUids(cards: DuelCardInstance[], requiredCodes: string[], options?: MaterialCodeMatchOptions): string[] | undefined {
  return selectMaterialUidsForCodes(cards, requiredCodes, options);
}

function findMaterialUidSets(cards: DuelCardInstance[], requiredCodes: string[], options?: MaterialCodeMatchOptions): string[][] {
  const results: string[][] = [];
  const seen = new Set<string>();
  const direct = findMaterialUids(cards, requiredCodes, options);
  if (direct) appendMaterialUidSet(results, seen, direct);
  for (const materials of cardCombinations(cards, requiredCodes.length)) {
    if (!materialCodesMatch(materials, requiredCodes, options)) continue;
    const materialUids = findMaterialUids(materials, requiredCodes, options);
    if (!materialUids) continue;
    appendMaterialUidSet(results, seen, materialUids);
  }
  return results;
}

function findSummonMaterialUidSets(state: DuelState, player: PlayerId, cards: DuelCardInstance[], requiredCodes: string[], options?: MaterialCodeMatchOptions, reason = duelReason.summon | duelReason.specialSummon, card?: DuelCardInstance): string[][] {
  return findMaterialUidSets(cards, requiredCodes, options).filter((materialUids) => hasSummonZoneAfterMaterials(state, player, materialUids, reason, card));
}

function findFusionMaterialUidSets(state: DuelState, player: PlayerId, cards: DuelCardInstance[], card: DuelCardInstance): string[][] {
  const requiredCodes = card.data.fusionMaterials;
  const reason = duelReason.summon | duelReason.specialSummon | duelReason.fusion;
  if (requiredCodes?.length) return findSummonMaterialUidSets(state, player, cards, requiredCodes, fusionMaterialMatchOptions(state, card), reason, card);
  if (!hasGenericFusionMaterialRequirement(card)) return [];
  const results: string[][] = [];
  const seen = new Set<string>();
  const maxCount = Math.min(cards.length, card.data.fusionMaterialMax ?? card.data.fusionMaterialMin ?? cards.length);
  for (let count = card.data.fusionMaterialMin ?? 1; count <= maxCount; count += 1) {
    for (const materials of cardCombinations(cards, count)) {
      if (!materials.every((material) => fusionMaterialMatches(state, card, material))) continue;
      if (!hasSummonZoneAfterMaterials(state, player, materials.map((material) => material.uid), reason, card)) continue;
      appendMaterialUidSet(results, seen, materials.map((material) => material.uid));
    }
  }
  return results;
}

export function hasGenericFusionMaterialRequirement(card: DuelCardInstance): boolean {
  return card.data.fusionMaterialMin !== undefined || card.data.fusionMaterialMax !== undefined || card.data.fusionMaterialRace !== undefined || card.data.fusionMaterialType !== undefined || card.data.fusionMaterialSetcode !== undefined;
}

export function fusionMaterialCountAllowed(card: DuelCardInstance, count: number): boolean {
  if (!hasGenericFusionMaterialRequirement(card)) return true;
  const min = card.data.fusionMaterialMin ?? 1;
  const max = card.data.fusionMaterialMax ?? Number.POSITIVE_INFINITY;
  return count >= min && count <= max;
}

export function fusionMaterialMatches(state: DuelState, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return (target.data.fusionMaterialRace === undefined || (currentRace(material, state) & target.data.fusionMaterialRace) !== 0)
    && (target.data.fusionMaterialType === undefined || (cardTypeFlags(material, state) & target.data.fusionMaterialType) !== 0)
    && (target.data.fusionMaterialSetcode === undefined || currentCardMatchesSetcode(material, state, target.data.fusionMaterialSetcode));
}

function fusionMaterialMatchOptions(state: DuelState, target: DuelCardInstance): MaterialCodeMatchOptions {
  return {
    ...currentMaterialMatchOptions(state),
    maxSubstitutes: 1,
    canSubstitute: (material, requiredCode) => !currentCardMatchesCode(material, state, requiredCode) && canUseFusionSubstitute(state, material, target),
  };
}

function currentMaterialMatchOptions(state: DuelState): MaterialCodeMatchOptions {
  return {
    matchesCode: (material, requiredCode) => currentCardMatchesCode(material, state, requiredCode),
  };
}

function materialUidSetKey(materialUids: string[]): string {
  return [...materialUids].sort().join("\0");
}

function appendMaterialUidSet(results: string[][], seen: Set<string>, materialUids: string[]): void {
  const key = materialUidSetKey(materialUids);
  if (seen.has(key)) return;
  seen.add(key);
  results.push(materialUids);
}

function hasSummonZoneAfterMaterials(state: DuelState, player: PlayerId, materialUids: string[], reason = duelReason.summon | duelReason.specialSummon, card?: DuelCardInstance): boolean {
  return availableForcedMonsterZoneCount(state, player, materialUids, 0, reason, card) > 0;
}

function requireSummonZoneAfterMaterials(state: DuelState, player: PlayerId, materialUids: string[], reason = duelReason.summon | duelReason.specialSummon, card?: DuelCardInstance): void {
  if (!hasSummonZoneAfterMaterials(state, player, materialUids, reason, card)) throw new Error(`monsterZone is full for player ${player}`);
}

function requireForcedMonsterZoneSequenceAfterMaterials(state: DuelState, player: PlayerId, materialUids: string[], reason: number, card: DuelCardInstance): number {
  const sequence = firstOpenForcedMonsterZoneSequence(state, player, materialUids, 0, reason, card);
  if (sequence === undefined) throw new Error(`monsterZone is full for player ${player}`);
  return sequence;
}

function summonMaterialReason(type: Extract<DuelAction["type"], "fusionSummon" | "synchroSummon" | "xyzSummon" | "linkSummon">): number {
  if (type === "fusionSummon") return duelReason.summon | duelReason.specialSummon | duelReason.fusion;
  if (type === "synchroSummon") return duelReason.summon | duelReason.specialSummon | duelReason.synchro;
  if (type === "xyzSummon") return duelReason.summon | duelReason.specialSummon | duelReason.xyz;
  return duelReason.summon | duelReason.specialSummon | duelReason.link;
}

function extraDeckSummonReason(summonType: ExtraDeckSummonType): number {
  if (summonType === "fusion") return duelReason.summon | duelReason.specialSummon | duelReason.fusion;
  if (summonType === "synchro") return duelReason.summon | duelReason.specialSummon | duelReason.synchro;
  if (summonType === "Xyz") return duelReason.summon | duelReason.specialSummon | duelReason.xyz;
  return duelReason.summon | duelReason.specialSummon | duelReason.link;
}

function requireExtraDeckSummonMaterials(
  state: DuelState,
  player: PlayerId,
  uid: string,
  materialUids: string[],
  requiredMaterials: string[] | undefined,
  summonType: ExtraDeckSummonType,
  allowedLocations: DuelLocation[],
  canUseMaterial: DuelMaterialPredicate,
): { card: DuelCardInstance; materials: DuelCardInstance[] } {
  const card = requireControlledCard(state, player, uid, "extraDeck");
  if (!isMonsterLike(state, card)) throw new Error(`${card.name} is not a ${summonType} monster`);
  if (!requiredMaterials?.length) throw new Error(`${card.name} does not define ${summonType} materials`);
  if (new Set(materialUids).size !== materialUids.length) throw new Error(`${card.name} ${summonType} materials must be unique`);
  const materials = materialUids.map((materialUid) => requireControlledCard(state, player, materialUid));
  if (!materialCodesMatch(materials, requiredMaterials, summonType === "fusion" ? fusionMaterialMatchOptions(state, card) : currentMaterialMatchOptions(state))) throw new Error(`${card.name} ${summonType} materials are not legal`);
  for (const material of materials) {
    if (!allowedLocations.includes(material.location) || !isMonsterLike(state, material)) throw new Error(`${material.name} cannot be used as ${summonType} material`);
    if (!canUseMaterial(material.uid, card.uid)) throw new Error(`${material.name} cannot be used as ${summonType} material`);
  }
  requireSummonZoneAfterMaterials(state, player, materialUids, extraDeckSummonReason(summonType), card);
  return { card, materials };
}

function requireSynchroSummonMaterials(state: DuelState, player: PlayerId, uid: string, materialUids: string[], canUseMaterial: DuelMaterialPredicate): { card: DuelCardInstance; materials: DuelCardInstance[] } {
  const card = requireControlledCard(state, player, uid, "extraDeck");
  if (!isMonsterLike(state, card)) throw new Error(`${card.name} is not a synchro monster`);
  if (new Set(materialUids).size !== materialUids.length) throw new Error(`${card.name} synchro materials must be unique`);
  const materials = materialUids.map((materialUid) => requireControlledCard(state, player, materialUid));
  if (!materials.length) throw new Error(`${card.name} synchro materials are not legal`);
  if (card.data.synchroMaterials) {
    if (!synchroMaterialRolesMatch(state, materials, card.data.synchroMaterials)) throw new Error(`${card.name} synchro materials are not legal`);
  } else if (!canGenericSynchroMaterialsMatch(state, card, materials)) {
    throw new Error(`${card.name} synchro materials are not legal`);
  }
  for (const material of materials) {
    if (material.location !== "monsterZone" || !isMonsterLike(state, material)) throw new Error(`${material.name} cannot be used as synchro material`);
    if (!canUseMaterial(material.uid, card.uid)) throw new Error(`${material.name} cannot be used as synchro material`);
  }
  requireSummonZoneAfterMaterials(state, player, materialUids, duelReason.summon | duelReason.specialSummon | duelReason.synchro, card);
  return { card, materials };
}

function requireXyzSummonMaterials(state: DuelState, player: PlayerId, uid: string, materialUids: string[], canUseMaterial: DuelMaterialPredicate): { card: DuelCardInstance; materials: DuelCardInstance[] } {
  const card = requireControlledCard(state, player, uid, "extraDeck");
  if (!isMonsterLike(state, card)) throw new Error(`${card.name} is not an Xyz monster`);
  if (new Set(materialUids).size !== materialUids.length) throw new Error(`${card.name} Xyz materials must be unique`);
  const materials = materialUids.map((materialUid) => requireControlledCard(state, player, materialUid));
  if (!materials.length) throw new Error(`${card.name} Xyz materials are not legal`);
  if (card.data.xyzMaterials?.length) {
    if (!materialCodesMatch(materials, card.data.xyzMaterials, currentMaterialMatchOptions(state))) throw new Error(`${card.name} Xyz materials are not legal`);
  } else if (!canGenericXyzMaterialsMatch(state, card, materials)) {
    throw new Error(`${card.name} Xyz materials are not legal`);
  }
  for (const material of materials) {
    if (material.location !== "monsterZone" || !isMonsterLike(state, material)) throw new Error(`${material.name} cannot be used as Xyz material`);
    if (!canUseMaterial(material.uid, card.uid)) throw new Error(`${material.name} cannot be used as Xyz material`);
  }
  requireSummonZoneAfterMaterials(state, player, materialUids, duelReason.summon | duelReason.specialSummon | duelReason.xyz, card);
  return { card, materials };
}

function requireLinkSummonMaterials(state: DuelState, player: PlayerId, uid: string, materialUids: string[], canUseMaterial: DuelMaterialPredicate): { card: DuelCardInstance; materials: DuelCardInstance[] } {
  const card = requireControlledCard(state, player, uid, "extraDeck");
  if (!isMonsterLike(state, card)) throw new Error(`${card.name} is not a Link monster`);
  const targetRating = linkRating(state, card);
  if (targetRating <= 0) throw new Error(`${card.name} does not define Link materials`);
  if (new Set(materialUids).size !== materialUids.length) throw new Error(`${card.name} Link materials must be unique`);
  const materials = materialUids.map((materialUid) => requireControlledCard(state, player, materialUid));
  if (!materials.length) throw new Error(`${card.name} Link materials are not legal`);
  if (!linkMaterialCountAllowed(card, materials.length)) throw new Error(`${card.name} Link materials are not legal`);
  if (!materials.every((material) => linkMaterialMatches(state, card, material))) throw new Error(`${card.name} Link materials are not legal`);
  if (!linkMaterialCodesMatch(state, materials, card.data.linkMaterials)) throw new Error(`${card.name} Link materials are not legal`);
  if (!canLinkMaterialsMatchRating(state, materials, targetRating)) throw new Error(`${card.name} Link materials are not legal`);
  for (const material of materials) {
    if (material.location !== "monsterZone" || !isMonsterLike(state, material)) throw new Error(`${material.name} cannot be used as Link material`);
    if (!canUseMaterial(material.uid)) throw new Error(`${material.name} cannot be used as Link material`);
  }
  requireSummonZoneAfterMaterials(state, player, materialUids, duelReason.summon | duelReason.specialSummon | duelReason.link, card);
  return { card, materials };
}

function cardDataMaterials(state: DuelState, player: PlayerId, uid: string, summonType: ExtraDeckSummonType): string[] | undefined {
  const card = requireControlledCard(state, player, uid, "extraDeck");
  if (summonType === "fusion") return card.data.fusionMaterials;
  if (summonType === "Xyz") return card.data.xyzMaterials;
  return card.data.linkMaterials;
}

function findLinkMaterialUidSets(state: DuelState, materialPool: DuelCardInstance[], card: DuelCardInstance): string[][] {
  const targetRating = linkRating(state, card);
  if (targetRating <= 0) return [];
  const results: string[][] = [];
  const seen = new Set<string>();
  if (card.data.linkMaterials?.length) {
    for (const materials of cardCombinations(materialPool, card.data.linkMaterials.length)) {
      if (!linkMaterialCountAllowed(card, materials.length)) continue;
      if (!materials.every((material) => linkMaterialMatches(state, card, material))) continue;
      if (linkMaterialCodesMatch(state, materials, card.data.linkMaterials) && canLinkMaterialsMatchRating(state, materials, targetRating)) {
        appendMaterialUidSet(results, seen, materials.map((material) => material.uid));
      }
    }
    return results;
  }
  for (let count = 1; count <= materialPool.length; count += 1) {
    if (!linkMaterialCountAllowed(card, count)) continue;
    for (const materials of cardCombinations(materialPool, count)) {
      if (!materials.every((material) => linkMaterialMatches(state, card, material))) continue;
      if (canLinkMaterialsMatchRating(state, materials, targetRating)) appendMaterialUidSet(results, seen, materials.map((material) => material.uid));
    }
  }
  return results;
}

function findSynchroMaterialUidSets(state: DuelState, materialPool: DuelCardInstance[], card: DuelCardInstance): string[][] {
  if (card.data.synchroMaterials) return findSynchroMaterialRoleUidSets(state, materialPool, card.data.synchroMaterials);
  const results: string[][] = [];
  for (let count = 2; count <= materialPool.length; count += 1) {
    for (const materials of cardCombinations(materialPool, count)) {
      if (canGenericSynchroMaterialsMatch(state, card, materials)) results.push(materials.map((material) => material.uid));
    }
  }
  return results;
}

function findXyzMaterialUidSets(state: DuelState, materialPool: DuelCardInstance[], card: DuelCardInstance): string[][] {
  if (card.data.xyzMaterials?.length) return findMaterialUidSets(materialPool, card.data.xyzMaterials, currentMaterialMatchOptions(state));
  const results: string[][] = [];
  const maxCount = Math.min(materialPool.length, xyzMaterialMax(card));
  for (let count = xyzMaterialCount(card); count <= maxCount; count += 1) {
    for (const materials of cardCombinations(materialPool, count)) {
      if (canGenericXyzMaterialsMatch(state, card, materials)) results.push(materials.map((material) => material.uid));
    }
  }
  return results;
}

function findSynchroMaterialRoleUidSets(state: DuelState, cards: DuelCardInstance[], required: SynchroMaterialCodes): string[][] {
  const results: string[][] = [];
  const seen = new Set<string>();
  for (const tuner of cards) {
    if (!isTuner(state, tuner) || !currentCardMatchesCode(tuner, state, required.tuner)) continue;
    const nonTunerPool = cards.filter((card) => card.uid !== tuner.uid && !isTuner(state, card));
    for (const nonTunerUids of findMaterialUidSets(nonTunerPool, required.nonTuners, currentMaterialMatchOptions(state))) {
      appendMaterialUidSet(results, seen, [tuner.uid, ...nonTunerUids]);
    }
  }
  return results;
}

function synchroMaterialRolesMatch(state: DuelState, materials: DuelCardInstance[], required: SynchroMaterialCodes): boolean {
  const selectedKey = materialUidSetKey(materials.map((material) => material.uid));
  return findSynchroMaterialRoleUidSets(state, materials, required).some((materialUids) => materialUidSetKey(materialUids) === selectedKey);
}

function canGenericSynchroMaterialsMatch(state: DuelState, card: DuelCardInstance, materials: DuelCardInstance[]): boolean {
  const targetLevel = synchroLevel(state, card);
  if (targetLevel <= 0 || materials.length < 2) return false;
  if (!synchroMaterialCountsAllowed(state, card, materials)) return false;
  if (!materials.every((material) => !isTuner(state, material) || (synchroTunerLevelMatches(state, card, material) && synchroTunerAttributeMatches(state, card, material) && synchroTunerRaceMatches(state, card, material) && synchroTunerTypeMatches(state, card, material) && synchroTunerSetcodeMatches(state, card, material)))) return false;
  if (!materials.every((material) => isTuner(state, material) || (synchroNonTunerAttributeMatches(state, card, material) && synchroNonTunerRaceMatches(state, card, material) && synchroNonTunerTypeMatches(state, card, material) && synchroNonTunerSetcodeMatches(state, card, material)))) return false;
  return materials.reduce((total, material) => total + currentLevel(material, state), 0) === targetLevel;
}

function synchroLevel(state: DuelState, card: DuelCardInstance): number {
  return (cardTypeFlags(card, state) & 0x2000) !== 0 ? currentLevel(card, state) : 0;
}

function canGenericXyzMaterialsMatch(state: DuelState, card: DuelCardInstance, materials: DuelCardInstance[]): boolean {
  const targetRank = xyzRank(state, card);
  return targetRank > 0 && materials.length >= xyzMaterialCount(card) && materials.length <= xyzMaterialMax(card) && materials.every((material) => currentLevel(material, state) === targetRank && xyzMaterialRaceMatches(state, card, material) && xyzMaterialAttributeMatches(state, card, material) && xyzMaterialTypeMatches(state, card, material) && xyzMaterialSetcodeMatches(state, card, material) && xyzMaterialRankMatches(state, card, material));
}

function xyzRank(state: DuelState, card: DuelCardInstance): number {
  return (cardTypeFlags(card, state) & 0x800000) !== 0 ? currentRank(card, state) : 0;
}

function xyzMaterialCount(card: DuelCardInstance): number {
  return card.data.xyzMaterialCount ?? 2;
}

function xyzMaterialMax(card: DuelCardInstance): number {
  return card.data.xyzMaterialMax ?? xyzMaterialCount(card);
}

function xyzMaterialRaceMatches(state: DuelState, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.xyzMaterialRace === undefined || (currentRace(material, state) & target.data.xyzMaterialRace) !== 0;
}

function xyzMaterialAttributeMatches(state: DuelState, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.xyzMaterialAttribute === undefined || (currentAttribute(material, state) & target.data.xyzMaterialAttribute) !== 0;
}

function xyzMaterialTypeMatches(state: DuelState, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.xyzMaterialType === undefined || (cardTypeFlags(material, state) & target.data.xyzMaterialType) !== 0;
}

function xyzMaterialSetcodeMatches(state: DuelState, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.xyzMaterialSetcode === undefined || currentCardMatchesSetcode(material, state, target.data.xyzMaterialSetcode);
}

function xyzMaterialRankMatches(state: DuelState, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.xyzMaterialRank === undefined || xyzRank(state, material) === target.data.xyzMaterialRank;
}

function isTuner(state: DuelState, card: DuelCardInstance): boolean {
  return (cardTypeFlags(card, state) & 0x1000) !== 0;
}

function synchroMaterialCountsAllowed(state: DuelState, card: DuelCardInstance, materials: DuelCardInstance[]): boolean {
  const tunerCount = materials.filter((material) => isTuner(state, material)).length;
  const nonTunerCount = materials.length - tunerCount;
  const tunerMin = card.data.synchroTunerMin ?? 1;
  const tunerMax = card.data.synchroTunerMax ?? 1;
  const nonTunerMin = card.data.synchroNonTunerMin ?? 1;
  const nonTunerMax = card.data.synchroNonTunerMax ?? Number.POSITIVE_INFINITY;
  return tunerCount >= tunerMin && tunerCount <= tunerMax && nonTunerCount >= nonTunerMin && nonTunerCount <= nonTunerMax;
}

function synchroTunerAttributeMatches(state: DuelState, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.synchroTunerAttribute === undefined || (currentAttribute(material, state) & target.data.synchroTunerAttribute) !== 0;
}

function synchroTunerLevelMatches(state: DuelState, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.synchroTunerLevel === undefined || currentLevel(material, state) === target.data.synchroTunerLevel;
}

function synchroTunerRaceMatches(state: DuelState, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.synchroTunerRace === undefined || (currentRace(material, state) & target.data.synchroTunerRace) !== 0;
}

function synchroTunerTypeMatches(state: DuelState, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.synchroTunerType === undefined || (cardTypeFlags(material, state) & target.data.synchroTunerType) !== 0;
}

function synchroTunerSetcodeMatches(state: DuelState, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.synchroTunerSetcode === undefined || currentCardMatchesSetcode(material, state, target.data.synchroTunerSetcode);
}

function synchroNonTunerAttributeMatches(state: DuelState, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.synchroNonTunerAttribute === undefined || (currentAttribute(material, state) & target.data.synchroNonTunerAttribute) !== 0;
}

function synchroNonTunerRaceMatches(state: DuelState, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.synchroNonTunerRace === undefined || (currentRace(material, state) & target.data.synchroNonTunerRace) !== 0;
}

function synchroNonTunerTypeMatches(state: DuelState, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.synchroNonTunerType === undefined || (cardTypeFlags(material, state) & target.data.synchroNonTunerType) !== 0;
}

function synchroNonTunerSetcodeMatches(state: DuelState, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.synchroNonTunerSetcode === undefined || currentCardMatchesSetcode(material, state, target.data.synchroNonTunerSetcode);
}

function linkMaterialCodesMatch(state: DuelState, materials: DuelCardInstance[], requiredCodes: string[] | undefined): boolean {
  if (!requiredCodes?.length) return true;
  if (materials.length !== requiredCodes.length) return false;
  const used = new Set<string>();
  for (const code of requiredCodes) {
    const material = materials.find((candidate) => !used.has(candidate.uid) && currentLinkMaterialCodes(candidate, state).includes(code));
    if (!material) return false;
    used.add(material.uid);
  }
  return used.size === materials.length;
}

function canLinkMaterialsMatchRating(state: DuelState, materials: DuelCardInstance[], targetRating: number): boolean {
  if (materials.length === 0 || materials.length > targetRating) return false;
  return linkRatingChoicesMatch(materials.map((material) => linkMaterialRatings(state, material)), targetRating, 0, 0);
}

function linkRatingChoicesMatch(choices: number[][], targetRating: number, index: number, currentRating: number): boolean {
  if (index >= choices.length) return currentRating === targetRating;
  for (const rating of choices[index] ?? []) {
    if (currentRating + rating <= targetRating && linkRatingChoicesMatch(choices, targetRating, index + 1, currentRating + rating)) return true;
  }
  return false;
}

function linkMaterialRatings(state: DuelState, card: DuelCardInstance): number[] {
  const rating = linkRating(state, card);
  return rating > 1 ? [1, rating] : [1];
}

function linkRating(state: DuelState, card: DuelCardInstance): number {
  if (!card.data.linkMaterials?.length && (cardTypeFlags(card, state) & 0x4000000) === 0) return 0;
  if (card.data.level !== undefined) return currentLink(card, state);
  return card.data.linkMaterials?.length ?? 0;
}

function linkMaterialCountAllowed(card: DuelCardInstance, count: number): boolean {
  const min = card.data.linkMaterialMin ?? 1;
  const max = card.data.linkMaterialMax ?? Number.POSITIVE_INFINITY;
  return count >= min && count <= max;
}

function linkMaterialMatches(state: DuelState, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return linkMaterialTypeMatches(state, target, material)
    && linkMaterialRaceMatches(state, target, material)
    && linkMaterialAttributeMatches(state, target, material)
    && linkMaterialSetcodeMatches(state, target, material)
    && linkMaterialSummonTypeMatches(target, material)
    && linkMaterialLevelMatches(state, target, material)
    && linkMaterialMinLevelMatches(state, target, material);
}

function linkMaterialTypeMatches(state: DuelState, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.linkMaterialType === undefined || (cardTypeFlags(material, state) & target.data.linkMaterialType) !== 0;
}

function linkMaterialRaceMatches(state: DuelState, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.linkMaterialRace === undefined || (currentRace(material, state) & target.data.linkMaterialRace) !== 0;
}

function linkMaterialAttributeMatches(state: DuelState, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.linkMaterialAttribute === undefined || (currentAttribute(material, state) & target.data.linkMaterialAttribute) !== 0;
}

function linkMaterialSetcodeMatches(state: DuelState, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.linkMaterialSetcode === undefined || currentLinkMaterialMatchesSetcode(material, state, target.data.linkMaterialSetcode);
}

function linkMaterialSummonTypeMatches(target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.linkMaterialSummonType === undefined || isSummonTypeMaskMatch(summonTypeMaskFromCard(material), target.data.linkMaterialSummonType);
}

function linkMaterialLevelMatches(state: DuelState, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.linkMaterialLevel === undefined || currentLevel(material, state) === target.data.linkMaterialLevel;
}

function linkMaterialMinLevelMatches(state: DuelState, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.linkMaterialMinLevel === undefined || currentLevel(material, state) >= target.data.linkMaterialMinLevel;
}

function isMonsterLike(state: DuelState, card: DuelCardInstance): boolean {
  return (cardTypeFlags(card, state) & 0x1) !== 0;
}

function synchroMaterialCodes(card: DuelCardInstance): string[] | undefined {
  const materials = card.data.synchroMaterials;
  return materials ? [materials.tuner, ...materials.nonTuners] : undefined;
}
