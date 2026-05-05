import type { DuelEventName } from "#duel/types.js";

export const duelEventNames = new Set<DuelEventName>([
  "normalSummoning", "normalSummonNegated", "normalSummoned", "flipSummoning", "flipSummonNegated", "specialSummoning", "specialSummonNegated", "specialSummoned", "monsterSet", "spellTrapSet", "activated", "moved", "destroying", "destroyed", "becameTarget", "sentToGraveyard", "sentToHand", "sentToDeck", "released", "discarded", "leftField", "banished", "phaseChanged", "phaseDraw", "phaseStandby", "phaseMain1", "phaseBattle", "phaseMain2", "phaseEnd", "phaseStartDraw", "phaseStartStandby", "phaseStartMain1", "phaseStartBattle", "phaseStartMain2", "phaseStartEnd", "turnEnded", "turnStarted", "startup", "adjust", "chainSolved", "chainSolving", "chainActivating", "chaining", "chainNegated", "chainDisabled", "chainEnded", "breakEffect", "damageDealt", "recoveredLifePoints", "lifePointCostPaid", "detachedMaterial", "returnedToGraveyard", "levelChanged", "counterAdded", "counterRemoved", "customEvent", "cardsDrawn", "preDraw", "controlChanged", "equipped", "coinTossed", "diceTossed", "coinTossNegated", "diceTossNegated", "preUsedAsMaterial", "usedAsMaterial", "attackDeclared", "battleTargeted", "battleStarted", "battleConfirmed", "attackDisabled", "battleDestroyed", "beforeDamageCalculation", "afterDamageCalculation", "beforeBattleDamage", "battleDamageDealt", "damageStepEnded", "positionChanged", "flipSummoned",
]);

export function isDuelEventName(value: unknown): value is DuelEventName {
  return duelEventNames.has(value as DuelEventName);
}
