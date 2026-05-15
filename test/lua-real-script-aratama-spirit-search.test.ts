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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Aratama Spirit search", () => {
  it("restores its summon trigger and searches a Spirit monster from Deck", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const aratamaCode = "16889337";
    const searchedSpiritCode = "94889337";
    const invalidMonsterCode = "94889338";
    const responderCode = "94889339";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === aratamaCode),
      { code: searchedSpiritCode, name: "Aratama Search Spirit", kind: "monster", typeFlags: typeMonster | typeEffect | typeSpirit, level: 4 },
      { code: invalidMonsterCode, name: "Aratama Invalid Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4 },
      { code: responderCode, name: "Aratama Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 168, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [aratamaCode, searchedSpiritCode, invalidMonsterCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const aratama = session.state.cards.find((card) => card.code === aratamaCode && card.location === "deck");
    const searchedSpirit = session.state.cards.find((card) => card.code === searchedSpiritCode);
    const invalidMonster = session.state.cards.find((card) => card.code === invalidMonsterCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(aratama).toBeDefined();
    expect(searchedSpirit).toBeDefined();
    expect(invalidMonster).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, aratama!.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(aratamaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredSummonWindow.restoreComplete, restoredSummonWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSummonWindow.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredSummonWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredSummonWindow.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredSummonWindow, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredSummonWindow, 0));
    expect(getLuaRestoreLegalActions(restoredSummonWindow, 0)).toEqual(getDuelLegalActions(restoredSummonWindow.session, 0));
    const summon = getLuaRestoreLegalActions(restoredSummonWindow, 0).find((action) => action.type === "normalSummon" && action.uid === aratama!.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummonWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonWindow, summon!);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredSummonWindow.session), source, reader);
    expect(restoredTriggerWindow.restoreComplete, restoredTriggerWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTriggerWindow.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredTriggerWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredTriggerWindow.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredTriggerWindow, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredTriggerWindow, 0));
    expect(getLuaRestoreLegalActions(restoredTriggerWindow, 0)).toEqual(getDuelLegalActions(restoredTriggerWindow.session, 0));
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === aratama!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);
    expect(restoredTriggerWindow.session.state.chain).toHaveLength(1);
    expect(restoredTriggerWindow.session.state.chain[0]).toMatchObject({
      sourceUid: aratama!.uid,
      eventName: "normalSummoned",
      eventCardUid: aratama!.uid,
      operationInfos: [{ category: 0x8, targetUids: [], count: 1, player: 0, parameter: 0x1 }],
    });

    const restoredChainWindow = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expect(restoredChainWindow.restoreComplete, restoredChainWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChainWindow.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredChainWindow, 1)).toEqual(getGroupedDuelLegalActions(restoredChainWindow.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredChainWindow, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredChainWindow, 1));
    expect(getLuaRestoreLegalActions(restoredChainWindow, 1)).toEqual(getDuelLegalActions(restoredChainWindow.session, 1));
    const pass = getLuaRestoreLegalActions(restoredChainWindow, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredChainWindow, 1), null, 2)).toBeDefined();
    const resolved = applyLuaRestoreResponse(restoredChainWindow, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === searchedSpirit!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === invalidMonster!.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === aratama!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredChainWindow.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "sentToHand", eventCode: 1012, eventCardUid: searchedSpirit!.uid }),
        expect.objectContaining({ eventName: "confirmed", eventCode: 1211, eventPlayer: 1, eventUids: [searchedSpirit!.uid] }),
        expect.objectContaining({ eventName: "sentToHandConfirmed", eventCode: 1212, eventPlayer: 1, eventUids: [searchedSpirit!.uid] }),
      ]),
    );
    expect(restoredChainWindow.host.messages).toContain(`confirmed 1: ${searchedSpiritCode}`);
    expect(restoredChainWindow.host.messages).not.toContain("aratama responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("aratama responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
}
