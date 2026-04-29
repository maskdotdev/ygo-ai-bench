import { findCard, getCards, hasZoneSpace, moveDuelCard, pushDuelLog, requireControlledCard, requireZoneSpace } from "./duel-card-state.js";
import { recordFlipSummonActivity, recordNormalSetActivity, recordNormalSummonActivity, recordSpecialSummonActivity } from "./duel-activity.js";
import { duelReason } from "./duel-reasons.js";
import type { DuelAction, DuelCardInstance, DuelEventName, DuelLocation, DuelState, PlayerId } from "./duel-types.js";

export type DuelEventCollector = (eventName: DuelEventName, eventCard?: DuelCardInstance) => void;
type ExtraDeckSummonType = "fusion" | "synchro" | "Xyz" | "Link";

export function normalSummon(state: DuelState, player: PlayerId, uid: string, collectEvent: DuelEventCollector): void {
  const card = requireControlledCard(state, player, uid, "hand");
  if (card.kind !== "monster") throw new Error(`${card.name} is not a monster`);
  if (tributeCountForNormalSummon(card) > 0) throw new Error(`${card.name} requires a Tribute Summon`);
  if (!state.players[player].normalSummonAvailable) throw new Error("Normal Summon is not available");
  requireZoneSpace(state, player, "monsterZone");
  moveDuelCard(state, uid, "monsterZone", player, duelReason.summon);
  card.position = "faceUpAttack";
  card.summonType = "normal";
  state.players[player].normalSummonAvailable = false;
  recordNormalSummonActivity(state, player);
  pushDuelLog(state, "normalSummon", player, card.name, "Normal Summoned from hand");
  collectEvent("normalSummoned", card);
}

export function setMonster(state: DuelState, player: PlayerId, uid: string): void {
  const card = requireControlledCard(state, player, uid, "hand");
  if (card.kind !== "monster") throw new Error(`${card.name} is not a monster`);
  if (!state.players[player].normalSummonAvailable) throw new Error("Normal Summon is not available");
  requireZoneSpace(state, player, "monsterZone");
  moveDuelCard(state, uid, "monsterZone", player, duelReason.rule);
  card.position = "faceDownDefense";
  card.faceUp = false;
  state.players[player].normalSummonAvailable = false;
  recordNormalSetActivity(state, player);
  pushDuelLog(state, "setMonster", player, card.name, "Set from hand");
}

export function tributeSummonDuelCard(state: DuelState, player: PlayerId, uid: string, tributeUids: string[], collectEvent: DuelEventCollector): void {
  const card = requireControlledCard(state, player, uid, "hand");
  if (card.kind !== "monster") throw new Error(`${card.name} is not a monster`);
  if (!state.players[player].normalSummonAvailable) throw new Error("Normal Summon is not available");
  const requiredTributes = tributeCountForNormalSummon(card);
  if (requiredTributes <= 0) throw new Error(`${card.name} does not require tributes`);
  if (tributeUids.length !== requiredTributes) throw new Error(`${card.name} requires ${requiredTributes} tribute(s)`);

  const uniqueTributes = [...new Set(tributeUids)];
  if (uniqueTributes.length !== tributeUids.length) throw new Error("Tributes must be unique");
  for (const tributeUid of uniqueTributes) requireControlledCard(state, player, tributeUid, "monsterZone");
  for (const tributeUid of uniqueTributes) {
    const tribute = moveDuelCard(state, tributeUid, "graveyard", player, duelReason.release | duelReason.summon);
    pushDuelLog(state, "release", player, tribute.name, `Tributed for ${card.name}`);
    collectEvent("sentToGraveyard", tribute);
  }

  moveDuelCard(state, uid, "monsterZone", player, duelReason.summon);
  card.position = "faceUpAttack";
  card.faceUp = true;
  card.summonType = "tribute";
  state.players[player].normalSummonAvailable = false;
  recordNormalSummonActivity(state, player);
  pushDuelLog(state, "tributeSummon", player, card.name, `Tribute Summoned with ${requiredTributes} tribute(s)`);
  collectEvent("normalSummoned", card);
}

export function flipSummonDuelCard(state: DuelState, player: PlayerId, uid: string, collectEvent: DuelEventCollector): DuelCardInstance {
  const card = requireControlledCard(state, player, uid, "monsterZone");
  if (card.position !== "faceDownDefense") throw new Error(`${card.name} is not face-down defense`);
  card.position = "faceUpAttack";
  card.faceUp = true;
  card.summonType = "flip";
  recordFlipSummonActivity(state, player);
  pushDuelLog(state, "flipSummon", player, card.name, "Flip Summoned");
  collectEvent("flipSummoned", card);
  return card;
}

