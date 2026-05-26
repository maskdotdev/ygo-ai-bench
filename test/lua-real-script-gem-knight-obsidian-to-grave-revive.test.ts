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
const hasObsidianScript = fs.existsSync(path.join(upstreamRoot, "script", "official", "c19163116.lua"));
const typeMonster = 0x1;
const typeNormal = 0x10;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasObsidianScript)("Lua real script Gem-Knight Obsidian to-Grave revive", () => {
  it("restores hand-to-Graveyard trigger targeting a Normal Monster in the Graveyard", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const obsidianCode = "19163116";
    const normalTargetCode = "19163117";
    const offTypeTargetCode = "19163118";
    const senderCode = "19163119";
    const responderCode = "19163120";
    const script = workspace.readScript(`c${obsidianCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DELAY+EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("e1:SetCode(EVENT_TO_GRAVE)");
    expect(script).toContain("return e:GetHandler():GetPreviousLocation()==LOCATION_HAND");
    expect(script).toContain("c:IsLevelBelow(4) and c:IsType(TYPE_NORMAL) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");

    const cards: DuelCardData[] = [
      { code: obsidianCode, name: "Gem-Knight Obsidian", kind: "monster", typeFlags: typeMonster | typeEffect, level: 3, attack: 1500, defense: 1200 },
      { code: normalTargetCode, name: "Obsidian Level 4 Normal Target", kind: "monster", typeFlags: typeMonster | typeNormal, level: 4, attack: 1600, defense: 1000 },
      { code: offTypeTargetCode, name: "Obsidian Effect Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1600, defense: 1000 },
      { code: senderCode, name: "Obsidian Hand Sender", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Obsidian Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 19163116, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [obsidianCode, normalTargetCode, offTypeTargetCode, senderCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const obsidian = requireCard(session, obsidianCode);
    const normalTarget = requireCard(session, normalTargetCode);
    const offTypeTarget = requireCard(session, offTypeTargetCode);
    const sender = requireCard(session, senderCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, obsidian.uid, "hand", 0);
    moveDuelCard(session.state, normalTarget.uid, "graveyard", 0);
    moveDuelCard(session.state, offTypeTarget.uid, "graveyard", 0);
    moveDuelCard(session.state, sender.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.turn = 2;
    session.state.turnPlayer = 0;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${senderCode}.lua`) return senderScript(obsidianCode);
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    for (const code of [obsidianCode, senderCode, responderCode]) {
      const loaded = host.loadCardScript(Number(code), source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(3);

    const sendFromHand = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === sender.uid);
    expect(sendFromHand, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, sendFromHand!);
    resolveEngineChain(session);

    expect(session.state.cards.find((card) => card.uid === obsidian.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "hand",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: sender.uid,
    });
    expect(session.state.pendingTriggers).toEqual([
      {
        id: "trigger-4-1",
        effectId: "lua-1-1014",
        eventCardUid: obsidian.uid,
        eventCode: 1014,
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 2 },
        eventName: "sentToGraveyard",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventReason: duelReason.effect,
        eventReasonCardUid: sender.uid,
        eventReasonEffectId: 2,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        player: 0,
        sourceUid: obsidian.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === obsidian.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toHaveLength(1);
    expect(restoredTrigger.session.state.chain[0]).toEqual({
      id: "chain-5",
      chainIndex: 1,
      effectId: "lua-1-1014",
      sourceUid: obsidian.uid,
      player: 0,
      activationLocation: "graveyard",
      activationSequence: 2,
      eventName: "sentToGraveyard",
      eventCode: 1014,
      eventPlayer: 0,
      eventCardUid: obsidian.uid,
      eventReason: duelReason.effect,
      eventReasonPlayer: 0,
      eventReasonCardUid: sender.uid,
      eventReasonEffectId: 2,
      eventTriggerTiming: "if",
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
        location: "graveyard",
        position: "faceDown",
        sequence: 2,
      },
      operationInfos: [{ category: 0x200, targetUids: [normalTarget.uid], count: 1, player: 0, parameter: 0 }],
      targetFieldIds: [7],
      targetUids: [normalTarget.uid],
    });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);

    expect(restoredChain.session.state.cards.find((card) => card.uid === obsidian.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === offTypeTarget.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === normalTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: obsidian.uid,
      reasonEffectId: 1,
    });
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === normalTarget.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: normalTarget.uid,
        eventUids: [normalTarget.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: obsidian.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
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
          sequence: 1,
        },
      },
    ]);
    expect(restoredChain.host.messages).not.toContain("obsidian responder resolved");
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function senderScript(targetCode: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.IsExistingMatchingCard(Card.IsCode,tp,LOCATION_HAND,0,1,nil,${targetCode}) end
      end)
      e:SetOperation(function(e,tp)
        local tc=Duel.GetMatchingGroup(Card.IsCode,tp,LOCATION_HAND,0,nil,${targetCode}):GetFirst()
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
      e:SetOperation(function(e,tp) Debug.Message("obsidian responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function resolveEngineChain(session: DuelSession): void {
  while (session.state.chain.length > 0) {
    const player = session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLegalActions(session, player!).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLegalActions(session, player!), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player!), null, 2)).toBeDefined();
    const response = applyLuaRestoreResponse(restored, pass!);
    expect(response.ok, response.error).toBe(true);
  }
}
