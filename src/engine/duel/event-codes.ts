import { phaseMask } from "#duel/phase-mask.js";
import type { DuelEventName, DuelPhase } from "#duel/types.js";

const eventCodes: Partial<Record<DuelEventName, number>> = {
  startup: 1000,
  flipSummoned: 1101,
  destroying: 1010,
  banished: 1011,
  sentToHand: 1012,
  sentToDeck: 1013,
  sentToGraveyard: 1014,
  leftField: 1015,
  positionChanged: 1016,
  released: 1017,
  discarded: 1018,
  chainSolving: 1020,
  chainActivating: 1021,
  chainSolved: 1022,
  chainNegated: 1024,
  chainDisabled: 1025,
  chainEnded: 1026,
  chaining: 1027,
  becameTarget: 1028,
  destroyed: 1029,
  moved: 1030,
  leftGraveyard: 1031,
  adjust: 1040,
  breakEffect: 1050,
  normalSummoned: 1100,
  specialSummoned: 1102,
  normalSummoning: 1103,
  flipSummoning: 1104,
  specialSummoning: 1105,
  monsterSet: 1106,
  spellTrapSet: 1107,
  usedAsMaterial: 1108,
  preUsedAsMaterial: 1109,
  cardsDrawn: 1110,
  damageDealt: 1111,
  recoveredLifePoints: 1112,
  preDraw: 1113,
  normalSummonNegated: 1114,
  flipSummonNegated: 1115,
  specialSummonNegated: 1116,
  controlChanged: 1120,
  equipped: 1121,
  attackDeclared: 1130,
  battleTargeted: 1131,
  battleStarted: 1132,
  battleConfirmed: 1133,
  beforeDamageCalculation: 1134,
  damageCalculating: 1135,
  beforeBattleDamage: 1136,
  battleEnded: 1137,
  afterDamageCalculation: 1138,
  battleDestroyed: 1140,
  damageStepEnded: 1141,
  attackDisabled: 1142,
  battleDamageDealt: 1143,
  diceTossed: 1150,
  coinTossed: 1151,
  coinTossNegated: 1152,
  diceTossNegated: 1153,
  levelChanged: 1200,
  lifePointCostPaid: 1201,
  detachedMaterial: 1202,
  returnedToGraveyard: 1203,
  turnEnded: 1210,
  confirmed: 1211,
  sentToHandConfirmed: 1212,
  counterAdded: 0x10000,
  counterRemoved: 0x20000,
};

const eventNames = new Map<number, DuelEventName>([
  [1001, "flipSummoned"],
  [1019, "leftField"],
  [1139, "battleDestroyed"],
  ...Object.entries(eventCodes).map(([name, code]) => [code, name as DuelEventName] as const),
]);

export function duelEventCode(eventName: DuelEventName): number | undefined {
  return eventCodes[eventName];
}

export function duelEventNameFromCode(code: number | undefined): DuelEventName | undefined {
  if (code === undefined) return undefined;
  if (code >= 0x10000000) return "customEvent";
  return eventNames.get(code) ?? phaseEventNameFromCode(code) ?? "customEvent";
}

export function phaseEventCode(phase: DuelPhase): number {
  if (phase === "battle") return 0x1008;
  return 0x1000 | phaseMask(phase);
}

export function phaseTimingEventCode(phase: DuelPhase): number {
  return 0x1000 | phaseMask(phase);
}

export function phaseStartEventCode(phase: DuelPhase): number {
  if (phase === "battle") return 0x2008;
  return 0x2000 | phaseMask(phase);
}

function phaseEventNameFromCode(code: number): DuelEventName | undefined {
  if (code === 0x1001) return "phaseDraw";
  if (code === 0x1002) return "phaseStandby";
  if (code === 0x1004) return "phaseMain1";
  if (code === 0x1008) return "phaseBattle";
  if (code === 0x1080) return "phaseBattle";
  if (code === 0x1100) return "phaseMain2";
  if (code === 0x1200) return "phaseEnd";
  if (code === 0x2001) return "phaseStartDraw";
  if (code === 0x2002) return "phaseStartStandby";
  if (code === 0x2004) return "phaseStartMain1";
  if (code === 0x2008) return "phaseStartBattle";
  if (code === 0x2080) return "phaseStartBattle";
  if (code === 0x2100) return "phaseStartMain2";
  if (code === 0x2200) return "phaseStartEnd";
  return undefined;
}
