import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const racePlant = 0x400;
const raceWarrior = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Lonefire Blossom release-cost Deck summon", () => {
  it("restores face-up Plant release cost and Deck Special Summon into the freed Monster Zone", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const lonefireCode = "48686504";
    const deckPlantCode = "48686505";
    const deckWarriorCode = "48686506";
    const fieldWarriorCode = "48686507";
    const blockerCodes = ["48686508", "48686509", "48686510"];
    const responderCode = "48686513";
    const lonefireScript = workspace.readScript(`c${lonefireCode}.lua`);
    expect(lonefireScript).toContain("Duel.CheckReleaseGroupCost(tp,s.costfilter,1,false,nil,nil,ft,tp)");
    expect(lonefireScript).toContain("Duel.SelectReleaseGroupCost(tp,s.costfilter,1,1,false,nil,nil,ft,tp)");
    expect(lonefireScript).toContain("Duel.Release(g,REASON_COST)");
    expect(lonefireScript).toContain("Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_DECK,0,1,1,nil,e,tp)");
    expect(lonefireScript).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");

    const cards: DuelCardData[] = [
      { code: lonefireCode, name: "Lonefire Blossom", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, level: 3, attack: 500, defense: 1400 },
      { code: deckPlantCode, name: "Lonefire Deck Plant", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, level: 4, attack: 1800, defense: 1000 },
      { code: deckWarriorCode, name: "Lonefire Deck Warrior Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1900, defense: 1000 },
      { code: fieldWarriorCode, name: "Lonefire Field Warrior Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
      ...blockerCodes.map((code, index) => ({ code, name: `Lonefire Monster Zone Blocker ${index + 1}`, kind: "monster" as const, typeFlags: typeMonster, race: raceWarrior, level: 4, attack: 1000, defense: 1000 })),
      { code: responderCode, name: "Lonefire Chain Responder", kind: "monster", typeFlags: typeMonster, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 48686504, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [lonefireCode, deckPlantCode, deckWarriorCode, fieldWarriorCode, ...blockerCodes] },
      1: { main: [responderCode] },
    });
    startDuel(session);

    const lonefire = requireCard(session, lonefireCode);
    const deckPlant = requireCard(session, deckPlantCode);
    const deckWarrior = requireCard(session, deckWarriorCode);
    const fieldWarrior = requireCard(session, fieldWarriorCode);
    const blockers = blockerCodes.map((code) => requireCard(session, code));
    const responder = requireCard(session, responderCode);
    const movedLonefire = moveDuelCard(session.state, lonefire.uid, "monsterZone", 0);
    movedLonefire.sequence = 0;
    movedLonefire.position = "faceUpAttack";
    const movedFieldWarrior = moveDuelCard(session.state, fieldWarrior.uid, "monsterZone", 0);
    movedFieldWarrior.sequence = 1;
    movedFieldWarrior.position = "faceUpAttack";
    blockers.forEach((blocker, index) => {
      const moved = moveDuelCard(session.state, blocker.uid, "monsterZone", 0);
      moved.sequence = index + 2;
      moved.position = "faceUpAttack";
    });
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(lonefireCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === lonefire.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);

    expect(session.state.cards.find((card) => card.uid === lonefire.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.release | duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: lonefire.uid,
      reasonEffectId: 1,
    });
    expect(session.state.cards.find((card) => card.uid === fieldWarrior.uid)).toMatchObject({ location: "monsterZone", controller: 0, sequence: 1 });
    expect(session.state.chain).toEqual([
      {
        activationLocation: "graveyard",
        activationSequence: 0,
        chainIndex: 1,
        effectId: "lua-1",
        id: "chain-3",
        operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x1 }],
        player: 0,
        sourceUid: lonefire.uid,
      },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 1);
    expect(getLuaRestoreLegalActions(restored, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    passChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === lonefire.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === deckPlant.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      sequence: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: lonefire.uid,
      reasonEffectId: 1,
    });
    expect(restored.session.state.cards.find((card) => card.uid === deckWarrior.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === fieldWarrior.uid)).toMatchObject({ location: "monsterZone", controller: 0, sequence: 1 });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "released" && event.eventCardUid === lonefire.uid)).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: lonefire.uid,
        eventReason: duelReason.release | duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: lonefire.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === deckPlant.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: deckPlant.uid,
        eventUids: [deckPlant.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: lonefire.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 4,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
    expect(host.messages).not.toContain("lonefire responder resolved");
    expect(restored.host.messages).not.toContain("lonefire responder resolved");
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
      e:SetOperation(function(e,tp) Debug.Message("lonefire responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function passChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
  }
}
