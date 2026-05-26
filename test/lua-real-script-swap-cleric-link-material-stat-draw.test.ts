import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const swapClericCode = "30968774";
const partnerCode = "309687740";
const linkCode = "309687741";
const drawCode = "309687742";
const responderCode = "309687743";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSwapClericScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${swapClericCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const eventBeMaterial = 1108;

describe.skipIf(!hasUpstreamScripts || !hasSwapClericScript)("Lua real script Swap Cleric Link material stat draw", () => {
  it("restores Link material reason-card targeting into ATK loss and CHAININFO draw", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${swapClericCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_BE_MATERIAL)");
    expect(script).toContain("EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_DELAY");
    expect(script).toContain("r & REASON_LINK == REASON_LINK");
    expect(script).toContain("local sc=e:GetHandler():GetReasonCard()");
    expect(script).toContain("Duel.SetTargetCard(sc)");
    expect(script).toContain("Duel.SetTargetPlayer(tp)");
    expect(script).toContain("Duel.SetTargetParam(1)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(-500)");
    expect(script).toContain("EFFECT_REVERSE_UPDATE");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 30968774, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [swapClericCode, partnerCode, drawCode], extra: [linkCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const cleric = requireCard(session, swapClericCode);
    const partner = requireCard(session, partnerCode);
    const link = requireCard(session, linkCode);
    const draw = requireCard(session, drawCode);
    const responder = requireCard(session, responderCode);
    moveFaceUpAttack(session, cleric, 0);
    moveFaceUpAttack(session, partner, 0);
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
    expect(host.loadCardScript(Number(swapClericCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const linkSummon = getLuaRestoreLegalActions(restoredOpen, 0).find(
      (action) => action.type === "linkSummon" && action.uid === link.uid && sameMembers(action.materialUids, [cleric.uid, partner.uid]),
    );
    expect(linkSummon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, linkSummon!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === cleric.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.material | duelReason.link,
      reasonCardUid: link.uid,
      reasonPlayer: 0,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === link.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "link",
      summonMaterialUids: [cleric.uid, partner.uid],
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "usedAsMaterial" && event.eventCardUid === cleric.uid)).toEqual([
      {
        eventName: "usedAsMaterial",
        eventCode: eventBeMaterial,
        eventCardUid: cleric.uid,
        eventReason: duelReason.link,
        eventReasonCardUid: link.uid,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restoredOpen.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-4-1",
        effectId: "lua-1-1108",
        eventCardUid: cleric.uid,
        eventCode: eventBeMaterial,
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventName: "usedAsMaterial",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventReason: duelReason.link,
        eventReasonCardUid: link.uid,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        player: 0,
        sourceUid: cleric.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === cleric.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([
      {
        id: "chain-7",
        chainIndex: 1,
        effectId: "lua-1-1108",
        sourceUid: cleric.uid,
        player: 0,
        activationLocation: "graveyard",
        activationSequence: 0,
        eventName: "usedAsMaterial",
        eventCode: eventBeMaterial,
        eventCardUid: cleric.uid,
        eventReason: duelReason.link,
        eventReasonPlayer: 0,
        eventReasonCardUid: link.uid,
        eventPlayer: 0,
        eventTriggerTiming: "if",
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        operationInfos: [
          { category: 0x10000, targetUids: [], count: 0, player: 0, parameter: 1 },
          { category: 0x200000, targetUids: [link.uid], count: 1, player: 0, parameter: 500 },
        ],
        targetParam: 1,
        targetPlayer: 0,
        targetFieldIds: [11],
        targetUids: [link.uid],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("swap cleric responder resolved");
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === link.uid), restoredChain.session.state)).toBe(1300);
    expect(restoredChain.session.state.cards.find((card) => card.uid === draw.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "cardsDrawn")).toEqual([
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventPlayer: 0,
        eventValue: 1,
        eventUids: [draw.uid],
        eventCardUid: draw.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: cleric.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: swapClericCode, name: "Swap Cleric", kind: "monster", typeFlags: typeMonster | typeEffect, level: 2, attack: 500, defense: 1000 },
    { code: partnerCode, name: "Swap Cleric Link Partner", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    { code: linkCode, name: "Swap Cleric Link Result", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, level: 2, attack: 1800, defense: 0, linkMaterials: [swapClericCode, partnerCode] },
    { code: drawCode, name: "Swap Cleric Draw Card", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    { code: responderCode, name: "Swap Cleric Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
      e:SetOperation(function(e,tp) Debug.Message("swap cleric responder resolved") end)
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
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function sameMembers(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}
