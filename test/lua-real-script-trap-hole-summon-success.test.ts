import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Trap Hole summon-success window", () => {
  it("restores Trap Hole's summon-success event target and destroys the summoned monster", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const trapHoleCode = "4206964";
    const starterCode = "860";
    const responderCode = "861";
    const summonedCode = "100";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === trapHoleCode),
      { code: starterCode, name: "Trap Hole Chain Starter", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "Trap Hole Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: summonedCode, name: "Trap Hole Summoned Monster", kind: "monster", typeFlags: 0x1, level: 4, attack: 1500, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 461, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [summonedCode, starterCode, responderCode] }, 1: { main: [trapHoleCode] } });
    startDuel(session);

    const summoned = session.state.cards.find((card) => card.code === summonedCode);
    const starter = session.state.cards.find((card) => card.code === starterCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    const trapHole = session.state.cards.find((card) => card.code === trapHoleCode);
    expect(summoned).toBeDefined();
    expect(starter).toBeDefined();
    expect(responder).toBeDefined();
    expect(trapHole).toBeDefined();
    moveDuelCard(session.state, summoned!.uid, "hand", 0);
    moveDuelCard(session.state, starter!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 0);
    moveDuelCard(session.state, trapHole!.uid, "spellTrapZone", 1);
    trapHole!.position = "faceDown";
    trapHole!.faceUp = false;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return chainStarterScript();
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(trapHoleCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const summon = getLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);
    expect(session.state.cards.find((card) => card.uid === summoned!.uid)).toMatchObject({ location: "monsterZone", faceUp: true, position: "faceUpAttack" });

    const starterAction = getLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.uid === starter!.uid);
    expect(starterAction).toBeDefined();
    applyAndAssert(session, starterAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchObject({ sourceUid: starter!.uid, eventName: "normalSummoned", eventCardUid: summoned!.uid });

    const trapHoleAction = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === trapHole!.uid);
    expect(trapHoleAction).toBeDefined();
    applyAndAssert(session, trapHoleAction!);
    expect(session.state.chain).toHaveLength(2);
    expect(session.state.chain[1]).toMatchObject({
      sourceUid: trapHole!.uid,
      eventName: "normalSummoned",
      eventCode: 1100,
      eventCardUid: summoned!.uid,
      targetUids: [summoned!.uid],
      operationInfos: [{ category: 0x1, targetUids: [summoned!.uid], count: 1, player: 0, parameter: 0 }],
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.chain).toHaveLength(2);
    expect(restored.session.state.chain[1]).toMatchObject({
      sourceUid: trapHole!.uid,
      eventName: "normalSummoned",
      eventCode: 1100,
      eventCardUid: summoned!.uid,
      targetUids: [summoned!.uid],
      operationInfos: [{ category: 0x1, targetUids: [summoned!.uid], count: 1, player: 0, parameter: 0 }],
    });

    const pass = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === summoned!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === trapHole!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.host.messages).toContain("trap hole chain starter resolved");
    expect(restored.host.messages).not.toContain("trap hole responder resolved");
  });
});

function chainStarterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_TRIGGER_O)
      e:SetCode(EVENT_SUMMON_SUCCESS)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("trap hole chain starter resolved") end)
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
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>1 end)
      e:SetOperation(function(e,tp) Debug.Message("trap hole responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
