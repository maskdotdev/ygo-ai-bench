import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
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
const typeSpirit = 0x200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Izanami Spirit Graveyard return", () => {
  it("restores its summon trigger discard cost, Graveyard Spirit target, and confirm-to-hand resolution", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const izanamiCode = "43543777";
    const costCode = "43543778";
    const targetSpiritCode = "43543779";
    const invalidMonsterCode = "43543780";
    const responderCode = "43543781";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === izanamiCode),
      { code: costCode, name: "Izanami Discard Cost", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: targetSpiritCode, name: "Izanami Graveyard Spirit", kind: "monster", typeFlags: typeMonster | typeEffect | typeSpirit, level: 4, attack: 1200, defense: 1200 },
      { code: invalidMonsterCode, name: "Izanami Graveyard Non-Spirit", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1400, defense: 1400 },
      { code: responderCode, name: "Izanami Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 435, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [izanamiCode, costCode, targetSpiritCode, invalidMonsterCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const izanami = session.state.cards.find((card) => card.code === izanamiCode);
    const cost = session.state.cards.find((card) => card.code === costCode);
    const targetSpirit = session.state.cards.find((card) => card.code === targetSpiritCode);
    const invalidMonster = session.state.cards.find((card) => card.code === invalidMonsterCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(izanami).toBeDefined();
    expect(cost).toBeDefined();
    expect(targetSpirit).toBeDefined();
    expect(invalidMonster).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, izanami!.uid, "hand", 0);
    moveDuelCard(session.state, cost!.uid, "hand", 0);
    moveDuelCard(session.state, targetSpirit!.uid, "graveyard", 0);
    moveDuelCard(session.state, invalidMonster!.uid, "graveyard", 0);
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
    expect(host.loadCardScript(Number(izanamiCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredSummonWindow.restoreComplete, restoredSummonWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSummonWindow.missingRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredSummonWindow, 0);
    const summon = getLuaRestoreLegalActions(restoredSummonWindow, 0).find((action) => action.type === "normalSummon" && action.uid === izanami!.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummonWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonWindow, summon!);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredSummonWindow.session), source, reader);
    expect(restoredTriggerWindow.restoreComplete, restoredTriggerWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTriggerWindow.missingRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === izanami!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);

    expect(restoredTriggerWindow.session.state.cards.find((card) => card.uid === cost!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredTriggerWindow.session.state.chain).toHaveLength(1);
    expect(restoredTriggerWindow.session.state.chain[0]).toMatchObject({
      sourceUid: izanami!.uid,
      eventName: "normalSummoned",
      eventCardUid: izanami!.uid,
      operationInfos: [{ category: 0x8, targetUids: [targetSpirit!.uid], count: 1, player: 0, parameter: 0 }],
    });
    expect(restoredTriggerWindow.session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "discarded", eventCode: 1018, eventCardUid: cost!.uid })]),
    );

    const restoredChainWindow = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expect(restoredChainWindow.restoreComplete, restoredChainWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChainWindow.missingRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredChainWindow, 1);
    const pass = getLuaRestoreLegalActions(restoredChainWindow, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredChainWindow, 1), null, 2)).toBeDefined();
    const resolved = applyLuaRestoreResponse(restoredChainWindow, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === targetSpirit!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === invalidMonster!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === cost!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === izanami!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredChainWindow.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "sentToHand", eventCode: 1012, eventCardUid: targetSpirit!.uid }),
        expect.objectContaining({ eventName: "confirmed", eventCode: 1211, eventPlayer: 1, eventUids: [targetSpirit!.uid] }),
        expect.objectContaining({ eventName: "sentToHandConfirmed", eventCode: 1212, eventPlayer: 1, eventUids: [targetSpirit!.uid] }),
      ]),
    );
    expect(restoredChainWindow.host.messages).toContain(`confirmed 1: ${targetSpiritCode}`);
    expect(restoredChainWindow.host.messages).not.toContain("izanami responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("izanami responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
