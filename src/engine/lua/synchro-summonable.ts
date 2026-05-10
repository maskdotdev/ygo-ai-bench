import { hasZoneSpace, moveDuelCard } from "#duel/card-state.js";
import { isMaterialUsePrevented, type ContinuousEffectContextFactory } from "#duel/continuous-effects.js";
import type { DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";

type SynchroMaterialCodes = { tuner: string; nonTuners: string[] };

export function canLuaSynchroSummonCard(session: DuelSession, card: DuelCardInstance, suppliedUids: string[]): boolean {
  if (card.location !== "extraDeck" || !isMonsterLike(card)) return false;
  const supplied = new Set(suppliedUids);
  const materialPool = session.state.cards.filter((candidate) => candidate.controller === card.controller && candidate.location === "monsterZone" && canBeSynchroMaterial(session, candidate, card));
  if ([...supplied].some((uid) => !materialPool.some((candidate) => candidate.uid === uid))) return false;
  const explicitMaterials = card.data.synchroMaterials;
  for (let count = Math.max(2, supplied.size); count <= materialPool.length; count += 1) {
    for (const materials of cardCombinations(materialPool, count)) {
      if ([...supplied].some((uid) => !materials.some((material) => material.uid === uid))) continue;
      if ((explicitMaterials ? synchroMaterialRolesMatch(materials, explicitMaterials) : canGenericSynchroMaterialsMatch(card, materials)) && hasSummonZoneAfterMaterials(session, card.controller, materials)) return true;
    }
  }
  return false;
}

function hasSummonZoneAfterMaterials(session: DuelSession, player: PlayerId, materials: DuelCardInstance[]): boolean {
  return hasZoneSpace(session.state, player, "monsterZone") || materials.some((material) => material.controller === player && material.location === "monsterZone");
}

function canBeSynchroMaterial(session: DuelSession, card: DuelCardInstance, target: DuelCardInstance): boolean {
  if (!isMonsterLike(card) || card.uid === target.uid) return false;
  return targetAllowsMaterial(target, card) && !isMaterialUsePrevented(session.state, card.uid, "synchro", createMaterialCheckContext(session));
}

function targetAllowsMaterial(target: DuelCardInstance, card: DuelCardInstance): boolean {
  const materials = target.data.synchroMaterials;
  if (materials) {
    if (isTuner(card)) return cardCodes(card).includes(materials.tuner);
    return materials.nonTuners.some((code) => cardCodes(card).includes(code));
  }
  const targetLevel = (cardTypeFlags(target) & 0x2000) !== 0 ? target.data.level ?? 0 : 0;
  const materialLevel = card.data.level ?? 0;
  if (isTuner(card) && (!synchroTunerAttributeMatches(target, card) || !synchroTunerRaceMatches(target, card))) return false;
  return targetLevel > 0 && materialLevel > 0 && materialLevel < targetLevel;
}

function canGenericSynchroMaterialsMatch(card: DuelCardInstance, materials: DuelCardInstance[]): boolean {
  const targetLevel = (cardTypeFlags(card) & 0x2000) !== 0 ? card.data.level ?? 0 : 0;
  if (targetLevel <= 0 || materials.length < 2) return false;
  if (!synchroMaterialCountsAllowed(card, materials)) return false;
  if (!materials.every((material) => !isTuner(material) || (synchroTunerAttributeMatches(card, material) && synchroTunerRaceMatches(card, material)))) return false;
  return materials.reduce((total, material) => total + (material.data.level ?? 0), 0) === targetLevel;
}

function synchroMaterialRolesMatch(materials: DuelCardInstance[], required: SynchroMaterialCodes): boolean {
  const tuner = materials.find((material) => isTuner(material) && cardCodes(material).includes(required.tuner));
  if (!tuner) return false;
  const nonTuners = materials.filter((material) => material.uid !== tuner.uid && !isTuner(material));
  return nonTuners.length === materials.length - 1 && materialCodesMatch(nonTuners, required.nonTuners);
}

function materialCodesMatch(materials: DuelCardInstance[], requiredCodes: string[]): boolean {
  if (materials.length !== requiredCodes.length) return false;
  const used = new Set<string>();
  for (const code of requiredCodes) {
    const material = materials.find((candidate) => !used.has(candidate.uid) && cardCodes(candidate).includes(code));
    if (!material) return false;
    used.add(material.uid);
  }
  return used.size === materials.length;
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

function cardCodes(card: DuelCardInstance): string[] {
  return [card.code, ...(card.data.alias ? [card.data.alias] : [])];
}

function cardTypeFlags(card: DuelCardInstance): number {
  return card.data.typeFlags ?? (card.kind === "spell" ? 0x2 : card.kind === "trap" ? 0x4 : 0x1);
}

function isTuner(card: DuelCardInstance): boolean {
  return (cardTypeFlags(card) & 0x1000) !== 0;
}

function synchroMaterialCountsAllowed(card: DuelCardInstance, materials: DuelCardInstance[]): boolean {
  const tunerCount = materials.filter((material) => isTuner(material)).length;
  const nonTunerCount = materials.length - tunerCount;
  const tunerMin = card.data.synchroTunerMin ?? 1;
  const tunerMax = card.data.synchroTunerMax ?? 1;
  const nonTunerMin = card.data.synchroNonTunerMin ?? 1;
  const nonTunerMax = card.data.synchroNonTunerMax ?? Number.POSITIVE_INFINITY;
  return tunerCount >= tunerMin && tunerCount <= tunerMax && nonTunerCount >= nonTunerMin && nonTunerCount <= nonTunerMax;
}

function synchroTunerAttributeMatches(target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.synchroTunerAttribute === undefined || ((material.data.attribute ?? 0) & target.data.synchroTunerAttribute) !== 0;
}

function synchroTunerRaceMatches(target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.synchroTunerRace === undefined || ((material.data.race ?? 0) & target.data.synchroTunerRace) !== 0;
}

function isMonsterLike(card: DuelCardInstance): boolean {
  return (cardTypeFlags(card) & 0x1) !== 0;
}

function createMaterialCheckContext(session: DuelSession): ContinuousEffectContextFactory {
  return (effect, source) => ({
    duel: session.state,
    source,
    player: effect.controller,
    checkOnly: true,
    targetUids: [],
    log() {},
    moveCard(uid, to, controller) {
      return moveDuelCard(session.state, uid, to, controller);
    },
    negateChainLink() {
      return false;
    },
    setTargets() {},
    getTargets() {
      return [];
    },
    setTargetPlayer() {},
    setTargetParam() {},
  });
}