export function fusionSummonDuelCard(state: DuelState, player: PlayerId, uid: string, materialUids: string[], collectEvent: DuelEventCollector): DuelCardInstance {
  const { card, materials } = requireExtraDeckSummonMaterials(state, player, uid, materialUids, cardDataMaterials(state, player, uid, "fusion"), "fusion", ["hand", "monsterZone"]);
  for (const material of materials) {
    moveDuelCard(state, material.uid, "graveyard", player, duelReason.material | duelReason.fusion);
    pushDuelLog(state, "fusionMaterial", player, material.name, `Used for ${card.name}`);
    collectEvent("sentToGraveyard", material);
  }

  moveDuelCard(state, uid, "monsterZone", player, duelReason.summon | duelReason.specialSummon | duelReason.fusion);
  card.position = "faceUpAttack";
  card.faceUp = true;
  card.summonType = "fusion";
  recordSpecialSummonActivity(state, player);
  pushDuelLog(state, "fusionSummon", player, card.name, `Fusion Summoned with ${materialUids.length} material(s)`);
  collectEvent("specialSummoned", card);
  return card;
}

export function synchroSummonDuelCard(state: DuelState, player: PlayerId, uid: string, materialUids: string[], collectEvent: DuelEventCollector): DuelCardInstance {
  const { card, materials } = requireSynchroSummonMaterials(state, player, uid, materialUids);
  for (const material of materials) {
    moveDuelCard(state, material.uid, "graveyard", player, duelReason.material | duelReason.synchro);
    pushDuelLog(state, "synchroMaterial", player, material.name, `Used for ${card.name}`);
    collectEvent("sentToGraveyard", material);
  }

  moveDuelCard(state, uid, "monsterZone", player, duelReason.summon | duelReason.specialSummon | duelReason.synchro);
  card.position = "faceUpAttack";
  card.faceUp = true;
  card.summonType = "synchro";
  recordSpecialSummonActivity(state, player);
  pushDuelLog(state, "synchroSummon", player, card.name, `Synchro Summoned with ${materialUids.length} material(s)`);
  collectEvent("specialSummoned", card);
  return card;
}

export function xyzSummonDuelCard(state: DuelState, player: PlayerId, uid: string, materialUids: string[], collectEvent: DuelEventCollector): DuelCardInstance {
  const { card, materials } = requireExtraDeckSummonMaterials(state, player, uid, materialUids, cardDataMaterials(state, player, uid, "Xyz"), "Xyz", ["monsterZone"]);
  card.overlayUids = [];
  for (const material of materials) {
    moveDuelCard(state, material.uid, "overlay", player, duelReason.material | duelReason.xyz);
    card.overlayUids.push(material.uid);
    pushDuelLog(state, "xyzMaterial", player, material.name, `Attached to ${card.name}`);
  }

  moveDuelCard(state, uid, "monsterZone", player, duelReason.summon | duelReason.specialSummon | duelReason.xyz);
  card.position = "faceUpAttack";
  card.faceUp = true;
  card.summonType = "xyz";
  recordSpecialSummonActivity(state, player);
  pushDuelLog(state, "xyzSummon", player, card.name, `Xyz Summoned with ${materialUids.length} material(s)`);
  collectEvent("specialSummoned", card);
  return card;
}

export function linkSummonDuelCard(state: DuelState, player: PlayerId, uid: string, materialUids: string[], collectEvent: DuelEventCollector): DuelCardInstance {
  const { card, materials } = requireLinkSummonMaterials(state, player, uid, materialUids);
  for (const material of materials) {
    moveDuelCard(state, material.uid, "graveyard", player, duelReason.material | duelReason.link);
    pushDuelLog(state, "linkMaterial", player, material.name, `Used for ${card.name}`);
    collectEvent("sentToGraveyard", material);
  }

  moveDuelCard(state, uid, "monsterZone", player, duelReason.summon | duelReason.specialSummon | duelReason.link);
  card.position = "faceUpAttack";
  card.faceUp = true;
  card.summonType = "link";
  recordSpecialSummonActivity(state, player);
  pushDuelLog(state, "linkSummon", player, card.name, `Link Summoned with ${materialUids.length} material(s)`);
  collectEvent("specialSummoned", card);
  return card;
}

