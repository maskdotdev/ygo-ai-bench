import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hollowcoreCode = "88225269";
const gemKnightFusionCode = "1264319";
const gemKnightNormalCode = "882252690";
const gemKnightFusionMonsterCode = "882252691";
const gemKnightAllyCode = "882252692";
const opponentSpellCode = "882252693";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasHollowcoreScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${hollowcoreCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeNormal = 0x10;
const typeEffect = 0x20;
const typeFusion = 0x40;
const setGemKnight = 0x1047;

describe.skipIf(!hasUpstreamScripts || !hasHollowcoreScript)("Lua real script Gem-Knight Hollowcore summon negate stat", () => {
  it("restores deck-send self summon and graveyard multi-banish chain negate into Gem-Knight ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${hollowcoreCode}.lua`);
    expect(script).toContain("return (c:IsCode(1264319) or (c:IsSetCard(SET_GEM_KNIGHT) and c:IsType(TYPE_NORMAL))) and c:IsAbleToGraveAsCost()");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.spcostfilter,tp,LOCATION_DECK,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoGrave(g,REASON_COST)");
    expect(script).toContain("c:IsCanBeSpecialSummoned(e,0,tp,false,false,POS_FACEUP_DEFENSE)");
    expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP_DEFENSE)");
    expect(script).toContain("Duel.IsChainDisablable(ev)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.negcostfilter,tp,LOCATION_GRAVE,0,2,2,c)");
    expect(script).toContain("Duel.Remove(g+c,POS_FACEUP,REASON_COST)");
    expect(script).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsSetCard,SET_GEM_KNIGHT),tp,LOCATION_MZONE,0,nil)");
    expect(script).toContain("Duel.NegateEffect(ev)");
    expect(script).toContain("Duel.BreakEffect()");
    expect(script).toContain("tc:UpdateAttack(1000,RESET_EVENT|RESETS_STANDARD,c)");

    const summon = createScenario();
    const hollowcore = requireCard(summon.session, hollowcoreCode);
    const summonCost = requireCard(summon.session, gemKnightNormalCode);
    moveDuelCard(summon.session.state, hollowcore.uid, "hand", 0);
    summon.session.state.phase = "main1";
    summon.session.state.turnPlayer = 0;
    summon.session.state.waitingFor = 0;

    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(summon.session), summon.source, summon.reader);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const summonAction = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "activateEffect" && action.uid === hollowcore.uid);
    expect(summonAction, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summonAction!);
    passRestoredChain(restoredSummon);

    expect(restoredSummon.session.state.cards.find((card) => card.uid === summonCost.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: hollowcore.uid,
      reasonEffectId: 1,
    });
    expect(restoredSummon.session.state.cards.find((card) => card.uid === hollowcore.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: hollowcore.uid,
      reasonEffectId: 1,
    });
    expect(restoredSummon.session.state.eventHistory.filter((event) => ["sentToGraveyard", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: summonCost.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: hollowcore.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: hollowcore.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: hollowcore.uid,
        eventReasonEffectId: 1,
        eventUids: [hollowcore.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 0 },
      },
    ]);
    expect(restoredSummon.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const negate = createScenario();
    const negateHollowcore = requireCard(negate.session, hollowcoreCode);
    const gemKnightCost = requireCard(negate.session, gemKnightNormalCode);
    const gemKnightFusion = requireCard(negate.session, gemKnightFusionCode);
    const gemKnightFusionMonster = requireCard(negate.session, gemKnightFusionMonsterCode);
    const gemKnightAlly = requireCard(negate.session, gemKnightAllyCode);
    const opponentSpell = requireCard(negate.session, opponentSpellCode);
    moveDuelCard(negate.session.state, negateHollowcore.uid, "graveyard", 0);
    moveDuelCard(negate.session.state, gemKnightCost.uid, "graveyard", 0);
    moveDuelCard(negate.session.state, gemKnightFusion.uid, "graveyard", 0);
    moveFaceUpAttack(negate.session, gemKnightFusionMonster, 0);
    moveFaceUpAttack(negate.session, gemKnightAlly, 0);
    moveDuelCard(negate.session.state, opponentSpell.uid, "hand", 1);
    negate.session.state.phase = "main1";
    negate.session.state.turnPlayer = 1;
    negate.session.state.waitingFor = 1;

    const restoredSpellOpen = restoreDuelWithLuaScripts(serializeDuel(negate.session), negate.source, negate.reader);
    expectCleanRestore(restoredSpellOpen);
    expectRestoredLegalActions(restoredSpellOpen, 1);
    const spellAction = getLuaRestoreLegalActions(restoredSpellOpen, 1).find((action) => action.type === "activateEffect" && action.uid === opponentSpell.uid);
    expect(spellAction, JSON.stringify(getLuaRestoreLegalActions(restoredSpellOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSpellOpen, spellAction!);

    const restoredResponse = restoreDuelWithLuaScripts(serializeDuel(restoredSpellOpen.session), negate.source, negate.reader);
    expectCleanRestore(restoredResponse);
    expectRestoredLegalActions(restoredResponse, 0);
    const negateAction = getLuaRestoreLegalActions(restoredResponse, 0).find((action) => action.type === "activateEffect" && action.uid === negateHollowcore.uid);
    expect(negateAction, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredResponse, negateAction!);
    passRestoredChain(restoredResponse);

    expect(restoredResponse.host.messages).not.toContain("gem-knight hollowcore opponent spell resolved");
    expect(restoredResponse.session.state.cards.filter((card) => [negateHollowcore.uid, gemKnightCost.uid, gemKnightFusion.uid].includes(card.uid)).map((card) => ({
      uid: card.uid,
      location: card.location,
      faceUp: card.faceUp,
      reason: card.reason,
      reasonPlayer: card.reasonPlayer,
      reasonCardUid: card.reasonCardUid,
      reasonEffectId: card.reasonEffectId,
    }))).toEqual([
      { uid: negateHollowcore.uid, location: "banished", faceUp: true, reason: duelReason.cost, reasonPlayer: 0, reasonCardUid: negateHollowcore.uid, reasonEffectId: 2 },
      { uid: gemKnightFusion.uid, location: "banished", faceUp: true, reason: duelReason.cost, reasonPlayer: 0, reasonCardUid: negateHollowcore.uid, reasonEffectId: 2 },
      { uid: gemKnightCost.uid, location: "banished", faceUp: true, reason: duelReason.cost, reasonPlayer: 0, reasonCardUid: negateHollowcore.uid, reasonEffectId: 2 },
    ]);
    expect(currentAttack(restoredResponse.session.state.cards.find((card) => card.uid === gemKnightFusionMonster.uid), restoredResponse.session.state)).toBe(3300);
    expect(currentAttack(restoredResponse.session.state.cards.find((card) => card.uid === gemKnightAlly.uid), restoredResponse.session.state)).toBe(2600);
    expect(restoredResponse.session.state.eventHistory.filter((event) => ["chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
      {
        eventName: "chainNegated",
        eventCode: 1024,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 3,
      },
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 1,
        eventValue: 1,
        eventReasonPlayer: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 3,
      },
    ]);
    expect(restoredResponse.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createScenario(): {
  session: DuelSession;
  reader: ReturnType<typeof createCardReader>;
  source: { readScript(name: string): string | undefined };
} {
  const cards: DuelCardData[] = [
    { code: hollowcoreCode, name: "Gem-Knight Hollowcore", kind: "monster", typeFlags: typeMonster | typeEffect, level: 7, attack: 1950, defense: 2450, setcodes: [setGemKnight] },
    { code: gemKnightFusionCode, name: "Gem-Knight Fusion", kind: "spell", typeFlags: typeSpell, setcodes: [setGemKnight] },
    { code: gemKnightNormalCode, name: "Gem-Knight Normal Cost", kind: "monster", typeFlags: typeMonster | typeNormal, level: 4, attack: 1600, defense: 1000, setcodes: [setGemKnight] },
    { code: gemKnightFusionMonsterCode, name: "Gem-Knight Fusion Monster", kind: "extra", typeFlags: typeMonster | typeFusion, level: 6, attack: 2300, defense: 1800, setcodes: [setGemKnight] },
    { code: gemKnightAllyCode, name: "Gem-Knight Ally", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1600, defense: 1200, setcodes: [setGemKnight] },
    { code: opponentSpellCode, name: "Gem-Knight Hollowcore Opponent Spell", kind: "spell", typeFlags: typeSpell },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed: 88225269, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [hollowcoreCode, gemKnightFusionCode, gemKnightNormalCode, gemKnightAllyCode], extra: [gemKnightFusionMonsterCode] },
    1: { main: [opponentSpellCode] },
  });
  startDuel(session);
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  const source = {
    readScript(name: string) {
      if (name === `c${opponentSpellCode}.lua`) return opponentSpellScript();
      return workspace.readScript(name);
    },
  };
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(hollowcoreCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(opponentSpellCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  return { session, reader, source };
}

function opponentSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(function(e,tp) Debug.Message("gem-knight hollowcore opponent spell resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
