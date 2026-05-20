import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasPlanetPathfinderScript = fs.existsSync(path.join(upstreamRoot, "script", "official", "c97526666.lua"));

const planetPathfinderCode = "97526666";
const fieldSpellCode = "97526667";
const normalSpellDecoyCode = "97526668";
const monsterDecoyCode = "97526669";
const responderCode = "97526670";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeField = 0x80000;

describe.skipIf(!hasUpstreamScripts || !hasPlanetPathfinderScript)("Lua real script Planet Pathfinder self-tribute Field Spell search", () => {
  it("restores Cost.SelfTribute from field into a Field Spell deck search and confirmation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${planetPathfinderCode}.lua`);
    expect(script).toContain("e1:SetRange(LOCATION_MZONE)");
    expect(script).toContain("e1:SetCost(Cost.SelfTribute)");
    expect(script).toContain("return c:IsFieldSpell() and c:IsAbleToHand()");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,g)");

    const cards: DuelCardData[] = [
      { code: planetPathfinderCode, name: "Planet Pathfinder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: fieldSpellCode, name: "Planet Pathfinder Field Spell Target", kind: "spell", typeFlags: typeSpell | typeField },
      { code: normalSpellDecoyCode, name: "Planet Pathfinder Normal Spell Decoy", kind: "spell", typeFlags: typeSpell },
      { code: monsterDecoyCode, name: "Planet Pathfinder Monster Decoy", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: responderCode, name: "Planet Pathfinder Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 97526666, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [planetPathfinderCode, fieldSpellCode, normalSpellDecoyCode, monsterDecoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const pathfinder = requireCard(session, planetPathfinderCode);
    const fieldSpell = requireCard(session, fieldSpellCode);
    const normalSpellDecoy = requireCard(session, normalSpellDecoyCode);
    const monsterDecoy = requireCard(session, monsterDecoyCode);
    const responder = requireCard(session, responderCode);
    const movedPathfinder = moveDuelCard(session.state, pathfinder.uid, "monsterZone", 0);
    movedPathfinder.position = "faceUpAttack";
    movedPathfinder.faceUp = true;
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.turn = 2;
    session.state.turnPlayer = 0;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = { readScript(name: string) { return name === `c${responderCode}.lua` ? chainResponderScript() : workspace.readScript(name); } };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(planetPathfinderCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === pathfinder.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toHaveLength(1);
    expect(restoredOpen.session.state.chain[0]?.sourceUid).toBe(pathfinder.uid);
    expect(restoredOpen.session.state.chain[0]?.operationInfos).toEqual([{ category: 0x8, targetUids: [], count: 1, player: 0, parameter: 1 }]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === pathfinder.uid)).toMatchObject({ location: "graveyard", controller: 0, faceUp: true });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === fieldSpell.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === normalSpellDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === monsterDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.session.state.chain).toHaveLength(0);
    expect(restoredChain.session.state.cards.find((card) => card.uid === pathfinder.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === fieldSpell.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === normalSpellDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === monsterDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredChain.host.messages).not.toContain("planet pathfinder responder resolved");
    expect(restoredChain.session.state.eventHistory.filter((event) => ["released", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      releasedEvent(pathfinder.uid),
      sentToHandEvent(fieldSpell.uid, pathfinder.uid),
      confirmedEvent(fieldSpell.uid, pathfinder.uid),
      sentToHandConfirmedEvent(fieldSpell.uid, pathfinder.uid),
    ]);
  });
});

function releasedEvent(cardUid: string) {
  return {
    eventName: "released",
    eventCode: 1017,
    eventCardUid: cardUid,
    eventReason: duelReason.cost | duelReason.release,
    eventReasonPlayer: 0,
    eventReasonCardUid: cardUid,
    eventReasonEffectId: 1,
    eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
  };
}

function sentToHandEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "sentToHand",
    eventCode: 1012,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
  };
}

function confirmedEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "confirmed",
    eventCode: 1211,
    eventCardUid: cardUid,
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
  };
}

function sentToHandConfirmedEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "sentToHandConfirmed",
    eventCode: 1212,
    eventCardUid: cardUid,
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 1,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
  };
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("planet pathfinder responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): ReturnType<typeof applyLuaRestoreResponse> {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): ReturnType<typeof applyLuaRestoreResponse> {
  const pass = getLuaRestoreLegalActions(restored, restored.session.state.waitingFor!).find((action) => action.type === "passChain");
  expect(pass).toBeDefined();
  return applyLuaRestoreAndAssert(restored, pass!);
}