export function ritualSummonDuelCard(state: DuelState, player: PlayerId, uid: string, materialUids: string[], collectEvent: DuelEventCollector): DuelCardInstance {
  const card = requireControlledCard(state, player, uid, "hand");
  const requiredMaterials = card.data.ritualMaterials ?? [];
  if (card.kind !== "monster") throw new Error(`${card.name} is not a ritual monster`);
  if (requiredMaterials.length === 0) throw new Error(`${card.name} does not define ritual materials`);
  if (new Set(materialUids).size !== materialUids.length) throw new Error(`${card.name} ritual materials must be unique`);
  const materials = materialUids.map((materialUid) => requireControlledCard(state, player, materialUid));
  if (materials.some((material) => material.uid === card.uid)) throw new Error(`${card.name} cannot use itself as ritual material`);
  if (!sameStringMultiset(materials.map((material) => material.code), requiredMaterials)) throw new Error(`${card.name} ritual materials are not legal`);
  for (const material of materials) {
    if (material.location !== "hand" && material.location !== "monsterZone") throw new Error(`${material.name} cannot be used as ritual material`);
  }
  requireZoneSpace(state, player, "monsterZone");

  for (const material of materials) {
    moveDuelCard(state, material.uid, "graveyard", player, duelReason.material | duelReason.ritual);
    pushDuelLog(state, "ritualMaterial", player, material.name, `Used for ${card.name}`);
    collectEvent("sentToGraveyard", material);
  }

  moveDuelCard(state, uid, "monsterZone", player, duelReason.summon | duelReason.specialSummon | duelReason.ritual);
  card.position = "faceUpAttack";
  card.faceUp = true;
  card.summonType = "ritual";
  recordSpecialSummonActivity(state, player);
  pushDuelLog(state, "ritualSummon", player, card.name, `Ritual Summoned with ${materialUids.length} material(s)`);
  collectEvent("specialSummoned", card);
  return card;
}

export function normalSummonActions(state: DuelState, player: PlayerId, hand: DuelCardInstance[]): DuelAction[] {
  if (!state.players[player].normalSummonAvailable || !hasZoneSpace(state, player, "monsterZone")) return [];
  const actions: DuelAction[] = [];
  for (const card of hand.filter((candidate) => candidate.kind === "monster")) {
    if (tributeCountForNormalSummon(card) === 0) actions.push({ type: "normalSummon", player, uid: card.uid, label: `Normal Summon ${card.name}` });
    actions.push({ type: "setMonster", player, uid: card.uid, label: `Set ${card.name}` });
  }
  return actions;
}

export function tributeSummonActions(state: DuelState, player: PlayerId, hand: DuelCardInstance[]): DuelAction[] {
  if (!state.players[player].normalSummonAvailable) return [];
  const availableTributes = getCards(state, player, "monsterZone").filter((card) => isMonsterLike(card));
  const actions: DuelAction[] = [];
  for (const card of hand.filter((candidate) => candidate.kind === "monster")) {
    const tributeCount = tributeCountForNormalSummon(card);
    if (tributeCount <= 0 || availableTributes.length < tributeCount) continue;
    for (const tributeUids of tributeCombinations(availableTributes, tributeCount)) {
      const tributeNames = tributeUids.map((tributeUid) => findCard(state, tributeUid)?.name ?? tributeUid).join(", ");
      actions.push({ type: "tributeSummon", player, uid: card.uid, tributeUids, label: `Tribute Summon ${card.name} using ${tributeNames}` });
    }
  }
  return actions;
}

export function flipSummonActions(state: DuelState, player: PlayerId): DuelAction[] {
  return getCards(state, player, "monsterZone")
    .filter((card) => card.position === "faceDownDefense")
    .map((card) => ({ type: "flipSummon", player, uid: card.uid, label: `Flip Summon ${card.name}` }));
}

export function fusionSummonActions(state: DuelState, player: PlayerId): DuelAction[] {
  if (!hasZoneSpace(state, player, "monsterZone")) return [];
  const materialPool = getCards(state, player, "hand").filter((card) => card.kind === "monster").concat(getCards(state, player, "monsterZone").filter((card) => isMonsterLike(card)));
  return extraDeckSummonActions(state, player, materialPool, "fusionSummon", "Fusion", (card) => card.data.fusionMaterials);
}

