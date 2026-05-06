import { findCard, getCards, hasZoneSpace, moveDuelCard, pushDuelLog, requireControlledCard, requireZoneSpace } from "#duel/card-state.js";
import { duelActivity, recordFlipSummonActivity, recordNormalSetActivity, recordNormalSummonActivity, recordSpecialSummonActivity } from "#duel/activity.js";
import { duelReason } from "#duel/reasons.js";
import { tributeUnitCount } from "#duel/double-tribute.js";
import { cardCombinations, cardMatchesCode, isMonsterLike, materialCodesMatch } from "#duel/summon-materials.js";
import type { DuelAction, DuelCardInstance, DuelEventName, DuelLocation, DuelState, PlayerId } from "#duel/types.js";

export type DuelEventCollector = (eventName: DuelEventName, eventCard?: DuelCardInstance) => void;
export interface DuelMaterialMoveResult {
  card: DuelCardInstance;
  collectedSentToGraveyard?: boolean;
}
export type DuelMaterialMover = (uid: string, controller: PlayerId, reason: number) => DuelMaterialMoveResult;
export type DuelOverlayMaterialMover = (uid: string, controller: PlayerId, reason: number) => DuelCardInstance;
export type DuelMaterialPredicate = (uid: string) => boolean;
export type DuelNormalSummonPredicate = (card: DuelCardInstance) => boolean;
type ExtraDeckSummonType = "fusion" | "synchro" | "Xyz" | "Link";

export function normalSummon(state: DuelState, player: PlayerId, uid: string, collectEvent: DuelEventCollector, canSummonWithoutTribute: DuelNormalSummonPredicate = () => false): void {
  const card = requireControlledCard(state, player, uid, "hand");
  if (card.kind !== "monster") throw new Error(`${card.name} is not a monster`);
  if (tributeRangeForNormalSummon(card).min > 0 && !canSummonWithoutTribute(card)) throw new Error(`${card.name} requires a Tribute Summon`);
  if (!state.players[player].normalSummonAvailable) throw new Error("Normal Summon is not available");
  requireZoneSpace(state, player, "monsterZone");
  collectEvent("normalSummoning", card);
  moveDuelCard(state, uid, "monsterZone", player, duelReason.summon);
  card.position = "faceUpAttack";
  card.summonType = "normal";
  card.summonPlayer = player;
  card.summonPhase = state.phase;
  card.summonMaterialUids = [];
  state.players[player].normalSummonAvailable = false;
  recordNormalSummonActivity(state, player, card);
  pushDuelLog(state, "normalSummon", player, card.name, "Normal Summoned from hand");
  collectEvent("normalSummoned", card);
}

