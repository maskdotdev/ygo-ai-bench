import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
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
const keiosCode = "24635329";
const handSummonCode = "246353290";
const handSendCode = "246353291";
const fieldBoostCode = "246353292";
const responderCode = "246353293";
const typeMonster = 0x1;
const typeEffect = 0x20;
const setShaddoll = 0x9d;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Qadshaddoll Keios flip summon grave stat", () => {
  it("restores Shaddoll Flip hand summon and effect-to-Grave hand send field stat boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${keiosCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_SET)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_FLIP+EFFECT_TYPE_TRIGGER_O)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_HAND,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_DEFENSE)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,tc)");
    expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DEFCHANGE)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DELAY)");
    expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
    expect(script).toContain("return e:GetHandler():IsReason(REASON_EFFECT)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,nil,1,tp,LOCATION_HAND)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.disfilter,tp,LOCATION_HAND,0,1,1,c):GetFirst()");
    expect(script).toContain("Duel.SendtoGrave(tc,REASON_EFFECT)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetTargetRange(LOCATION_MZONE,0)");
    expect(script).toContain("e1:SetValue(tc:GetOriginalLevel()*100)");
    expect(script).toContain("Duel.RegisterEffect(e1,tp)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");

    const cards = keiosCards();
    const reader = createCardReader(cards);
    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        if (name === "keios-send-probe.lua") return sendKeiosProbeScript(keiosCode);
        return workspace.readScript(name);
      },
    };

    const flipSession = createDuel({ seed: 24635329, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(flipSession, { 0: { main: [keiosCode, handSummonCode] }, 1: { main: [responderCode] } });
    startDuel(flipSession);
    const flipKeios = requireCard(flipSession, keiosCode);
    const handSummon = requireCard(flipSession, handSummonCode);
    const responder = requireCard(flipSession, responderCode);
    moveDuelCard(flipSession.state, flipKeios.uid, "monsterZone", 0).position = "faceDownDefense";
    flipKeios.faceUp = false;
    moveDuelCard(flipSession.state, handSummon.uid, "hand", 0);
    moveDuelCard(flipSession.state, responder.uid, "hand", 1);
    flipSession.state.phase = "main1";
    flipSession.state.turnPlayer = 0;
    flipSession.state.waitingFor = 0;

    const flipHost = createLuaScriptHost(flipSession, workspace);
    expect(flipHost.loadCardScript(Number(keiosCode), source).ok).toBe(true);
    expect(flipHost.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(flipHost.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(flipSession), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const flip = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "flipSummon" && action.uid === flipKeios.uid);
    expect(flip, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, flip!);
    expect(restoredOpen.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        player: 0,
        effectId: "lua-1",
        sourceUid: flipKeios.uid,
        triggerBucket: "turnMandatory",
        eventName: "flipSummoned",
        eventCode: 1101,
        eventCardUid: flipKeios.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredFlipTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredFlipTrigger);
    expectRestoredLegalActions(restoredFlipTrigger, 0);
    const flipTrigger = getLuaRestoreLegalActions(restoredFlipTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === flipKeios.uid);
    expect(flipTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredFlipTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredFlipTrigger, flipTrigger!);
    expect(restoredFlipTrigger.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        effectId: "lua-1",
        sourceUid: flipKeios.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 0,
        eventName: "flipSummoned",
        eventCode: 1101,
        eventCardUid: flipKeios.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }],
      },
    ]);

    const restoredFlipChain = restoreDuelWithLuaScripts(serializeDuel(restoredFlipTrigger.session), source, reader);
    expectCleanRestore(restoredFlipChain);
    expectRestoredLegalActions(restoredFlipChain, 1);
    expect(getLuaRestoreLegalActions(restoredFlipChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredFlipChain);
    expect(restoredFlipChain.session.state.chain).toEqual([]);
    expect(restoredFlipChain.session.state.cards.find((card) => card.uid === handSummon.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
      summonType: "special",
    });
    expect(restoredFlipChain.host.messages).not.toContain("keios responder resolved");
    expect(restoredFlipChain.session.state.eventHistory.filter((event) => ["flipSummoned", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "flipSummoned",
        eventCode: 1101,
        eventCardUid: flipKeios.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: handSummon.uid,
        eventUids: [handSummon.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: flipKeios.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpDefense", sequence: 1 },
      },
    ]);

    const graveSession = createDuel({ seed: 24635330, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(graveSession, { 0: { main: [keiosCode, handSendCode, fieldBoostCode] }, 1: { main: [] } });
    startDuel(graveSession);
    const graveKeios = requireCard(graveSession, keiosCode);
    const handSend = requireCard(graveSession, handSendCode);
    const fieldBoost = requireCard(graveSession, fieldBoostCode);
    moveDuelCard(graveSession.state, graveKeios.uid, "monsterZone", 0).position = "faceUpAttack";
    graveKeios.faceUp = true;
    moveDuelCard(graveSession.state, handSend.uid, "hand", 0);
    moveDuelCard(graveSession.state, fieldBoost.uid, "monsterZone", 0).position = "faceUpAttack";
    fieldBoost.faceUp = true;
    graveSession.state.phase = "main1";
    graveSession.state.turnPlayer = 0;
    graveSession.state.waitingFor = 0;

    const graveHost = createLuaScriptHost(graveSession, workspace);
    expect(graveHost.loadCardScript(Number(keiosCode), source).ok).toBe(true);
    expect(graveHost.registerInitialEffects()).toBe(1);
    const previousGraveKeios = cardEventState(graveKeios);
    const probe = graveHost.loadScript(sendKeiosProbeScript(keiosCode), "keios-send-probe.lua");
    expect(probe.ok, probe.error).toBe(true);
    expect(graveHost.messages).toContain("keios sent 1");

    const restoredGraveTrigger = restoreDuelWithLuaScripts(serializeDuel(graveSession), source, reader);
    expectCleanRestore(restoredGraveTrigger);
    expectRestoredLegalActions(restoredGraveTrigger, 0);
    const pendingGrave = restoredGraveTrigger.session.state.pendingTriggers[0];
    expect(pendingGrave).toBeDefined();
    expect(restoredGraveTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        player: 0,
        effectId: pendingGrave!.effectId,
        sourceUid: graveKeios.uid,
        triggerBucket: "turnOptional",
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: graveKeios.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        eventPreviousState: previousGraveKeios,
        eventCurrentState: { ...previousGraveKeios, location: "graveyard" },
      },
    ]);
    const graveTrigger = getLuaRestoreLegalActions(restoredGraveTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === graveKeios.uid);
    expect(graveTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredGraveTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredGraveTrigger, graveTrigger!);

    expect(restoredGraveTrigger.session.state.chain).toEqual([]);
    expect(restoredGraveTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredGraveTrigger.session.state.cards.find((card) => card.uid === handSend.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: graveKeios.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredGraveTrigger.session.state.cards.find((card) => card.uid === fieldBoost.uid), restoredGraveTrigger.session.state)).toBe(1900);
    expect(currentDefense(restoredGraveTrigger.session.state.cards.find((card) => card.uid === fieldBoost.uid), restoredGraveTrigger.session.state)).toBe(1500);
    expect(restoredGraveTrigger.session.state.eventHistory.filter((event) => ["sentToGraveyard"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: graveKeios.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventPreviousState: previousGraveKeios,
        eventCurrentState: { ...previousGraveKeios, location: "graveyard" },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: handSend.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: graveKeios.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 1 },
      },
    ]);
  });
});

function keiosCards(): DuelCardData[] {
  return [
    { code: keiosCode, name: "Qadshaddoll Keios", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setShaddoll], level: 2, attack: 900, defense: 100 },
    { code: handSummonCode, name: "Keios Hand Shaddoll Summon", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setShaddoll], level: 4, attack: 1300, defense: 1000 },
    { code: handSendCode, name: "Keios Hand Shaddoll Send", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setShaddoll], level: 4, attack: 1000, defense: 1000 },
    { code: fieldBoostCode, name: "Keios Field Boosted Monster", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setShaddoll], level: 4, attack: 1500, defense: 1100 },
    { code: responderCode, name: "Keios Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
  ];
}

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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const player = response.state.waitingFor as PlayerId | undefined;
  if (player === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player!), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
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
      e:SetOperation(function(e,tp) Debug.Message("keios responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function sendKeiosProbeScript(code: string): string {
  return `
    local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, ${code}), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
    Debug.Message("keios sent " .. Duel.SendtoGrave(c, REASON_EFFECT))
  `;
}
