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
const hasSpeedRecoveryScript = fs.existsSync(path.join(upstreamRoot, "script", "official", "c88204302.lua"));
const speedRecoveryCode = "88204302";
const reviveTargetCode = "88204303";
const offSetReviveDecoyCode = "88204304";
const toHandTargetCode = "88204305";
const offSetToHandDecoyCode = "88204306";
const responderCode = "88204307";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const setSpeedroid = 0x2016;

describe.skipIf(!hasUpstreamScripts || !hasSpeedRecoveryScript)("Lua real script Speed Recovery revive and self-banish to hand", () => {
  it("restores targeted Graveyard Speedroid summon and later aux.exccon self-banish add-to-hand", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${speedRecoveryCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("return c:IsSetCard(SET_SPEEDROID) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("e2:SetRange(LOCATION_GRAVE)");
    expect(script).toContain("e2:SetCondition(aux.exccon)");
    expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
    expect(script).toContain("return c:IsSetCard(SET_SPEEDROID) and c:IsMonster() and c:IsAbleToHand()");
    expect(script).toContain("Duel.SelectTarget(tp,s.thfilter,tp,LOCATION_GRAVE,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoHand(tc,nil,REASON_EFFECT)");

    const revive = createScenario(workspace);
    moveDuelCard(revive.session.state, revive.speedRecovery.uid, "hand", 0);
    moveDuelCard(revive.session.state, revive.reviveTarget.uid, "graveyard", 0);
    moveDuelCard(revive.session.state, revive.offSetReviveDecoy.uid, "graveyard", 0);
    moveDuelCard(revive.session.state, revive.responder.uid, "hand", 1);
    revive.session.state.phase = "main1";
    revive.session.state.waitingFor = 0;
    registerScripts(revive.session, workspace, revive.source);

    const activation = getLegalActions(revive.session, 0).find((action) => action.type === "activateEffect" && action.uid === revive.speedRecovery.uid);
    expect(activation, JSON.stringify(getLegalActions(revive.session, 0), null, 2)).toBeDefined();
    applyAndAssert(revive.session, activation!);
    expect(revive.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-1-1002",
        sourceUid: revive.speedRecovery.uid,
        player: 0,
        activationLocation: "hand",
        activationSequence: 0,
        targetFieldIds: [8],
        targetUids: [revive.reviveTarget.uid],
        operationInfos: [{ category: 0x200, targetUids: [revive.reviveTarget.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);

    const restoredRevive = restoreDuelWithLuaScripts(serializeDuel(revive.session), revive.source, revive.reader);
    expectCleanRestore(restoredRevive);
    expectRestoredLegalActions(restoredRevive, 1);
    expect(getLuaRestoreLegalActions(restoredRevive, 1).some((action) => action.type === "activateEffect" && action.uid === revive.responder.uid)).toBe(true);
    resolveRestoredChain(restoredRevive);
    expect(restoredRevive.session.state.cards.find((card) => card.uid === revive.speedRecovery.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredRevive.session.state.cards.find((card) => card.uid === revive.reviveTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: revive.speedRecovery.uid,
      reasonEffectId: 1,
    });
    expect(restoredRevive.session.state.cards.find((card) => card.uid === revive.offSetReviveDecoy.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredRevive.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === revive.reviveTarget.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: revive.reviveTarget.uid,
        eventUids: [revive.reviveTarget.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: revive.speedRecovery.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restoredRevive.host.messages).not.toContain("speed recovery responder resolved");

    const graveEffect = createScenario(workspace);
    moveDuelCard(graveEffect.session.state, graveEffect.speedRecovery.uid, "graveyard", 0).turnId = 0;
    moveDuelCard(graveEffect.session.state, graveEffect.toHandTarget.uid, "graveyard", 0);
    moveDuelCard(graveEffect.session.state, graveEffect.offSetToHandDecoy.uid, "graveyard", 0);
    moveDuelCard(graveEffect.session.state, graveEffect.responder.uid, "hand", 1);
    graveEffect.session.state.phase = "main1";
    graveEffect.session.state.waitingFor = 0;
    registerScripts(graveEffect.session, workspace, graveEffect.source);

    const toHand = getLegalActions(graveEffect.session, 0).find((action) => action.type === "activateEffect" && action.uid === graveEffect.speedRecovery.uid);
    expect(toHand, JSON.stringify(getLegalActions(graveEffect.session, 0), null, 2)).toBeDefined();
    applyAndAssert(graveEffect.session, toHand!);
    expect(graveEffect.session.state.cards.find((card) => card.uid === graveEffect.speedRecovery.uid)).toMatchObject({ location: "banished", controller: 0, faceUp: true });
    expect(graveEffect.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        effectId: "lua-2",
        sourceUid: graveEffect.speedRecovery.uid,
        player: 0,
        activationLocation: "graveyard",
        activationSequence: 0,
        targetFieldIds: [8],
        targetUids: [graveEffect.toHandTarget.uid],
        operationInfos: [{ category: 0x8, targetUids: [graveEffect.toHandTarget.uid], count: 1, player: 0, parameter: 0 }],
      },
    ]);

    const restoredToHand = restoreDuelWithLuaScripts(serializeDuel(graveEffect.session), graveEffect.source, graveEffect.reader);
    expectCleanRestore(restoredToHand);
    expectRestoredLegalActions(restoredToHand, 1);
    resolveRestoredChain(restoredToHand);
    expect(restoredToHand.session.state.cards.find((card) => card.uid === graveEffect.speedRecovery.uid)).toMatchObject({ location: "banished", controller: 0 });
    expect(restoredToHand.session.state.cards.find((card) => card.uid === graveEffect.toHandTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: graveEffect.speedRecovery.uid,
      reasonEffectId: 2,
    });
    expect(restoredToHand.session.state.cards.find((card) => card.uid === graveEffect.offSetToHandDecoy.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredToHand.session.state.eventHistory.filter((event) => ["banished", "sentToHand"].includes(event.eventName))).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: graveEffect.speedRecovery.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: graveEffect.speedRecovery.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: graveEffect.toHandTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: graveEffect.speedRecovery.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);
    expect(restoredToHand.host.messages).not.toContain("speed recovery responder resolved");
  });
});

function createScenario(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  const cards: DuelCardData[] = [
    { code: speedRecoveryCode, name: "Speed Recovery", kind: "spell", typeFlags: typeSpell },
    { code: reviveTargetCode, name: "Speed Recovery Revive Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setSpeedroid], level: 3, attack: 1200, defense: 800 },
    { code: offSetReviveDecoyCode, name: "Speed Recovery Off-Set Revive Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [0x123], level: 3, attack: 1200, defense: 800 },
    { code: toHandTargetCode, name: "Speed Recovery To-Hand Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setSpeedroid], level: 3, attack: 1000, defense: 1000 },
    { code: offSetToHandDecoyCode, name: "Speed Recovery Off-Set To-Hand Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [0x123], level: 3, attack: 1000, defense: 1000 },
    { code: responderCode, name: "Speed Recovery Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4 },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed: 88204302, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [speedRecoveryCode, reviveTargetCode, offSetReviveDecoyCode, toHandTargetCode, offSetToHandDecoyCode] }, 1: { main: [responderCode] } });
  startDuel(session);
  const source = {
    readScript(name: string) {
      if (name === `c${responderCode}.lua`) return chainResponderScript();
      const script = workspace.readScript(name);
      if (script === undefined) throw new Error(`Missing script ${name}`);
      return script;
    },
  };
  return {
    session,
    reader,
    source,
    speedRecovery: requireCard(session, speedRecoveryCode),
    reviveTarget: requireCard(session, reviveTargetCode),
    offSetReviveDecoy: requireCard(session, offSetReviveDecoyCode),
    toHandTarget: requireCard(session, toHandTargetCode),
    offSetToHandDecoy: requireCard(session, offSetToHandDecoyCode),
    responder: requireCard(session, responderCode),
  };
}

function registerScripts(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>, source: { readScript(name: string): string }): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(speedRecoveryCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
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
      e:SetOperation(function(e,tp) Debug.Message("speed recovery responder resolved") end)
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
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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
