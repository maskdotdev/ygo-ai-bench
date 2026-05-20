import { moveDuelCard } from "#duel/card-state.js";
import { isMaterialUsePrevented, type ContinuousEffectContextFactory } from "#duel/continuous-effects.js";
import { currentCardMatchesCode, currentCardMatchesSetcode } from "#duel/card-code-state.js";
import { cardTypeFlags, currentAttribute, currentLevel, currentRace } from "#duel/card-stats.js";
import { availableForcedMonsterZoneCount } from "#duel/forced-monster-zones.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";

type SynchroMaterialCodes = { tuner: string; nonTuners: string[] };

export function canLuaSynchroSummonCard(session: DuelSession, card: DuelCardInstance, suppliedUids: string[]): boolean {
  return findLuaSynchroMaterialUidSet(session, card, suppliedUids) !== undefined;
}

export function findLuaSynchroMaterialUidSet(session: DuelSession, card: DuelCardInstance, suppliedUids: string[]): string[] | undefined {
  if (card.location !== "extraDeck" || !isMonsterLike(session, card)) return undefined;
  const supplied = new Set(suppliedUids);
  const materialPool = uniqueCards([
    ...session.state.cards.filter((candidate) => candidate.controller === card.controller && candidate.location === "monsterZone" && canBeSynchroMaterial(session, candidate, card)),
    ...suppliedUids
      .map((uid) => session.state.cards.find((candidate) => candidate.uid === uid))
      .filter((candidate): candidate is DuelCardInstance => Boolean(candidate && candidate.controller === card.controller && canBeSynchroMaterial(session, candidate, card))),
  ]);
  if ([...supplied].some((uid) => !materialPool.some((candidate) => candidate.uid === uid))) return undefined;
  const explicitMaterials = card.data.synchroMaterials;
  for (let count = Math.max(2, supplied.size); count <= materialPool.length; count += 1) {
    for (const materials of cardCombinations(materialPool, count)) {
      if ([...supplied].some((uid) => !materials.some((material) => material.uid === uid))) continue;
      if ((explicitMaterials ? synchroMaterialRolesMatch(session, materials, explicitMaterials) : canGenericSynchroMaterialsMatch(session, card, materials)) && hasSummonZoneAfterMaterials(session, card.controller, materials, card)) return materials.map((material) => material.uid);
    }
  }
  return undefined;
}

function uniqueCards(cards: DuelCardInstance[]): DuelCardInstance[] {
  const seen = new Set<string>();
  const unique: DuelCardInstance[] = [];
  for (const card of cards) {
    if (seen.has(card.uid)) continue;
    seen.add(card.uid);
    unique.push(card);
  }
  return unique;
}

function hasSummonZoneAfterMaterials(session: DuelSession, player: PlayerId, materials: DuelCardInstance[], card: DuelCardInstance): boolean {
  return availableForcedMonsterZoneCount(session.state, player, materials.map((material) => material.uid), 0, duelReason.summon | duelReason.specialSummon | duelReason.synchro, card) > 0;
}

function canBeSynchroMaterial(session: DuelSession, card: DuelCardInstance, target: DuelCardInstance): boolean {
  if (!isMonsterLike(session, card) || card.uid === target.uid) return false;
  return targetAllowsMaterial(session, target, card) && !isMaterialUsePrevented(session.state, card.uid, "synchro", createMaterialCheckContext(session));
}

function targetAllowsMaterial(session: DuelSession, target: DuelCardInstance, card: DuelCardInstance): boolean {
  const materials = target.data.synchroMaterials;
  if (materials) {
    if (isTuner(session, card)) return currentCardMatchesCode(card, session.state, materials.tuner);
    return materials.nonTuners.some((code) => currentCardMatchesCode(card, session.state, code));
  }
  const targetLevel = (cardTypeFlags(target, session.state) & 0x2000) !== 0 ? currentLevel(target, session.state) : 0;
  const materialLevel = currentLevel(card, session.state);
  if (isTuner(session, card) && (!synchroTunerLevelMatches(session, target, card) || !synchroTunerAttributeMatches(session, target, card) || !synchroTunerRaceMatches(session, target, card) || !synchroTunerTypeMatches(session, target, card) || !synchroTunerSetcodeMatches(session, target, card))) return false;
  if (!isTuner(session, card) && (!synchroNonTunerAttributeMatches(session, target, card) || !synchroNonTunerRaceMatches(session, target, card) || !synchroNonTunerTypeMatches(session, target, card) || !synchroNonTunerSetcodeMatches(session, target, card))) return false;
  return targetLevel > 0 && materialLevel > 0 && materialLevel < targetLevel;
}