export function synchroSummonActions(state: DuelState, player: PlayerId): DuelAction[] {
  if (!hasZoneSpace(state, player, "monsterZone")) return [];
  const materialPool = getCards(state, player, "monsterZone").filter((card) => isMonsterLike(card));
  const actions: DuelAction[] = [];
  for (const card of getCards(state, player, "extraDeck")) {
    const materialUids = findSynchroMaterialUids(materialPool, card);
    if (!materialUids) continue;
    const materialNames = materialUids.map((materialUid) => findCard(state, materialUid)?.name ?? materialUid).join(", ");
    actions.push({ type: "synchroSummon", player, uid: card.uid, materialUids, label: `Synchro Summon ${card.name} using ${materialNames}` });
  }
  return actions;
}

export function xyzSummonActions(state: DuelState, player: PlayerId): DuelAction[] {
  if (!hasZoneSpace(state, player, "monsterZone")) return [];
  const materialPool = getCards(state, player, "monsterZone").filter((card) => isMonsterLike(card));
  return extraDeckSummonActions(state, player, materialPool, "xyzSummon", "Xyz", (card) => card.data.xyzMaterials);
}

export function linkSummonActions(state: DuelState, player: PlayerId): DuelAction[] {
  if (!hasZoneSpace(state, player, "monsterZone")) return [];
  const materialPool = getCards(state, player, "monsterZone").filter((card) => isMonsterLike(card));
  const actions: DuelAction[] = [];
  for (const card of getCards(state, player, "extraDeck")) {
    const materialUids = findLinkMaterialUids(materialPool, card);
    if (!materialUids) continue;
    const materialNames = materialUids.map((materialUid) => findCard(state, materialUid)?.name ?? materialUid).join(", ");
    actions.push({ type: "linkSummon", player, uid: card.uid, materialUids, label: `Link Summon ${card.name} using ${materialNames}` });
  }
  return actions;
}

export function ritualSummonActions(state: DuelState, player: PlayerId, hand: DuelCardInstance[]): DuelAction[] {
  if (!hasZoneSpace(state, player, "monsterZone")) return [];
  const materialPool = hand.filter((card) => card.kind === "monster").concat(getCards(state, player, "monsterZone").filter((card) => isMonsterLike(card)));
  const actions: DuelAction[] = [];
  for (const card of hand.filter((candidate) => candidate.kind === "monster" && candidate.data.ritualMaterials?.length)) {
    const materialUids = findMaterialUids(materialPool.filter((material) => material.uid !== card.uid), card.data.ritualMaterials ?? []);
    if (!materialUids) continue;
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
    const requiredCodes = materialCodes(card);
    if (!requiredCodes?.length) continue;
    const materialUids = findMaterialUids(materialPool, requiredCodes);
    if (!materialUids) continue;
    const materialNames = materialUids.map((materialUid) => findCard(state, materialUid)?.name ?? materialUid).join(", ");
    actions.push({ type, player, uid: card.uid, materialUids, label: `${label} Summon ${card.name} using ${materialNames}` });
  }
  return actions;
}

function tributeCountForNormalSummon(card: DuelCardInstance): number {
  const level = card.data.level ?? 4;
  if (level >= 7) return 2;
  if (level >= 5) return 1;
  return 0;
}

function tributeCombinations(cards: DuelCardInstance[], count: number): string[][] {
  if (count === 0) return [[]];
  if (cards.length < count) return [];
  if (count === 1) return cards.map((card) => [card.uid]);
  const results: string[][] = [];
  for (let index = 0; index <= cards.length - count; index += 1) {
    const head = cards[index];
    if (!head) continue;
    for (const tail of tributeCombinations(cards.slice(index + 1), count - 1)) {
      results.push([head.uid, ...tail]);
    }
  }
  return results;
}

function findMaterialUids(cards: DuelCardInstance[], requiredCodes: string[]): string[] | undefined {
  const used = new Set<string>();
  const selected: string[] = [];
  for (const code of requiredCodes) {
    const material = cards.find((card) => card.code === code && !used.has(card.uid));
    if (!material) return undefined;
    used.add(material.uid);
    selected.push(material.uid);
  }
  return selected;
}

function requireExtraDeckSummonMaterials(
  state: DuelState,
  player: PlayerId,
  uid: string,
  materialUids: string[],
  requiredMaterials: string[] | undefined,
  summonType: ExtraDeckSummonType,
  allowedLocations: DuelLocation[],
): { card: DuelCardInstance; materials: DuelCardInstance[] } {
  const card = requireControlledCard(state, player, uid, "extraDeck");
  if (!requiredMaterials?.length) throw new Error(`${card.name} does not define ${summonType} materials`);
  if (new Set(materialUids).size !== materialUids.length) throw new Error(`${card.name} ${summonType} materials must be unique`);
  const materials = materialUids.map((materialUid) => requireControlledCard(state, player, materialUid));
  if (!sameStringMultiset(materials.map((material) => material.code), requiredMaterials)) throw new Error(`${card.name} ${summonType} materials are not legal`);
  for (const material of materials) {
    if (!allowedLocations.includes(material.location)) throw new Error(`${material.name} cannot be used as ${summonType} material`);
  }
  requireZoneSpace(state, player, "monsterZone");
  return { card, materials };
}

