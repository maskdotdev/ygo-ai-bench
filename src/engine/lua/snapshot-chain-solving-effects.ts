import { currentCardMatchesSetcode } from "#duel/card-code-state.js";
import { findCard } from "#duel/card-state.js";
import { negateDuelChainLinkObject } from "#duel/core.js";
import { resetDuelCardEffects } from "#duel/effect-reset.js";
import type { DuelEffectDefinition, DuelState, SerializedDuelEffect } from "#duel/types.js";

const luaRareMetalmorphCode = "12503902";
const luaGishkiEmiliaCode = "73551138";
const luaWorldLegacyWhispersCode = "62530723";
const luaChainSolvingEventCode = 1020;
const luaResetStandard = 0x01fe0000;
const luaResetEventStandard = 0x41fe0000;
const luaSetMekkKnight = 0x10c;

export function isKnownRareMetalmorphChainSolvingNegateEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaRareMetalmorphCode}:`)) && effect.event === "continuous" && effect.code === luaChainSolvingEventCode && effect.reset?.flags !== undefined && ((effect.reset.flags & luaResetStandard) === luaResetStandard || effect.reset.flags === luaResetEventStandard) && effect.range.length === 1 && effect.range[0] === "spellTrapZone" && effect.targetRange === undefined;
}

export function isKnownCalledByTheGraveChainSolvingNegateEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith("lua:24224830:")) && effect.event === "continuous" && effect.code === luaChainSolvingEventCode && effect.luaConditionDescriptor === "condition:chain-solving-monster-effect-handler-original-code-label" && effect.label !== undefined;
}

export function isKnownSameOriginalCodeChainSolvingNegateEffect(effect: SerializedDuelEffect): boolean {
  return effect.event === "continuous" && effect.code === luaChainSolvingEventCode && effect.luaConditionDescriptor === "condition:chain-solving-effect-handler-original-code-label" && effect.label !== undefined;
}

export function isKnownGishkiEmiliaTrapNegateEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaGishkiEmiliaCode}:`)) && effect.event === "continuous" && effect.code === luaChainSolvingEventCode && effect.reset?.flags !== undefined && effect.targetRange === undefined;
}

export function isKnownWorldLegacyWhispersSpellNegateEffect(effect: SerializedDuelEffect): boolean {
  return Boolean(effect.registryKey?.startsWith(`lua:${luaWorldLegacyWhispersCode}:`)) && effect.event === "continuous" && effect.code === luaChainSolvingEventCode && effect.range.length === 1 && effect.range[0] === "spellTrapZone" && effect.targetRange === undefined;
}

export function rareMetalmorphChainSolvingNegateOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    const chainLink = ctx.chainLink;
    const targetUid = ctx.source.cardTargetUids?.[0];
    if (!chainLink || !targetUid || !chainLink.targetUids?.includes(targetUid)) return;
    const chainSource = findCard(ctx.duel, chainLink.sourceUid);
    if (!chainSource || !isSpellCard(chainSource)) return;
    if (!negateDuelChainLinkObject(ctx.duel, chainLink, ctx.player, ctx.source.name)) return;
    resetDuelCardEffects(ctx.duel, ctx.source, (candidate) => candidate.id === effect.id);
  };
}

export function calledByTheGraveChainSolvingNegateOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    if (!ctx.chainLink) return;
    negateDuelChainLinkObject(ctx.duel, ctx.chainLink, effect.controller, ctx.source.name);
  };
}

export function gishkiEmiliaTrapNegateOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    const chainLink = ctx.chainLink;
    if (!chainLink || chainLink.activationLocation !== "spellTrapZone") return;
    const chainSource = findCard(ctx.duel, chainLink.sourceUid);
    if (!chainSource || !isTrapCard(chainSource)) return;
    negateDuelChainLinkObject(ctx.duel, chainLink, effect.controller, ctx.source.name);
  };
}

export function worldLegacyWhispersSpellNegateOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    const chainLink = ctx.chainLink;
    if (!chainLink || chainLink.player === effect.controller || chainLink.activationLocation !== "spellTrapZone") return;
    const chainSource = findCard(ctx.duel, chainLink.sourceUid);
    if (!chainSource || !isSpellCard(chainSource)) return;
    const spellSequence = chainLink.activationSequence ?? chainSource.sequence;
    if (!hasFaceUpMekkKnightInColumn(ctx.duel, effect.controller, chainLink.player, spellSequence)) return;
    negateDuelChainLinkObject(ctx.duel, chainLink, effect.controller, ctx.source.name);
  };
}

function isSpellCard(card: { kind: string; typeFlags?: number; data?: { typeFlags?: number } }): boolean {
  return card.kind === "spell" || (((card.typeFlags ?? card.data?.typeFlags ?? 0) & 0x2) !== 0);
}

function isTrapCard(card: { kind: string; typeFlags?: number; data?: { typeFlags?: number } }): boolean {
  return card.kind === "trap" || (((card.typeFlags ?? card.data?.typeFlags ?? 0) & 0x4) !== 0);
}

function hasFaceUpMekkKnightInColumn(state: DuelState, controller: number, spellController: number, spellSequence: number): boolean {
  return state.cards.some((card) =>
    card.controller === controller &&
    card.location === "monsterZone" &&
    card.faceUp &&
    card.sequence === spellSequence &&
    currentCardMatchesSetcode(card, state, luaSetMekkKnight) &&
    spellController !== controller,
  );
}
