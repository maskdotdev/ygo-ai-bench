import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { isAttackPrevented } from "#duel/continuous-effects.js";
import {
  applyResponse,
  createDuel,
  getGroupedDuelLegalActions,
  getLegalActions,
  loadDecks,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
import { createEffectContext } from "#duel/effect-context.js";
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
const raceWarrior = 0x1;
const attributeWater = 0x2;
const attributeFire = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Stream Dragon Ruler deck summon cannot attack", () => {
  it("restores DragonRuler discard cost, Deck SpecialSummonStep, and temporary cannot-attack effect", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const streamCode = "27415516";
    const tidalCode = "26400609";
    const waterCostCode = "27415517";
    const offCodeDeckCode = "27415518";
    const offAttributeCostCode = "27415519";
    const responderCode = "27415520";
    const streamScript = workspace.readScript(`c${streamCode}.lua`);
    expect(streamScript).toContain("DragonRuler.SelfDiscardCost(ATTRIBUTE_WATER)");
    expect(streamScript).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_DECK)");
    expect(streamScript).toContain("Duel.SpecialSummonStep(tc,0,tp,tp,false,false,POS_FACEUP)");
    expect(streamScript).toContain("EFFECT_CANNOT_ATTACK");
    expect(streamScript).toContain("Duel.SpecialSummonComplete()");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === streamCode || card.code === tidalCode),
      { code: waterCostCode, name: "Stream Dragon Ruler WATER Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeWater, level: 4, attack: 1000, defense: 1000 },
      { code: offCodeDeckCode, name: "Stream Dragon Ruler Deck Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeWater, level: 7, attack: 2400, defense: 2000 },
      { code: offAttributeCostCode, name: "Stream Dragon Ruler FIRE Cost Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeFire, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Stream Dragon Ruler Chain Responder", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeWater, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 27415516, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [streamCode, tidalCode, waterCostCode, offCodeDeckCode, offAttributeCostCode] },
      1: { main: [responderCode] },
    });
    startDuel(session);

    const stream = requireCard(session, streamCode);
    const tidal = requireCard(session, tidalCode);
    const waterCost = requireCard(session, waterCostCode);
    const offCodeDeck = requireCard(session, offCodeDeckCode);
    const offAttributeCost = requireCard(session, offAttributeCostCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, stream.uid, "hand", 0);
    moveDuelCard(session.state, waterCost.uid, "hand", 0);
    moveDuelCard(session.state, offAttributeCost.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(streamCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activation = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === stream.uid);
    expect(activation, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activation!);

    expect(session.state.cards.find((card) => card.uid === waterCost.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: stream.uid,
    });
    expect(session.state.cards.find((card) => card.uid === stream.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: stream.uid,
    });
    expect(session.state.cards.find((card) => card.uid === offAttributeCost.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(session.state.chain[0]).toEqual({
      activationLocation: "graveyard",
      activationSequence: 1,
      chainIndex: 1,
      effectId: "lua-1",
      id: "chain-4",
      operationInfos: [{ category: 0x200, count: 1, parameter: 0x1, player: 0, targetUids: [] }],
      player: 0,
      sourceUid: stream.uid,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 1);
    expect(restored.session.state.eventHistory.filter((event) =>
      event.eventName === "sentToGraveyard" && event.eventCardUid !== undefined && [stream.uid, waterCost.uid].includes(event.eventCardUid)
    )).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: waterCost.uid,
        eventReason: duelReason.cost | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: stream.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: stream.uid,
        eventReason: duelReason.cost | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: stream.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 1 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: waterCost.uid,
        eventUids: [waterCost.uid, stream.uid],
        eventReason: duelReason.cost | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: stream.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);
    expect(getLuaRestoreLegalActions(restored, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);

    passChain(restored);

    const restoredTidal = restored.session.state.cards.find((card) => card.uid === tidal.uid);
    expect(restoredTidal).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: stream.uid,
      reasonEffectId: 1,
    });
    expect(restored.session.state.cards.find((card) => card.uid === offCodeDeck.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === offAttributeCost.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === tidal.uid).map((effect) => effect.code)).toContain(85);
    expect(isAttackPrevented(restored.session.state, restoredTidal!, (effect, sourceCard, target) =>
      createEffectContext(restored.session.state, sourceCard, effect.controller, undefined, target, [], true),
    )).toBe(true);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === tidal.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: tidal.uid,
        eventUids: [tidal.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: stream.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(host.messages).not.toContain("stream dragon ruler responder resolved");
    expect(restored.host.messages).not.toContain("stream dragon ruler responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("stream dragon ruler responder resolved") end)
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
