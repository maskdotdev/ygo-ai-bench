import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const leoniteCode = "47897376";
const synchroCode = "478973760";
const nonFireSynchroCode = "478973761";
const responderCode = "478973762";
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSynchro = 0x2000;
const attributeFire = 0x4;
const attributeWater = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Adamancipator Crystal Leonite grave Extra Deck top", () => {
  it("restores targeted FIRE Synchro leave-Grave to Extra Deck, self Deck-top return, and deck-top confirmation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${leoniteCode}.lua`);
    expect(script).toContain("e2:SetCategory(CATEGORY_TODECK)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e2:SetRange(LOCATION_GRAVE)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("return (c:IsFaceup() or c:IsLocation(LOCATION_GRAVE)) and c:IsAttribute(ATTRIBUTE_FIRE) and c:IsType(TYPE_SYNCHRO) and c:IsAbleToExtra()");
    expect(script).toContain("Duel.SelectTarget(tp,s.tdfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TODECK,c,1,tp,LOCATION_GRAVE)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_LEAVE_GRAVE,tc,1,tp,0)");
    expect(script).toContain("Duel.GetFirstTarget()");
    expect(script).toContain("Duel.SendtoDeck(tc,nil,SEQ_DECKTOP,REASON_EFFECT)");
    expect(script).toContain("Duel.SendtoDeck(c,nil,SEQ_DECKTOP,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmDecktop(tp,1)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === leoniteCode),
      { code: synchroCode, name: "Leonite Fixture FIRE Synchro", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, attribute: attributeFire, level: 6, attack: 2400, defense: 1800 },
      { code: nonFireSynchroCode, name: "Leonite Fixture WATER Synchro Decoy", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, attribute: attributeWater, level: 6, attack: 2200, defense: 1600 },
      { code: responderCode, name: "Leonite Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 47897376, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [leoniteCode], extra: [synchroCode, nonFireSynchroCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const leonite = requireCard(session, leoniteCode);
    const synchro = requireCard(session, synchroCode);
    const nonFireSynchro = requireCard(session, nonFireSynchroCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, leonite.uid, "graveyard", 0);
    leonite.faceUp = true;
    moveDuelCard(session.state, synchro.uid, "graveyard", 0);
    synchro.faceUp = true;
    moveDuelCard(session.state, nonFireSynchro.uid, "graveyard", 0);
    nonFireSynchro.faceUp = true;
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(leoniteCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const action = getLuaRestoreLegalActions(restoredOpen, 0).find(
      (candidate): candidate is Extract<DuelAction, { type: "activateEffect" }> => candidate.type === "activateEffect" && candidate.uid === leonite.uid,
    );
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, action!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-2",
        sourceUid: leonite.uid,
        player: 0,
        activationLocation: "graveyard",
        activationSequence: 0,
        targetUids: [synchro.uid],
        operationInfos: [
          { category: 0x10, targetUids: [leonite.uid], count: 1, player: 0, parameter: 16 },
          { category: 0x4000000, targetUids: [synchro.uid], count: 1, player: 0, parameter: 0 },
        ],
      },
    ]);

    const synchroPreviousState = cardEventState(synchro);
    const leonitePreviousState = cardEventState(leonite);
    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((candidate) => candidate.type === "activateEffect" && candidate.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).toContain(`confirmed decktop 0: ${leoniteCode}`);
    expect(restoredChain.host.messages).not.toContain("leonite responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === synchro.uid)).toMatchObject({ location: "extraDeck", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === leonite.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === nonFireSynchro.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.session.state.eventHistory.filter((event) => ["sentToDeck", "confirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: synchro.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: leonite.uid,
        eventReasonEffectId: 2,
        eventPreviousState: synchroPreviousState,
        eventCurrentState: { ...synchroPreviousState, faceUp: false, location: "extraDeck", sequence: 0 },
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: leonite.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: leonite.uid,
        eventReasonEffectId: 2,
        eventPreviousState: leonitePreviousState,
        eventCurrentState: { ...leonitePreviousState, location: "deck", sequence: 0 },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: leonite.uid,
        eventPlayer: 0,
        eventValue: 1,
        eventUids: [leonite.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: leonite.uid,
        eventReasonEffectId: 2,
        eventPreviousState: leonitePreviousState,
        eventCurrentState: { ...leonitePreviousState, location: "deck", sequence: 0 },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function cardEventState(card: DuelCardInstance) {
  return {
    controller: card.controller,
    faceUp: card.faceUp,
    location: card.location,
    position: card.position,
    sequence: card.sequence,
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
      e:SetOperation(function(e,tp) Debug.Message("leonite responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const player = result.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor as PlayerId;
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyLuaRestoreAndAssert(restored, pass!);
}
