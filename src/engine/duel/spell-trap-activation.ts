import { firstOpenFieldZoneSequence } from "#duel/disabled-field-zones.js";
import { hasZoneSpace, moveDuelCard } from "#duel/card-state.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardInstance, DuelEffectDefinition, DuelState, PlayerId } from "#duel/types.js";

const luaEffectTypeActivate = 0x10;
const luaEffectRemainField = 17;
const typePendulum = 0x1000000;
const typeContinuous = 0x20000;
const typeEquip = 0x40000;
const typeField = 0x80000;

export function placeActivatedSpellTrapCard(state: DuelState, player: PlayerId, source: DuelCardInstance, effect: DuelEffectDefinition, spellTrapSequence?: number): void {
  if (!isSpellTrapCardActivation(source, effect)) return;
  if (source.location === "hand") {
    if (isPendulumCard(source) && !hasPendulumZoneSpace(state, player)) throw new Error(`${source.name} cannot be activated because the Pendulum Zones are full`);
    const targetLocation = isFieldSpell(source) ? "fieldZone" : "spellTrapZone";
    if (!hasZoneSpace(state, player, targetLocation)) throw new Error(`${source.name} cannot be activated because the ${targetLocation === "fieldZone" ? "Field Zone" : "Spell & Trap Zone"} is full`);
    if (targetLocation === "fieldZone") sendExistingFieldSpellToGraveyard(state, player, source.uid);
    const sequence = targetLocation === "spellTrapZone" ? requireSpellTrapZoneSequence(state, player, spellTrapSequence) : undefined;
    moveDuelCard(state, source.uid, targetLocation, player, duelReason.rule, player);
    if (sequence !== undefined) source.sequence = sequence;
    return;
  }
  if (source.location === "spellTrapZone" || source.location === "fieldZone") source.faceUp = true;
}

export function shouldSendActivatedSpellTrapToGraveyard(state: DuelState, source: DuelCardInstance, effect: DuelEffectDefinition, activationNegated = false): boolean {
  return (
    (source.location === "spellTrapZone" || source.location === "fieldZone") &&
    !source.cancelToGrave &&
    isSpellTrapCardActivation(source, effect) &&
    !isPersistentSpellTrap(source) &&
    (activationNegated || source.cancelToGrave === false || !hasRemainFieldEffect(state, source))
  );
}

export function canActivateSpellTrapCardEffect(state: DuelState, player: PlayerId, source: DuelCardInstance, effect: DuelEffectDefinition): boolean {
  if (!isSpellTrapCardActivation(source, effect)) return true;
  if (source.location === "hand") {
    if (!hasZoneSpace(state, player, isFieldSpell(source) ? "fieldZone" : "spellTrapZone")) return false;
    return !isPendulumCard(source) || hasPendulumZoneSpace(state, player);
  }
  return (source.location !== "spellTrapZone" && source.location !== "fieldZone") || !source.faceUp;
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

function isFieldSpell(source: DuelCardInstance): boolean {
  return source.kind === "spell" && ((source.data.typeFlags ?? 0) & typeField) !== 0;
}

function sendExistingFieldSpellToGraveyard(state: DuelState, player: PlayerId, incomingUid: string): void {
  const existing = state.cards.find((card) => card.controller === player && card.location === "fieldZone" && card.uid !== incomingUid);
  if (existing) moveDuelCard(state, existing.uid, "graveyard", player, duelReason.rule, player);
}

function isPendulumCard(source: DuelCardInstance): boolean {
  return ((source.data.typeFlags ?? 0) & typePendulum) !== 0;
}

function hasPendulumZoneSpace(state: DuelState, player: PlayerId): boolean {
  return state.cards.filter((card) => card.controller === player && card.location === "spellTrapZone" && (card.sequence === 0 || card.sequence === 1)).length < 2;
}

function requireSpellTrapZoneSequence(state: DuelState, player: PlayerId, requestedSequence?: number): number | undefined {
  if (requestedSequence === undefined) return undefined;
  if (!Number.isSafeInteger(requestedSequence) || requestedSequence < 0 || requestedSequence > 4) throw new Error(`Invalid Spell & Trap Zone ${requestedSequence}`);
  const sequence = firstOpenFieldZoneSequence(state, player, "spellTrapZone", [], 1 << requestedSequence);
  if (sequence === undefined) throw new Error(`Spell & Trap Zone ${requestedSequence + 1} is not available`);
  return sequence;
}
