import { hasZoneSpace, moveDuelCard } from "#duel/card-state.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardInstance, DuelEffectDefinition, DuelState, PlayerId } from "#duel/types.js";

const luaEffectTypeActivate = 0x10;
const luaEffectRemainField = 17;
const typePendulum = 0x1000000;
const typeContinuous = 0x20000;
const typeEquip = 0x40000;
const typeField = 0x80000;

export function placeActivatedSpellTrapCard(state: DuelState, player: PlayerId, source: DuelCardInstance, effect: DuelEffectDefinition): void {
  if (!isSpellTrapCardActivation(source, effect)) return;
  if (source.location === "hand") {
    if (isPendulumCard(source) && !hasPendulumZoneSpace(state, player)) throw new Error(`${source.name} cannot be activated because the Pendulum Zones are full`);
    if (!hasZoneSpace(state, player, "spellTrapZone")) throw new Error(`${source.name} cannot be activated because the Spell & Trap Zone is full`);
    moveDuelCard(state, source.uid, "spellTrapZone", player, duelReason.rule, player);
    return;
  }
  if (source.location === "spellTrapZone") source.faceUp = true;
}

export function shouldSendActivatedSpellTrapToGraveyard(state: DuelState, source: DuelCardInstance, effect: DuelEffectDefinition, activationNegated = false): boolean {
  return (
    source.location === "spellTrapZone" &&
    !source.cancelToGrave &&
    isSpellTrapCardActivation(source, effect) &&
    !isPersistentSpellTrap(source) &&
    (activationNegated || source.cancelToGrave === false || !hasRemainFieldEffect(state, source))
  );
}

export function canActivateSpellTrapCardEffect(state: DuelState, player: PlayerId, source: DuelCardInstance, effect: DuelEffectDefinition): boolean {
  if (!isSpellTrapCardActivation(source, effect)) return true;
  if (source.location === "hand") {
    if (!hasZoneSpace(state, player, "spellTrapZone")) return false;
    return !isPendulumCard(source) || hasPendulumZoneSpace(state, player);
  }
  return source.location !== "spellTrapZone" || !source.faceUp;
}

function isSpellTrapCardActivation(source: DuelCardInstance, effect: DuelEffectDefinition): boolean {
  return (source.kind === "spell" || source.kind === "trap" || isPendulumCard(source)) && ((effect.luaTypeFlags ?? 0) & luaEffectTypeActivate) !== 0;
}

function hasRemainFieldEffect(state: DuelState, source: DuelCardInstance): boolean {
  return state.effects.some((effect) => effect.event === "continuous" && effect.code === luaEffectRemainField && effect.sourceUid === source.uid && effect.range.includes(source.location));
}

function isPersistentSpellTrap(source: DuelCardInstance): boolean {
  return isPendulumCard(source) || ((source.data.typeFlags ?? 0) & (typeContinuous | typeEquip | typeField)) !== 0;
}

function isPendulumCard(source: DuelCardInstance): boolean {
  return ((source.data.typeFlags ?? 0) & typePendulum) !== 0;
}

function hasPendulumZoneSpace(state: DuelState, player: PlayerId): boolean {
  return state.cards.filter((card) => card.controller === player && card.location === "spellTrapZone" && (card.sequence === 0 || card.sequence === 1)).length < 2;
}