export function setMonster(state: DuelState, player: PlayerId, uid: string, collectEvent?: DuelEventCollector): void {
  const card = requireControlledCard(state, player, uid, "hand");
  if (card.kind !== "monster") throw new Error(`${card.name} is not a monster`);
  if (tributeRangeForNormalSummon(card).min > 0) throw new Error(`${card.name} requires tributes to Set`);
  if (!state.players[player].normalSummonAvailable) throw new Error("Normal Summon is not available");
  requireZoneSpace(state, player, "monsterZone");
  moveDuelCard(state, uid, "monsterZone", player, duelReason.rule);
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
): void {
  const card = requireControlledCard(state, player, uid, "hand");
  if (card.kind !== "monster") throw new Error(`${card.name} is not a monster`);
  if (!state.players[player].normalSummonAvailable) throw new Error("Normal Summon is not available");
  const { uniqueTributes, tributeUnits } = validateNormalTributes(state, player, card, tributeUids, canReleaseMaterial);
  releaseNormalTributes(state, player, card, uniqueTributes, moveMaterial, `Tributed to Set ${card.name}`, collectEvent);
  moveDuelCard(state, uid, "monsterZone", player, duelReason.rule);
  card.position = "faceDownDefense";
  card.faceUp = false;
  card.summonType = "tribute";
  card.summonPlayer = player;
  card.summonPhase = state.phase;
  card.summonMaterialUids = uniqueTributes;
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
): void {
  const card = requireControlledCard(state, player, uid, "hand");
  if (card.kind !== "monster") throw new Error(`${card.name} is not a monster`);
  if (!state.players[player].normalSummonAvailable) throw new Error("Normal Summon is not available");
  const { uniqueTributes, tributeUnits } = validateNormalTributes(state, player, card, tributeUids, canReleaseMaterial);
  releaseNormalTributes(state, player, card, uniqueTributes, moveMaterial, `Tributed for ${card.name}`, collectEvent);

  collectEvent("normalSummoning", card);
  moveDuelCard(state, uid, "monsterZone", player, duelReason.summon);
  card.position = "faceUpAttack";
  card.faceUp = true;
  card.summonType = "tribute";
  card.summonPlayer = player;
  card.summonPhase = state.phase;
  card.summonMaterialUids = uniqueTributes;
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
  const tributeUnits = uniqueTributes.reduce((sum, tributeUid) => sum + tributeUnitCount(state, requireControlledCard(state, player, tributeUid, "monsterZone")), 0);
  if (tributeUnits < tributeRange.min || tributeUnits > tributeRange.max) throw new Error(`${card.name} requires ${formatTributeRange(tributeRange)} tribute(s)`);
  for (const tributeUid of uniqueTributes) {
    const tribute = requireControlledCard(state, player, tributeUid, "monsterZone");
    if (!canReleaseMaterial(tribute.uid)) throw new Error(`${tribute.name} cannot be released`);
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
    const result = moveMaterial(tributeUid, player, duelReason.release | duelReason.summon);
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
  moveDuelCard(state, uid, "monsterZone", player, duelReason.summon | duelReason.specialSummon | duelReason.fusion);
  card.position = "faceUpAttack";
  card.faceUp = true;
  card.summonType = "fusion";
  card.summonPlayer = player;
  card.summonPhase = state.phase;
  card.summonMaterialUids = [...materialUids];
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
  moveDuelCard(state, uid, "monsterZone", player, duelReason.summon | duelReason.specialSummon | duelReason.synchro);
  card.position = "faceUpAttack";
  card.faceUp = true;
  card.summonType = "synchro";
  card.summonPlayer = player;
  card.summonPhase = state.phase;
  card.summonMaterialUids = [...materialUids];
  recordSpecialSummonActivity(state, player, card);
  pushDuelLog(state, "synchroSummon", player, card.name, `Synchro Summoned with ${materialUids.length} material(s)`);
  collectEvent("specialSummoned", card);
  return card;
}

export function xyzSummonDuelCard(state: DuelState, player: PlayerId, uid: string, materialUids: string[], collectEvent: DuelEventCollector, moveMaterial: DuelOverlayMaterialMover = defaultOverlayMaterialMover(state)): DuelCardInstance {
  const { card, materials } = requireXyzSummonMaterials(state, player, uid, materialUids);
  card.overlayUids = [];
  for (const material of materials) {
    collectEvent("preUsedAsMaterial", material);
    const overlay = moveMaterial(material.uid, player, duelReason.material | duelReason.xyz);
    card.overlayUids.push(overlay.uid);
    pushDuelLog(state, "xyzMaterial", player, material.name, `Attached to ${card.name}`);
    collectEvent("usedAsMaterial", overlay);
  }

  collectEvent("specialSummoning", card);
  moveDuelCard(state, uid, "monsterZone", player, duelReason.summon | duelReason.specialSummon | duelReason.xyz);
  card.position = "faceUpAttack";
  card.faceUp = true;
  card.summonType = "xyz";
  card.summonPlayer = player;
  card.summonPhase = state.phase;
  card.summonMaterialUids = [...materialUids];
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
  moveDuelCard(state, uid, "monsterZone", player, duelReason.summon | duelReason.specialSummon | duelReason.link);
  card.position = "faceUpAttack";
  card.faceUp = true;
  card.summonType = "link";
  card.summonPlayer = player;
  card.summonPhase = state.phase;
  card.summonMaterialUids = [...materialUids];
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
): DuelCardInstance {
  const card = requireControlledCard(state, player, uid, "hand");
  const requiredMaterials = card.data.ritualMaterials ?? [];
  if (card.kind !== "monster") throw new Error(`${card.name} is not a ritual monster`);
  if (requiredMaterials.length === 0) throw new Error(`${card.name} does not define ritual materials`);
  if (new Set(materialUids).size !== materialUids.length) throw new Error(`${card.name} ritual materials must be unique`);
  const materials = materialUids.map((materialUid) => requireControlledCard(state, player, materialUid));
  if (materials.some((material) => material.uid === card.uid)) throw new Error(`${card.name} cannot use itself as ritual material`);
  if (!materialCodesMatch(materials, requiredMaterials)) throw new Error(`${card.name} ritual materials are not legal`);
  for (const material of materials) {
    if ((material.location !== "hand" && material.location !== "monsterZone") || !isMonsterLike(material)) throw new Error(`${material.name} cannot be used as ritual material`);
    if (!canUseMaterial(material.uid)) throw new Error(`${material.name} cannot be used as ritual material`);
  }
  requireSummonZoneAfterMaterials(state, player, materialUids);

  for (const material of materials) {
    collectEvent("preUsedAsMaterial", material);
    const result = moveMaterial(material.uid, player, duelReason.material | duelReason.ritual);
    pushDuelLog(state, "ritualMaterial", player, material.name, `Used for ${card.name}`);
    collectSentToGraveyard(result, collectEvent);
    collectEvent("usedAsMaterial", result.card);
  }

  collectEvent("specialSummoning", card);
  moveDuelCard(state, uid, "monsterZone", player, duelReason.summon | duelReason.specialSummon | duelReason.ritual);
  card.position = "faceUpAttack";
  card.faceUp = true;
  card.summonType = "ritual";
  card.summonPlayer = player;
  card.summonPhase = state.phase;
  card.summonMaterialUids = [...materialUids];
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
  if (!state.players[player].normalSummonAvailable || !hasZoneSpace(state, player, "monsterZone")) return [];
  const actions: DuelAction[] = [];
  for (const card of hand.filter((candidate) => candidate.kind === "monster")) {
    const tributeRange = tributeRangeForNormalSummon(card);
    if (tributeRange.min === 0 || canSummonWithoutTribute(card)) actions.push({ type: "normalSummon", player, uid: card.uid, label: `Normal Summon ${card.name}` });
    if (tributeRange.min === 0) actions.push({ type: "setMonster", player, uid: card.uid, label: `Set ${card.name}` });
  }
  return actions;
}

export function tributeSummonActions(state: DuelState, player: PlayerId, hand: DuelCardInstance[], canReleaseMaterial: DuelMaterialPredicate = () => true): DuelAction[] {
  return tributeNormalActions(state, player, hand, "tributeSummon", "Tribute Summon", canReleaseMaterial);
}

export function tributeSetActions(state: DuelState, player: PlayerId, hand: DuelCardInstance[], canReleaseMaterial: DuelMaterialPredicate = () => true): DuelAction[] {
  return tributeNormalActions(state, player, hand, "tributeSet", "Tribute Set", canReleaseMaterial);
}

function tributeNormalActions(state: DuelState, player: PlayerId, hand: DuelCardInstance[], type: "tributeSummon" | "tributeSet", labelVerb: string, canReleaseMaterial: DuelMaterialPredicate): DuelAction[] {
  if (!state.players[player].normalSummonAvailable) return [];
  const availableTributes = getCards(state, player, "monsterZone").filter((card) => isMonsterLike(card) && canReleaseMaterial(card.uid));
  const actions: DuelAction[] = [];
  for (const card of hand.filter((candidate) => candidate.kind === "monster")) {
    const tributeRange = tributeRangeForNormalSummon(card);
    if (tributeRange.max <= 0 || availableTributes.reduce((sum, material) => sum + tributeUnitCount(state, material), 0) < tributeRange.min) continue;
    for (let tributeCount = Math.max(1, tributeRange.min); tributeCount <= tributeRange.max; tributeCount += 1) {
      for (const tributeUids of tributeCombinations(state, availableTributes, tributeCount)) {
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
    .concat(getCards(state, player, "monsterZone").filter((card) => isMonsterLike(card) && canUseMaterial(card.uid)));
  return extraDeckSummonActions(state, player, materialPool, "fusionSummon", "Fusion", (card) => card.data.fusionMaterials);
}

export function synchroSummonActions(state: DuelState, player: PlayerId, canUseMaterial: DuelMaterialPredicate = () => true): DuelAction[] {
  const materialPool = getCards(state, player, "monsterZone").filter((card) => isMonsterLike(card) && canUseMaterial(card.uid));
  const actions: DuelAction[] = [];
  for (const card of getCards(state, player, "extraDeck")) {
    if (!isMonsterLike(card)) continue;
    const materialUids = findSynchroMaterialUids(materialPool, card);
    if (!materialUids || !hasSummonZoneAfterMaterials(state, player, materialUids)) continue;
    const materialNames = materialUids.map((materialUid) => findCard(state, materialUid)?.name ?? materialUid).join(", ");
    actions.push({ type: "synchroSummon", player, uid: card.uid, materialUids, label: `Synchro Summon ${card.name} using ${materialNames}` });
  }
  return actions;
}

export function xyzSummonActions(state: DuelState, player: PlayerId, canUseMaterial: (uid: string) => boolean = () => true): DuelAction[] {
  const materialPool = getCards(state, player, "monsterZone").filter((card) => isMonsterLike(card) && canUseMaterial(card.uid));
  const actions: DuelAction[] = [];
  for (const card of getCards(state, player, "extraDeck")) {
    if (!isMonsterLike(card)) continue;
    const materialUids = findXyzMaterialUids(materialPool, card);
    if (!materialUids || !hasSummonZoneAfterMaterials(state, player, materialUids)) continue;
    const materialNames = materialUids.map((materialUid) => findCard(state, materialUid)?.name ?? materialUid).join(", ");
    actions.push({ type: "xyzSummon", player, uid: card.uid, materialUids, label: `Xyz Summon ${card.name} using ${materialNames}` });
  }
  return actions;
}

export function linkSummonActions(state: DuelState, player: PlayerId, canUseMaterial: DuelMaterialPredicate = () => true): DuelAction[] {
  const materialPool = getCards(state, player, "monsterZone").filter((card) => isMonsterLike(card) && canUseMaterial(card.uid));
  const actions: DuelAction[] = [];
  for (const card of getCards(state, player, "extraDeck")) {
    if (!isMonsterLike(card)) continue;
    const materialUids = findLinkMaterialUids(materialPool, card);
    if (!materialUids || !hasSummonZoneAfterMaterials(state, player, materialUids)) continue;
    const materialNames = materialUids.map((materialUid) => findCard(state, materialUid)?.name ?? materialUid).join(", ");
    actions.push({ type: "linkSummon", player, uid: card.uid, materialUids, label: `Link Summon ${card.name} using ${materialNames}` });
  }
  return actions;
}

export function ritualSummonActions(state: DuelState, player: PlayerId, hand: DuelCardInstance[], canUseMaterial: DuelMaterialPredicate = () => true): DuelAction[] {
  const materialPool = hand
    .filter((card) => card.kind === "monster" && canUseMaterial(card.uid))
    .concat(getCards(state, player, "monsterZone").filter((card) => isMonsterLike(card) && canUseMaterial(card.uid)));
  const actions: DuelAction[] = [];
  for (const card of hand.filter((candidate) => candidate.kind === "monster" && candidate.data.ritualMaterials?.length)) {
    const materialUids = findSummonMaterialUids(state, player, materialPool.filter((material) => material.uid !== card.uid), card.data.ritualMaterials ?? []);
    if (!materialUids || !hasSummonZoneAfterMaterials(state, player, materialUids)) continue;
    const materialNames = materialUids.map((materialUid) => findCard(state, materialUid)?.name ?? materialUid).join(", ");
    actions.push({ type: "ritualSummon", player, uid: card.uid, materialUids, label: `Ritual Summon ${card.name} using ${materialNames}` });
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
    if (!isMonsterLike(card)) continue;
    const requiredCodes = materialCodes(card);
    if (!requiredCodes?.length) continue;
    const materialUids = findSummonMaterialUids(state, player, materialPool, requiredCodes);
    if (!materialUids) continue;
    const materialNames = materialUids.map((materialUid) => findCard(state, materialUid)?.name ?? materialUid).join(", ");
    actions.push({ type, player, uid: card.uid, materialUids, label: `${label} Summon ${card.name} using ${materialNames}` });
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

function tributeCombinations(state: DuelState, cards: DuelCardInstance[], count: number): string[][] {
  if (count === 0) return [[]];
  if (cards.reduce((sum, card) => sum + tributeUnitCount(state, card), 0) < count) return [];
  const results: string[][] = [];
  for (let index = 0; index < cards.length; index += 1) {
    const head = cards[index];
    if (!head) continue;
    const remaining = count - tributeUnitCount(state, head);
    if (remaining < 0) continue;
    for (const tail of tributeCombinations(state, cards.slice(index + 1), remaining)) {
      results.push([head.uid, ...tail]);
    }
  }
  return results;
}

function findMaterialUids(cards: DuelCardInstance[], requiredCodes: string[]): string[] | undefined {
  const used = new Set<string>();
  const selected: string[] = [];
  for (const code of requiredCodes) {
    const material = cards.find((card) => cardMatchesCode(card, code) && !used.has(card.uid));
    if (!material) return undefined;
    used.add(material.uid);
    selected.push(material.uid);
  }
  return selected;
}

function findSummonMaterialUids(state: DuelState, player: PlayerId, cards: DuelCardInstance[], requiredCodes: string[]): string[] | undefined {
  const direct = findMaterialUids(cards, requiredCodes);
  if (direct && hasSummonZoneAfterMaterials(state, player, direct)) return direct;
  for (const materials of cardCombinations(cards, requiredCodes.length)) {
    if (!materialCodesMatch(materials, requiredCodes)) continue;
    const materialUids = findMaterialUids(materials, requiredCodes);
    if (!materialUids) continue;
    if (hasSummonZoneAfterMaterials(state, player, materialUids)) return materialUids;
  }
  return undefined;
}

function hasSummonZoneAfterMaterials(state: DuelState, player: PlayerId, materialUids: string[]): boolean {
  if (hasZoneSpace(state, player, "monsterZone")) return true;
  return materialUids.some((uid) => {
    const material = findCard(state, uid);
    return material?.controller === player && material.location === "monsterZone";
  });
}

function requireSummonZoneAfterMaterials(state: DuelState, player: PlayerId, materialUids: string[]): void {
  if (!hasSummonZoneAfterMaterials(state, player, materialUids)) requireZoneSpace(state, player, "monsterZone");
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
  if (!isMonsterLike(card)) throw new Error(`${card.name} is not a ${summonType} monster`);
  if (!requiredMaterials?.length) throw new Error(`${card.name} does not define ${summonType} materials`);
  if (new Set(materialUids).size !== materialUids.length) throw new Error(`${card.name} ${summonType} materials must be unique`);
  const materials = materialUids.map((materialUid) => requireControlledCard(state, player, materialUid));
  if (!materialCodesMatch(materials, requiredMaterials)) throw new Error(`${card.name} ${summonType} materials are not legal`);
  for (const material of materials) {
    if (!allowedLocations.includes(material.location) || !isMonsterLike(material)) throw new Error(`${material.name} cannot be used as ${summonType} material`);
    if (!canUseMaterial(material.uid)) throw new Error(`${material.name} cannot be used as ${summonType} material`);
  }
  requireSummonZoneAfterMaterials(state, player, materialUids);
  return { card, materials };
}

function requireSynchroSummonMaterials(state: DuelState, player: PlayerId, uid: string, materialUids: string[], canUseMaterial: DuelMaterialPredicate): { card: DuelCardInstance; materials: DuelCardInstance[] } {
  const card = requireControlledCard(state, player, uid, "extraDeck");
  if (!isMonsterLike(card)) throw new Error(`${card.name} is not a synchro monster`);
  if (new Set(materialUids).size !== materialUids.length) throw new Error(`${card.name} synchro materials must be unique`);
  const materials = materialUids.map((materialUid) => requireControlledCard(state, player, materialUid));
  if (!materials.length) throw new Error(`${card.name} synchro materials are not legal`);
  const requiredCodes = synchroMaterialCodes(card);
  if (requiredCodes?.length) {
    if (!materialCodesMatch(materials, requiredCodes)) throw new Error(`${card.name} synchro materials are not legal`);
  } else if (!canGenericSynchroMaterialsMatch(card, materials)) {
    throw new Error(`${card.name} synchro materials are not legal`);
  }
  for (const material of materials) {
    if (material.location !== "monsterZone" || !isMonsterLike(material)) throw new Error(`${material.name} cannot be used as synchro material`);
    if (!canUseMaterial(material.uid)) throw new Error(`${material.name} cannot be used as synchro material`);
  }
  requireSummonZoneAfterMaterials(state, player, materialUids);
  return { card, materials };
}

function requireXyzSummonMaterials(state: DuelState, player: PlayerId, uid: string, materialUids: string[]): { card: DuelCardInstance; materials: DuelCardInstance[] } {
  const card = requireControlledCard(state, player, uid, "extraDeck");
  if (!isMonsterLike(card)) throw new Error(`${card.name} is not an Xyz monster`);
  if (new Set(materialUids).size !== materialUids.length) throw new Error(`${card.name} Xyz materials must be unique`);
  const materials = materialUids.map((materialUid) => requireControlledCard(state, player, materialUid));
  if (!materials.length) throw new Error(`${card.name} Xyz materials are not legal`);
  if (card.data.xyzMaterials?.length) {
    if (!materialCodesMatch(materials, card.data.xyzMaterials)) throw new Error(`${card.name} Xyz materials are not legal`);
  } else if (!canGenericXyzMaterialsMatch(card, materials)) {
    throw new Error(`${card.name} Xyz materials are not legal`);
  }
  for (const material of materials) {
    if (material.location !== "monsterZone" || !isMonsterLike(material)) throw new Error(`${material.name} cannot be used as Xyz material`);
  }
  requireSummonZoneAfterMaterials(state, player, materialUids);
  return { card, materials };
}

function requireLinkSummonMaterials(state: DuelState, player: PlayerId, uid: string, materialUids: string[], canUseMaterial: DuelMaterialPredicate): { card: DuelCardInstance; materials: DuelCardInstance[] } {
  const card = requireControlledCard(state, player, uid, "extraDeck");
  if (!isMonsterLike(card)) throw new Error(`${card.name} is not a Link monster`);
  const targetRating = linkRating(card);
  if (targetRating <= 0) throw new Error(`${card.name} does not define Link materials`);
  if (new Set(materialUids).size !== materialUids.length) throw new Error(`${card.name} Link materials must be unique`);
  const materials = materialUids.map((materialUid) => requireControlledCard(state, player, materialUid));
  if (!materials.length) throw new Error(`${card.name} Link materials are not legal`);
  if (!linkMaterialCodesMatch(materials, card.data.linkMaterials)) throw new Error(`${card.name} Link materials are not legal`);
  if (!canLinkMaterialsMatchRating(materials, targetRating)) throw new Error(`${card.name} Link materials are not legal`);
  for (const material of materials) {
    if (material.location !== "monsterZone" || !isMonsterLike(material)) throw new Error(`${material.name} cannot be used as Link material`);
    if (!canUseMaterial(material.uid)) throw new Error(`${material.name} cannot be used as Link material`);
  }
  requireSummonZoneAfterMaterials(state, player, materialUids);
  return { card, materials };
}

function cardDataMaterials(state: DuelState, player: PlayerId, uid: string, summonType: ExtraDeckSummonType): string[] | undefined {
  const card = requireControlledCard(state, player, uid, "extraDeck");
  if (summonType === "fusion") return card.data.fusionMaterials;
  if (summonType === "Xyz") return card.data.xyzMaterials;
  return card.data.linkMaterials;
}

function findLinkMaterialUids(materialPool: DuelCardInstance[], card: DuelCardInstance): string[] | undefined {
  const targetRating = linkRating(card);
  if (targetRating <= 0) return undefined;
  if (card.data.linkMaterials?.length) {
    const materialUids = findMaterialUids(materialPool, card.data.linkMaterials);
    if (!materialUids) return undefined;
    const materials = materialUids.map((materialUid) => materialPool.find((material) => material.uid === materialUid)).filter((material): material is DuelCardInstance => Boolean(material));
    return canLinkMaterialsMatchRating(materials, targetRating) ? materialUids : undefined;
  }
  for (let count = 1; count <= materialPool.length; count += 1) {
    for (const materials of cardCombinations(materialPool, count)) {
      if (canLinkMaterialsMatchRating(materials, targetRating)) return materials.map((material) => material.uid);
    }
  }
  return undefined;
}

function findSynchroMaterialUids(materialPool: DuelCardInstance[], card: DuelCardInstance): string[] | undefined {
  const requiredCodes = synchroMaterialCodes(card);
  if (requiredCodes?.length) return findMaterialUids(materialPool, requiredCodes);
  for (let count = 2; count <= materialPool.length; count += 1) {
    for (const materials of cardCombinations(materialPool, count)) {
      if (canGenericSynchroMaterialsMatch(card, materials)) return materials.map((material) => material.uid);
    }
  }
  return undefined;
}

function findXyzMaterialUids(materialPool: DuelCardInstance[], card: DuelCardInstance): string[] | undefined {
  if (card.data.xyzMaterials?.length) return findMaterialUids(materialPool, card.data.xyzMaterials);
  for (const materials of cardCombinations(materialPool, 2)) {
    if (canGenericXyzMaterialsMatch(card, materials)) return materials.map((material) => material.uid);
  }
  return undefined;
}

function canGenericSynchroMaterialsMatch(card: DuelCardInstance, materials: DuelCardInstance[]): boolean {
  const targetLevel = synchroLevel(card);
  if (targetLevel <= 0 || materials.length < 2) return false;
  if (materials.filter((material) => isTuner(material)).length !== 1) return false;
  return materials.reduce((total, material) => total + (material.data.level ?? 0), 0) === targetLevel;
}

function synchroLevel(card: DuelCardInstance): number {
  return ((card.data.typeFlags ?? 0) & 0x2000) !== 0 ? card.data.level ?? 0 : 0;
}

function canGenericXyzMaterialsMatch(card: DuelCardInstance, materials: DuelCardInstance[]): boolean {
  const targetRank = xyzRank(card);
  return targetRank > 0 && materials.length === 2 && materials.every((material) => (material.data.level ?? 0) === targetRank);
}

function xyzRank(card: DuelCardInstance): number {
  return ((card.data.typeFlags ?? 0) & 0x800000) !== 0 ? card.data.level ?? 0 : 0;
}

function isTuner(card: DuelCardInstance): boolean {
  return ((card.data.typeFlags ?? 0) & 0x1000) !== 0;
}

function linkMaterialCodesMatch(materials: DuelCardInstance[], requiredCodes: string[] | undefined): boolean {
  return !requiredCodes?.length || materialCodesMatch(materials, requiredCodes);
}

function canLinkMaterialsMatchRating(materials: DuelCardInstance[], targetRating: number): boolean {
  if (materials.length === 0 || materials.length > targetRating) return false;
  return linkRatingChoicesMatch(materials.map(linkMaterialRatings), targetRating, 0, 0);
}

function linkRatingChoicesMatch(choices: number[][], targetRating: number, index: number, currentRating: number): boolean {
  if (index >= choices.length) return currentRating === targetRating;
  for (const rating of choices[index] ?? []) {
    if (currentRating + rating <= targetRating && linkRatingChoicesMatch(choices, targetRating, index + 1, currentRating + rating)) return true;
  }
  return false;
}

function linkMaterialRatings(card: DuelCardInstance): number[] {
  const rating = linkRating(card);
  return rating > 1 ? [1, rating] : [1];
}

function linkRating(card: DuelCardInstance): number {
  if (!card.data.linkMaterials?.length && ((card.data.typeFlags ?? 0) & 0x4000000) === 0) return 0;
  if (card.data.level !== undefined) return card.data.level;
  return card.data.linkMaterials?.length ?? 0;
}

function synchroMaterialCodes(card: DuelCardInstance): string[] | undefined {
  const materials = card.data.synchroMaterials;
  return materials ? [materials.tuner, ...materials.nonTuners] : undefined;
}
