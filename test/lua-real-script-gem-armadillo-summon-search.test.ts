import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const setGemKnight = 0x1047;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Gem-Armadillo summon search", () => {
  it("restores EVENT_SUMMON_SUCCESS Deck search-to-hand and confirmation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const gemArmadilloCode = "27004302";
    const searchTargetCode = "27004303";
    const invalidMonsterCode = "27004304";
    const invalidSpellCode = "27004305";
    const responderCode = "27004306";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === gemArmadilloCode),
      { code: searchTargetCode, name: "Gem-Armadillo Gem-Knight Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setGemKnight], level: 4 },
      { code: invalidMonsterCode, name: "Gem-Armadillo Off-Set Monster", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4 },
      { code: invalidSpellCode, name: "Gem-Armadillo Off-Type Gem-Knight", kind: "spell", typeFlags: typeSpell, setcodes: [setGemKnight] },
      { code: responderCode, name: "Gem-Armadillo Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 270, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [gemArmadilloCode, searchTargetCode, invalidMonsterCode, invalidSpellCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const gemArmadillo = session.state.cards.find((card) => card.code === gemArmadilloCode);
    const searchTarget = session.state.cards.find((card) => card.code === searchTargetCode);
    const invalidMonster = session.state.cards.find((card) => card.code === invalidMonsterCode);
    const invalidSpell = session.state.cards.find((card) => card.code === invalidSpellCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(gemArmadillo).toBeDefined();
    expect(searchTarget).toBeDefined();
    expect(invalidMonster).toBeDefined();
    expect(invalidSpell).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, gemArmadillo!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(gemArmadilloCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredSummonWindow.restoreComplete, restoredSummonWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSummonWindow.missingRegistryKeys).toEqual([]);
    expect(restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredSummonWindow, 0);
    const summon = getLuaRestoreLegalActions(restoredSummonWindow, 0).find((action) => action.type === "normalSummon" && action.uid === gemArmadillo!.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummonWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonWindow, summon!);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredSummonWindow.session), source, reader);
    expect(restoredTriggerWindow.restoreComplete, restoredTriggerWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTriggerWindow.missingRegistryKeys).toEqual([]);
    expect(restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    expect(restoredTriggerWindow.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-1-1100",
        sourceUid: gemArmadillo!.uid,
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: gemArmadillo!.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === gemArmadillo!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);
    expect(restoredTriggerWindow.session.state.chain).toEqual([
      {
        id: "chain-3",
        chainIndex: 1,
        effectId: "lua-1-1100",
        sourceUid: gemArmadillo!.uid,
        player: 0,
        activationLocation: "monsterZone",
        activationSequence: 0,
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: gemArmadillo!.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        operationInfos: [{ category: 8, count: 1, parameter: 1, player: 0, targetUids: [] }],
      },
    ]);

    const restoredSearchChain = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expect(restoredSearchChain.restoreComplete, restoredSearchChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSearchChain.missingRegistryKeys).toEqual([]);
    expect(restoredSearchChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredSearchChain, 1);
    const pass = getLuaRestoreLegalActions(restoredSearchChain, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredSearchChain, 1), null, 2)).toBeDefined();
    const resolved = applyLuaRestoreResponse(restoredSearchChain, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restoredSearchChain.session.state.cards.find((card) => card.uid === searchTarget!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredSearchChain.session.state.cards.find((card) => card.uid === invalidMonster!.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredSearchChain.session.state.cards.find((card) => card.uid === invalidSpell!.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredSearchChain.session.state.eventHistory.filter((event) => ["sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: searchTarget!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: gemArmadillo!.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventPlayer: 1,
        eventUids: [searchTarget!.uid],
        eventValue: 1,
        eventCardUid: searchTarget!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: gemArmadillo!.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToHandConfirmed",
        eventCode: 1212,
        eventPlayer: 1,
        eventUids: [searchTarget!.uid],
        eventValue: 1,
        eventCardUid: searchTarget!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: gemArmadillo!.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);
    expect(restoredSearchChain.host.messages).toEqual([`confirmed 1: ${searchTargetCode}`]);
    expect(restoredSearchChain.host.messages).not.toContain("gem-armadillo responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("gem-armadillo responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
}
