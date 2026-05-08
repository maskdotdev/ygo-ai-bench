import { hasZoneSpace, moveDuelCard } from "#duel/card-state.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardInstance, DuelEffectDefinition, DuelState, PlayerId } from "#duel/types.js";

const luaEffectTypeActivate = 0x10;
const typeContinuous = 0x20000;
const typeEquip = 0x40000;
const typeField = 0x80000;

export function placeActivatedSpellTrapCard(state: DuelState, player: PlayerId, source: DuelCardInstance, effect: DuelEffectDefinition): void {
  if (!isSpellTrapCardActivation(source, effect)) return;
  if (source.location === "hand") {
    if (!hasZoneSpace(state, player, "spellTrapZone")) throw new Error(`${source.name} cannot be activated because the Spell & Trap Zone is full`);
    moveDuelCard(state, source.uid, "spellTrapZone", player, duelReason.rule, player);
    return;
  }
  if (source.location === "spellTrapZone") source.faceUp = true;
}

export function shouldSendActivatedSpellTrapToGraveyard(source: DuelCardInstance, effect: DuelEffectDefinition): boolean {
  return source.location === "spellTrapZone" && isSpellTrapCardActivation(source, effect) && !isPersistentSpellTrap(source);
}

function isSpellTrapCardActivation(source: DuelCardInstance, effect: DuelEffectDefinition): boolean {
  return (source.kind === "spell" || source.kind === "trap") && ((effect.luaTypeFlags ?? 0) & luaEffectTypeActivate) !== 0;
}

function isPersistentSpellTrap(source: DuelCardInstance): boolean {
  return ((source.data.typeFlags ?? 0) & (typeContinuous | typeEquip | typeField)) !== 0;
}