function canGenericSynchroMaterialsMatch(session: DuelSession, card: DuelCardInstance, materials: DuelCardInstance[]): boolean {
  const targetLevel = (cardTypeFlags(card, session.state) & 0x2000) !== 0 ? currentLevel(card, session.state) : 0;
  if (targetLevel <= 0 || materials.length < 2) return false;
  if (!synchroMaterialCountsAllowed(session, card, materials)) return false;
  if (!materials.every((material) => !isTuner(session, material) || (synchroTunerLevelMatches(session, card, material) && synchroTunerAttributeMatches(session, card, material) && synchroTunerRaceMatches(session, card, material) && synchroTunerTypeMatches(session, card, material) && synchroTunerSetcodeMatches(session, card, material)))) return false;
  if (!materials.every((material) => isTuner(session, material) || (synchroNonTunerAttributeMatches(session, card, material) && synchroNonTunerRaceMatches(session, card, material) && synchroNonTunerTypeMatches(session, card, material) && synchroNonTunerSetcodeMatches(session, card, material)))) return false;
  return materials.reduce((total, material) => total + currentLevel(material, session.state), 0) === targetLevel;
}

function synchroMaterialRolesMatch(session: DuelSession, materials: DuelCardInstance[], required: SynchroMaterialCodes): boolean {
  const tuner = materials.find((material) => isTuner(session, material) && currentCardMatchesCode(material, session.state, required.tuner));
  if (!tuner) return false;
  const nonTuners = materials.filter((material) => material.uid !== tuner.uid && !isTuner(session, material));
  return nonTuners.length === materials.length - 1 && materialCodesMatch(session, nonTuners, required.nonTuners);
}

function materialCodesMatch(session: DuelSession, materials: DuelCardInstance[], requiredCodes: string[]): boolean {
  if (materials.length !== requiredCodes.length) return false;
  const used = new Set<string>();
  for (const code of requiredCodes) {
    const material = materials.find((candidate) => !used.has(candidate.uid) && currentCardMatchesCode(candidate, session.state, code));
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

function isTuner(session: DuelSession, card: DuelCardInstance): boolean {
  return (cardTypeFlags(card, session.state) & 0x1000) !== 0;
}

function synchroMaterialCountsAllowed(session: DuelSession, card: DuelCardInstance, materials: DuelCardInstance[]): boolean {
  const tunerCount = materials.filter((material) => isTuner(session, material)).length;
  const nonTunerCount = materials.length - tunerCount;
  const tunerMin = card.data.synchroTunerMin ?? 1;
  const tunerMax = card.data.synchroTunerMax ?? 1;
  const nonTunerMin = card.data.synchroNonTunerMin ?? 1;
  const nonTunerMax = card.data.synchroNonTunerMax ?? Number.POSITIVE_INFINITY;
  return tunerCount >= tunerMin && tunerCount <= tunerMax && nonTunerCount >= nonTunerMin && nonTunerCount <= nonTunerMax;
}

function synchroTunerAttributeMatches(session: DuelSession, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.synchroTunerAttribute === undefined || (currentAttribute(material, session.state) & target.data.synchroTunerAttribute) !== 0;
}

function synchroTunerLevelMatches(session: DuelSession, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.synchroTunerLevel === undefined || currentLevel(material, session.state) === target.data.synchroTunerLevel;
}

function synchroTunerRaceMatches(session: DuelSession, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.synchroTunerRace === undefined || (currentRace(material, session.state) & target.data.synchroTunerRace) !== 0;
}

function synchroTunerTypeMatches(session: DuelSession, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.synchroTunerType === undefined || (cardTypeFlags(material, session.state) & target.data.synchroTunerType) !== 0;
}

function synchroTunerSetcodeMatches(session: DuelSession, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.synchroTunerSetcode === undefined || currentCardMatchesSetcode(material, session.state, target.data.synchroTunerSetcode);
}

function synchroNonTunerAttributeMatches(session: DuelSession, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.synchroNonTunerAttribute === undefined || (currentAttribute(material, session.state) & target.data.synchroNonTunerAttribute) !== 0;
}

function synchroNonTunerRaceMatches(session: DuelSession, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.synchroNonTunerRace === undefined || (currentRace(material, session.state) & target.data.synchroNonTunerRace) !== 0;
}

function synchroNonTunerTypeMatches(session: DuelSession, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.synchroNonTunerType === undefined || (cardTypeFlags(material, session.state) & target.data.synchroNonTunerType) !== 0;
}

function synchroNonTunerSetcodeMatches(session: DuelSession, target: DuelCardInstance, material: DuelCardInstance): boolean {
  return target.data.synchroNonTunerSetcode === undefined || currentCardMatchesSetcode(material, session.state, target.data.synchroNonTunerSetcode);
}

function isMonsterLike(session: DuelSession, card: DuelCardInstance): boolean {
  return (cardTypeFlags(card, session.state) & 0x1) !== 0;
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
