import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const asteriskCode = "38522377";
const meklordACode = "385223770";
const meklordBCode = "385223771";
const responderCode = "385223772";
const typeMonster = 0x1;
const typeEffect = 0x20;
const setMeklord = 0x13;
const raceMachine = 0x2000;

describe.skipIf(!hasUpstreamScripts)("Lua real script Meklord Asterisk summon send final ATK", () => {
  it("restores Special Summon trigger sending Meklord targets and setting ATK from operated group", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${asteriskCode}.lua`);
    expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_TOGRAVE)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
    expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("Duel.SelectTarget(tp,s.spfilter,tp,LOCATION_MZONE,0,1,5,e:GetHandler())");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,g,#g,0,0)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS):Filter(s.atkfilter,nil,e)");
    expect(script).toContain("Duel.SendtoGrave(g,REASON_EFFECT)");
    expect(script).toContain("local ct=Duel.GetOperatedGroup():Filter(Card.IsLocation,nil,LOCATION_GRAVE)");
    expect(script).toContain("for tc in aux.Next(ct) do");
    expect(script).toContain("local oatk=math.max(tc:GetTextAttack(),0)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(atk)");

    const cards: DuelCardData[] = [
      { code: asteriskCode, name: "Meklord Astro Dragon Asterisk", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setMeklord], race: raceMachine, level: 10, attack: 0, defense: 0 },
      { code: meklordACode, name: "Meklord Operated A", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setMeklord], race: raceMachine, level: 4, attack: 1400, defense: 1000 },
      { code: meklordBCode, name: "Meklord Operated B", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setMeklord], race: raceMachine, level: 4, attack: 1600, defense: 1000 },
      { code: responderCode, name: "Meklord Asterisk Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 38522377, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [asteriskCode, meklordACode, meklordBCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const asterisk = requireCard(session, asteriskCode);
    const meklordA = requireCard(session, meklordACode);
    const meklordB = requireCard(session, meklordBCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, asterisk.uid, "hand", 0);
    moveFaceUpAttack(session, meklordA, 0);
    moveFaceUpAttack(session, meklordB, 0);
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
    expect(host.loadCardScript(Number(asteriskCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    specialSummonDuelCard(session.state, asterisk.uid, 0);
    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-3-1102",
        sourceUid: asterisk.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: asterisk.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 2 },
      },
    ]);

    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === asterisk.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    expect(("operationInfos" in trigger! ? trigger!.operationInfos : []) ?? []).toEqual([]);
    applyRestoredAction(restoredTrigger, trigger!);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(restoredChain.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        effectId: "lua-3-1102",
        sourceUid: asterisk.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 2,
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: asterisk.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 2 },
        targetUids: [meklordA.uid, meklordB.uid],
        operationInfos: [{ category: 0x20, targetUids: [meklordA.uid, meklordB.uid], count: 2, player: 0, parameter: 0 }],
      },
    ]);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    const pass = getLuaRestoreLegalActions(restoredChain, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredChain, 1), null, 2)).toBeDefined();
    const response = applyLuaRestoreResponse(restoredChain, pass!);
    expect(response.ok, response.error).toBe(true);

    const resolvedAsterisk = restoredChain.session.state.cards.find((card) => card.uid === asterisk.uid);
    expect(resolvedAsterisk).toMatchObject({ location: "monsterZone", controller: 0, faceUp: true });
    expect(currentAttack(resolvedAsterisk, restoredChain.session.state)).toBe(3000);
    expect(restoredChain.session.state.cards.find((card) => card.uid === meklordA.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: asterisk.uid,
      reasonEffectId: 3,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === meklordB.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: asterisk.uid,
      reasonEffectId: 3,
    });
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" && [meklordA.uid, meklordB.uid].includes(event.eventCardUid ?? ""))).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: meklordA.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: asterisk.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: meklordB.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: asterisk.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 1 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: meklordA.uid,
        eventUids: [meklordA.uid, meklordB.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: asterisk.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId): void {
  moveDuelCard(session.state, card.uid, "monsterZone", controller);
  card.position = "faceUpAttack";
  card.faceUp = true;
  card.reason = duelReason.summon;
  card.reasonPlayer = controller;
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

function applyRestoredAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function() Debug.Message("asterisk responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