function requireSynchroSummonMaterials(state: DuelState, player: PlayerId, uid: string, materialUids: string[]): { card: DuelCardInstance; materials: DuelCardInstance[] } {
  const card = requireControlledCard(state, player, uid, "extraDeck");
  if (new Set(materialUids).size !== materialUids.length) throw new Error(`${card.name} synchro materials must be unique`);
  const materials = materialUids.map((materialUid) => requireControlledCard(state, player, materialUid));
  if (!materials.length) throw new Error(`${card.name} synchro materials are not legal`);
  const requiredCodes = synchroMaterialCodes(card);
  if (requiredCodes?.length) {
    if (!sameStringMultiset(materials.map((material) => material.code), requiredCodes)) throw new Error(`${card.name} synchro materials are not legal`);
  } else if (!canGenericSynchroMaterialsMatch(card, materials)) {
    throw new Error(`${card.name} synchro materials are not legal`);
  }
  for (const material of materials) {
    if (material.location !== "monsterZone" || !isMonsterLike(material)) throw new Error(`${material.name} cannot be used as synchro material`);
  }
  requireZoneSpace(state, player, "monsterZone");
  return { card, materials };
}

function requireLinkSummonMaterials(state: DuelState, player: PlayerId, uid: string, materialUids: string[]): { card: DuelCardInstance; materials: DuelCardInstance[] } {
  const card = requireControlledCard(state, player, uid, "extraDeck");
  const targetRating = linkRating(card);
  if (targetRating <= 0) throw new Error(`${card.name} does not define Link materials`);
  if (new Set(materialUids).size !== materialUids.length) throw new Error(`${card.name} Link materials must be unique`);
  const materials = materialUids.map((materialUid) => requireControlledCard(state, player, materialUid));
  if (!materials.length) throw new Error(`${card.name} Link materials are not legal`);
  if (!linkMaterialCodesMatch(materials, card.data.linkMaterials)) throw new Error(`${card.name} Link materials are not legal`);
  if (!canLinkMaterialsMatchRating(materials, targetRating)) throw new Error(`${card.name} Link materials are not legal`);
  for (const material of materials) {
    if (material.location !== "monsterZone" || !isMonsterLike(material)) throw new Error(`${material.name} cannot be used as Link material`);
  }
  requireZoneSpace(state, player, "monsterZone");
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

function canGenericSynchroMaterialsMatch(card: DuelCardInstance, materials: DuelCardInstance[]): boolean {
  const targetLevel = card.data.level ?? 0;
  if (targetLevel <= 0 || materials.length < 2) return false;
  if (materials.filter((material) => isTuner(material)).length !== 1) return false;
  return materials.reduce((total, material) => total + (material.data.level ?? 0), 0) === targetLevel;
}

function isTuner(card: DuelCardInstance): boolean {
  return ((card.data.typeFlags ?? 0) & 0x1000) !== 0;
}

function linkMaterialCodesMatch(materials: DuelCardInstance[], requiredCodes: string[] | undefined): boolean {
  return !requiredCodes?.length || sameStringMultiset(materials.map((material) => material.code), requiredCodes);
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

function cardCombinations(cards: DuelCardInstance[], count: number): DuelCardInstance[][] {
  if (count === 0) return [[]];
  if (cards.length < count) return [];
  const results: DuelCardInstance[][] = [];
  for (let index = 0; index <= cards.length - count; index += 1) {
    const head = cards[index];
    if (!head) continue;
    for (const tail of cardCombinations(cards.slice(index + 1), count - 1)) results.push([head, ...tail]);
  }
  return results;
}

function synchroMaterialCodes(card: DuelCardInstance): string[] | undefined {
  const materials = card.data.synchroMaterials;
  return materials ? [materials.tuner, ...materials.nonTuners] : undefined;
}

function sameStringMultiset(actual: string[], expected: string[]): boolean {
  if (actual.length !== expected.length) return false;
  const remaining = [...expected];
  for (const value of actual) {
    const index = remaining.indexOf(value);
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return remaining.length === 0;
}

function isMonsterLike(card: DuelCardInstance): boolean {
  return card.kind === "monster" || card.kind === "extra";
}
