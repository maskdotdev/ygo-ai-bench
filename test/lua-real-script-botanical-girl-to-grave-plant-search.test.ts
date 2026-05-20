import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelResponse, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBotanicalGirlScript = fs.existsSync(path.join(upstreamRoot, "script", "official", "c84824601.lua"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceDragon = 0x2000;
const racePlant = 0x400;

describe.skipIf(!hasUpstreamScripts || !hasBotanicalGirlScript)("Lua real script Botanical Girl to-Grave plant search", () => {
  it("restores non-delayed previous-on-field EVENT_TO_GRAVE plant search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const botanicalGirlCode = "84824601";
    const lowDefensePlantCode = "84824602";
    const highDefensePlantDecoyCode = "84824603";
    const lowDefenseDragonDecoyCode = "84824604";
    const destroyerCode = "84824605";
    const responderCode = "84824606";
    const script = workspace.readScript(`c${botanicalGirlCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("e1:SetCode(EVENT_TO_GRAVE)");
    expect(script).toContain("return e:GetHandler():IsPreviousLocation(LOCATION_ONFIELD)");
    expect(script).toContain("return c:IsDefenseBelow(1000) and c:IsRace(RACE_PLANT) and c:IsAbleToHand()");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_DECK,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,g)");

    const cards: DuelCardData[] = [
      { code: botanicalGirlCode, name: "Botanical Girl", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, level: 3, attack: 1300, defense: 1100 },
      { code: lowDefensePlantCode, name: "Botanical Girl Low DEF Plant Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, level: 3, attack: 1000, defense: 900 },
      { code: highDefensePlantDecoyCode, name: "Botanical Girl High DEF Plant Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, level: 4, attack: 1400, defense: 1001 },
      { code: lowDefenseDragonDecoyCode, name: "Botanical Girl Low DEF Dragon Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, level: 3, attack: 1000, defense: 900 },
      { code: destroyerCode, name: "Botanical Girl Destroyer", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4 },
      { code: responderCode, name: "Botanical Girl Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 84824601, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [botanicalGirlCode, destroyerCode, lowDefensePlantCode, highDefensePlantDecoyCode, lowDefenseDragonDecoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const botanicalGirl = requireCard(session, botanicalGirlCode);
    const lowDefensePlant = requireCard(session, lowDefensePlantCode);
    const highDefensePlantDecoy = requireCard(session, highDefensePlantDecoyCode);
    const lowDefenseDragonDecoy = requireCard(session, lowDefenseDragonDecoyCode);
    const destroyer = requireCard(session, destroyerCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, botanicalGirl.uid, "monsterZone", 0).position = "faceUpDefense";
    moveDuelCard(session.state, destroyer.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.turn = 2;
    session.state.turnPlayer = 0;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${destroyerCode}.lua`) return destroyerScript(botanicalGirlCode);
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    for (const code of [botanicalGirlCode, destroyerCode, responderCode]) {
      const loaded = host.loadCardScript(Number(code), source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(3);

    const destroy = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === destroyer.uid);
    expect(destroy, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, destroy!);
    resolveEngineChain(session);
    expect(session.state.cards.find((card) => card.uid === botanicalGirl.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      reason: duelReason.effect | duelReason.destroy,
      reasonCardUid: destroyer.uid,
    });
    expect(session.state.pendingTriggers).toEqual([
      {
        id: "trigger-4-1",
        player: 0,
        effectId: "lua-1-1014",
        sourceUid: botanicalGirl.uid,
        triggerBucket: "turnOptional",
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: botanicalGirl.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: destroyer.uid,
        eventReasonEffectId: 2,
        eventTriggerTiming: "when",
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpDefense",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpDefense",
          sequence: 0,
        },
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === botanicalGirl.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toHaveLength(1);
    expect(restoredTrigger.session.state.chain[0]).toEqual({
      id: "chain-5",
      chainIndex: 1,
      effectId: "lua-1-1014",
      sourceUid: botanicalGirl.uid,
      player: 0,
      activationLocation: "graveyard",
      activationSequence: 0,
      eventName: "sentToGraveyard",
      eventCode: 1014,
      eventCardUid: botanicalGirl.uid,
      eventReason: duelReason.effect | duelReason.destroy,
      eventReasonPlayer: 0,
      eventReasonCardUid: destroyer.uid,
      eventReasonEffectId: 2,
      eventTriggerTiming: "when",
      eventPreviousState: {
        controller: 0,
        faceUp: true,
        location: "monsterZone",
        position: "faceUpDefense",
        sequence: 0,
      },
      eventCurrentState: {
        controller: 0,
        faceUp: true,
        location: "graveyard",
        position: "faceUpDefense",
        sequence: 0,
      },
      operationInfos: [{ category: 0x8, targetUids: [], count: 1, player: 0, parameter: 1 }],
    });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.session.state.chain).toHaveLength(0);
    expect(restoredChain.session.state.cards.find((card) => card.uid === botanicalGirl.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === lowDefensePlant.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === highDefensePlantDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === lowDefenseDragonDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === responder.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restoredChain.host.messages).not.toContain("botanical responder resolved");
    expect(restoredChain.session.state.eventHistory.filter((event) => ["sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: lowDefensePlant.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: botanicalGirl.uid,
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
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: lowDefensePlant.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [lowDefensePlant.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: botanicalGirl.uid,
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
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
      },
      {
        eventName: "sentToHandConfirmed",
        eventCode: 1212,
        eventCardUid: lowDefensePlant.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [lowDefensePlant.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: botanicalGirl.uid,
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
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
      },
    ]);
  });
});

function destroyerScript(botanicalGirlCode: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DESTROY)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        local tc=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${botanicalGirlCode}),tp,LOCATION_MZONE,0,nil)
        if chk==0 then return tc and tc:IsDestructable(e) end
        Duel.SetOperationInfo(0,CATEGORY_DESTROY,tc,1,tp,LOCATION_MZONE)
      end)
      e:SetOperation(function(e,tp)
        local tc=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${botanicalGirlCode}),tp,LOCATION_MZONE,0,nil)
        if tc then Duel.Destroy(tc,REASON_EFFECT) end
      end)
      c:RegisterEffect(e)
    end
  `;
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
      e:SetOperation(function(e,tp) Debug.Message("botanical responder resolved") end)
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
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function resolveEngineChain(session: DuelSession): void {
  let guard = 0;
  while (session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const pass = getLegalActions(session, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
