import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { ChainLink, DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const attributeWind = 0x8;
const attributeEarth = 0x1;

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Wynn Link Charmer summon search", () => {
  it("restores opponent-GY linked-zone Special Summon and opponent-destroyed search confirmation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const wynnCode = "30674956";
    const graveTargetCode = "30674957";
    const searchTargetCode = "30674958";
    const invalidSearchCode = "30674959";
    const destroyerCode = "30674960";
    const responderCode = "30674961";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === wynnCode),
      { code: graveTargetCode, name: "Wynn Opponent Grave Wind", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1400, defense: 1200, attribute: attributeWind },
      { code: searchTargetCode, name: "Wynn Deck Wind Search", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 900, defense: 1500, attribute: attributeWind },
      { code: invalidSearchCode, name: "Wynn Deck Earth Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 900, defense: 1500, attribute: attributeEarth },
      { code: destroyerCode, name: "Wynn Opponent Destroyer", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1600, defense: 1000, attribute: attributeEarth },
      { code: responderCode, name: "Wynn Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000, attribute: attributeEarth },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 3067, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [searchTargetCode, invalidSearchCode, responderCode], extra: [wynnCode] },
      1: { main: [graveTargetCode, destroyerCode, responderCode] },
    });
    startDuel(session);

    const wynn = requireCard(session, wynnCode);
    const graveTarget = requireCard(session, graveTargetCode);
    const searchTarget = requireCard(session, searchTargetCode);
    const invalidSearch = requireCard(session, invalidSearchCode);
    const destroyer = requireCard(session, destroyerCode);
    const responders = session.state.cards.filter((card) => card.code === responderCode);
    expect(responders).toHaveLength(2);
    const p0Responder = responders.find((card) => card.owner === 0);
    const p1Responder = responders.find((card) => card.owner === 1);
    expect(p0Responder).toBeDefined();
    expect(p1Responder).toBeDefined();
    moveDuelCard(session.state, wynn.uid, "monsterZone", 0).sequence = 5;
    wynn.faceUp = true;
    wynn.position = "faceUpAttack";
    wynn.summonType = "link";
    moveDuelCard(session.state, graveTarget.uid, "graveyard", 1);
    moveDuelCard(session.state, destroyer.uid, "monsterZone", 1).sequence = 0;
    destroyer.faceUp = true;
    destroyer.position = "faceUpAttack";
    moveDuelCard(session.state, p0Responder!.uid, "hand", 0);
    moveDuelCard(session.state, p1Responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${destroyerCode}.lua`) return destroyerScript(wynnCode);
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(wynnCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(destroyerCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);

    const restoredOpenWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredOpenWindow.restoreComplete, restoredOpenWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredOpenWindow.missingRegistryKeys).toEqual([]);
    expect(restoredOpenWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredOpenWindow, 0);
    const revive = getLuaRestoreLegalActions(restoredOpenWindow, 0).find((action) => action.type === "activateEffect" && action.uid === wynn.uid);
    expect(revive, JSON.stringify(getLuaRestoreLegalActions(restoredOpenWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpenWindow, revive!);
    expect(restoredOpenWindow.session.state.chain).toHaveLength(1);
    assertSpecialSummonOperationInfo(restoredOpenWindow.session.state.chain[0]!, graveTarget.uid);

    const restoredReviveChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpenWindow.session), source, reader);
    expect(restoredReviveChain.restoreComplete, restoredReviveChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredReviveChain.missingRegistryKeys).toEqual([]);
    expect(restoredReviveChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredReviveChain, 1);
    expect(restoredReviveChain.session.state.chain).toHaveLength(1);
    assertSpecialSummonOperationInfo(restoredReviveChain.session.state.chain[0]!, graveTarget.uid);
    passRestoredChainUntilResolved(restoredReviveChain);

    expect(restoredReviveChain.session.state.cards.find((card) => card.uid === graveTarget.uid)).toMatchObject({
      controller: 0,
      location: "monsterZone",
      sequence: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
    });
    expect(restoredReviveChain.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === graveTarget.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: graveTarget.uid,
        eventUids: [graveTarget.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: wynn.uid,
        eventReasonEffectId: 3,
        eventPreviousState: {
          controller: 1,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
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
    expect(restoredReviveChain.host.messages).not.toContain("wynn responder resolved");

    restoredReviveChain.session.state.turnPlayer = 1;
    restoredReviveChain.session.state.waitingFor = 1;
    const restoredDestroyWindow = restoreDuelWithLuaScripts(serializeDuel(restoredReviveChain.session), source, reader);
    expect(restoredDestroyWindow.restoreComplete, restoredDestroyWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredDestroyWindow.missingRegistryKeys).toEqual([]);
    expect(restoredDestroyWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredDestroyWindow, 1);
    const destroy = getLuaRestoreLegalActions(restoredDestroyWindow, 1).find((action) => action.type === "activateEffect" && action.uid === destroyer.uid);
    expect(destroy, JSON.stringify(getLuaRestoreLegalActions(restoredDestroyWindow, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroyWindow, destroy!);
    expect(restoredDestroyWindow.session.state.chain).toHaveLength(1);
    assertDestroyOperationInfo(restoredDestroyWindow.session.state.chain[0]!, wynn.uid);

    const restoredDestroyChain = restoreDuelWithLuaScripts(serializeDuel(restoredDestroyWindow.session), source, reader);
    expect(restoredDestroyChain.restoreComplete, restoredDestroyChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredDestroyChain.missingRegistryKeys).toEqual([]);
    expect(restoredDestroyChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredDestroyChain, 0);
    passRestoredChainUntilResolved(restoredDestroyChain);

    expect(restoredDestroyChain.session.state.cards.find((card) => card.uid === wynn.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 1,
      reasonCardUid: destroyer.uid,
    });
    expect(restoredDestroyChain.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-7-1",
        player: 0,
        effectId: "lua-4-1029",
        sourceUid: wynn.uid,
        triggerBucket: "opponentOptional",
        eventName: "destroyed",
        eventPlayer: 0,
        eventCode: 1029,
        eventCardUid: wynn.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: destroyer.uid,
        eventReasonEffectId: 5,
        eventTriggerTiming: "if",
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 5,
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

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredDestroyChain.session), source, reader);
    expect(restoredTriggerWindow.restoreComplete, restoredTriggerWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTriggerWindow.missingRegistryKeys).toEqual([]);
    expect(restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    const search = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === wynn.uid);
    expect(search, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, search!);
    expect(restoredTriggerWindow.session.state.chain).toHaveLength(1);
    assertSearchOperationInfo(restoredTriggerWindow.session.state.chain[0]!);

    const restoredSearchChain = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expect(restoredSearchChain.restoreComplete, restoredSearchChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSearchChain.missingRegistryKeys).toEqual([]);
    expect(restoredSearchChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredSearchChain, 1);
    passRestoredChainUntilResolved(restoredSearchChain);

    expect(restoredSearchChain.session.state.cards.find((card) => card.uid === searchTarget.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredSearchChain.session.state.cards.find((card) => card.uid === invalidSearch.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredSearchChain.session.state.eventHistory.filter((event) => ["sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: searchTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: wynn.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventPlayer: 1,
        eventUids: [searchTarget.uid],
        eventValue: 1,
        eventCardUid: searchTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: wynn.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
      },
      {
        eventName: "sentToHandConfirmed",
        eventCode: 1212,
        eventPlayer: 1,
        eventUids: [searchTarget.uid],
        eventValue: 1,
        eventCardUid: searchTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: wynn.uid,
        eventReasonEffectId: 4,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
      },
    ]);
    expect(restoredSearchChain.host.messages).toEqual([`confirmed 1: ${searchTargetCode}`]);
    expect(restoredSearchChain.host.messages).not.toContain("wynn responder resolved");
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("wynn responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function destroyerScript(wynnCode: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DESTROY)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetTarget(s.destg)
      e:SetOperation(s.desop)
      c:RegisterEffect(e)
    end
    function s.desfilter(c)
      return c:IsCode(${wynnCode})
    end
    function s.destg(e,tp,eg,ep,ev,re,r,rp,chk)
      local g=Duel.GetMatchingGroup(s.desfilter,tp,0,LOCATION_MZONE,nil)
      if chk==0 then return #g>0 end
      Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,#g,0,0)
    end
    function s.desop(e,tp,eg,ep,ev,re,r,rp)
      local g=Duel.GetMatchingGroup(s.desfilter,tp,0,LOCATION_MZONE,nil)
      if #g>0 then
        Duel.Destroy(g,REASON_EFFECT)
      end
    end
  `;
}

function assertSpecialSummonOperationInfo(link: ChainLink, targetUid: string): void {
  expect(link.operationInfos).toEqual([{ category: 0x200, targetUids: [targetUid], count: 1, player: 0, parameter: 0x10 }]);
}

function assertDestroyOperationInfo(link: ChainLink, targetUid: string): void {
  expect(link.operationInfos).toEqual([{ category: 0x1, targetUids: [targetUid], count: 1, player: 0, parameter: 0 }]);
}

function assertSearchOperationInfo(link: ChainLink): void {
  expect(link.operationInfos).toEqual([{ category: 0x8, targetUids: [], count: 1, player: 0, parameter: 0x1 }]);
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function passRestoredChainUntilResolved(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain")
      ?? getLuaRestoreLegalActions(restored, player === 0 ? 1 : 0).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify({
      waitingFor: restored.session.state.waitingFor,
      player,
      playerActions: getLuaRestoreLegalActions(restored, player),
      opponentActions: getLuaRestoreLegalActions(restored, player === 0 ? 1 : 0),
    }, null, 2)).toBeDefined();
    const result = applyLuaRestoreResponse(restored, pass!);
    expect(result.ok, result.error).toBe(true);
    const nextPlayer = restored.session.state.waitingFor;
    if (nextPlayer !== undefined) {
      expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, nextPlayer));
      expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, nextPlayer));
      expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    }
  }
}

function requireCard(session: ReturnType<typeof createDuel>, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
