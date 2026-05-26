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
const hasOysterMeisterScript = fs.existsSync(path.join(upstreamRoot, "script", "official", "c83239739.lua"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typesToken = 0x4011;
const raceFish = 0x20000;
const attributeWater = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasOysterMeisterScript)("Lua real script Oyster Meister to-Grave token summon", () => {
  it("restores mandatory previous-on-field EVENT_TO_GRAVE token creation and summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const oysterMeisterCode = "83239739";
    const oysterTokenCode = "83239740";
    const senderCode = "83239741";
    const responderCode = "83239742";
    const script = workspace.readScript(`c${oysterMeisterCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_TOKEN)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
    expect(script).toContain("e1:SetCode(EVENT_TO_GRAVE)");
    expect(script).toContain("return e:GetHandler():GetPreviousLocation()&LOCATION_ONFIELD>0");
    expect(script).toContain("not (r&REASON_BATTLE+REASON_DESTROY==REASON_BATTLE+REASON_DESTROY)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOKEN,nil,1,0,0)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,0)");
    expect(script).toContain("Duel.IsPlayerCanSpecialSummonMonster(tp,id+1,0,TYPES_TOKEN,0,0,1,RACE_FISH,ATTRIBUTE_WATER)");
    expect(script).toContain("local token=Duel.CreateToken(tp,id+1)");
    expect(script).toContain("Duel.SpecialSummon(token,0,tp,tp,false,false,POS_FACEUP)");

    const cards: DuelCardData[] = [
      { code: oysterMeisterCode, name: "Oyster Meister", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFish, attribute: attributeWater, level: 3, attack: 1600, defense: 200 },
      { code: oysterTokenCode, name: "Oyster Token", kind: "monster", typeFlags: typesToken, race: raceFish, attribute: attributeWater, level: 1, attack: 0, defense: 0 },
      { code: senderCode, name: "Oyster Meister Sender", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4 },
      { code: responderCode, name: "Oyster Meister Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 83239739, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [oysterMeisterCode, senderCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const oysterMeister = requireCard(session, oysterMeisterCode);
    const sender = requireCard(session, senderCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, oysterMeister.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, sender.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.turn = 2;
    session.state.turnPlayer = 0;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${senderCode}.lua`) return senderScript(oysterMeisterCode);
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    for (const code of [oysterMeisterCode, senderCode, responderCode]) {
      const loaded = host.loadCardScript(Number(code), source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(3);

    const send = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === sender.uid);
    expect(send, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, send!);
    resolveEngineChain(session);
    expect(session.state.cards.find((card) => card.uid === oysterMeister.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      reason: duelReason.effect,
      reasonCardUid: sender.uid,
    });
    expect(session.state.pendingTriggers).toEqual([
      {
        id: "trigger-4-1",
        player: 0,
        effectId: "lua-1-1014",
        sourceUid: oysterMeister.uid,
        triggerBucket: "turnMandatory",
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: oysterMeister.uid,
        eventPlayer: 0,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: sender.uid,
        eventReasonEffectId: 2,
        eventTriggerTiming: "when",
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

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === oysterMeister.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toHaveLength(1);
    expect(restoredTrigger.session.state.chain[0]).toEqual({
      id: "chain-5",
      chainIndex: 1,
      effectId: "lua-1-1014",
      sourceUid: oysterMeister.uid,
      player: 0,
      activationLocation: "graveyard",
      activationSequence: 0,
      eventName: "sentToGraveyard",
      eventCode: 1014,
      eventCardUid: oysterMeister.uid,
      eventPlayer: 0,
      eventReason: duelReason.effect,
      eventReasonPlayer: 0,
      eventReasonCardUid: sender.uid,
      eventReasonEffectId: 2,
      eventTriggerTiming: "when",
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
      operationInfos: [
        { category: 0x400, targetUids: [], count: 1, player: 0, parameter: 0 },
        { category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0 },
      ],
    });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.session.state.chain).toHaveLength(0);
    expect(restoredChain.session.state.cards.find((card) => card.uid === oysterMeister.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    const tokens = restoredChain.session.state.cards.filter((card) => card.code === oysterTokenCode);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      location: "monsterZone",
      controller: 0,
      owner: 0,
      position: "faceUpAttack",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: oysterMeister.uid,
    });
    expect(tokens[0]!.data).toMatchObject({
      code: oysterTokenCode,
      kind: "monster",
      typeFlags: typesToken,
      race: raceFish,
      attribute: attributeWater,
      level: 1,
      attack: 0,
      defense: 0,
    });
    expect(restoredChain.host.messages).not.toContain("oyster responder resolved");
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === tokens[0]!.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: tokens[0]!.uid,
        eventUids: [tokens[0]!.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: oysterMeister.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "hand",
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
  });
});

function senderScript(oysterMeisterCode: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_TOGRAVE)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        local tc=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${oysterMeisterCode}),tp,LOCATION_MZONE,0,nil)
        if chk==0 then return tc and tc:IsAbleToGrave() end
        Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,tc,1,tp,LOCATION_MZONE)
      end)
      e:SetOperation(function(e,tp)
        local tc=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${oysterMeisterCode}),tp,LOCATION_MZONE,0,nil)
        if tc then Duel.SendtoGrave(tc,REASON_EFFECT) end
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
      e:SetOperation(function(e,tp) Debug.Message("oyster responder resolved") end)
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
