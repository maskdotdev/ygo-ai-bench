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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Mystical Space Typhoon free-chain target", () => {
  it("restores Mystical Space Typhoon's backrow target and destroys it", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const mstCode = "5318639";
    const starterCode = "891";
    const responderCode = "892";
    const targetTrapCode = "893";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === mstCode),
      { code: starterCode, name: "MST Chain Starter", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "MST Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: targetTrapCode, name: "MST Target Backrow", kind: "trap", typeFlags: 0x4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 466, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [starterCode, responderCode, targetTrapCode] }, 1: { main: [mstCode] } });
    startDuel(session);

    const starter = session.state.cards.find((card) => card.code === starterCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    const targetTrap = session.state.cards.find((card) => card.code === targetTrapCode);
    const mst = session.state.cards.find((card) => card.code === mstCode);
    expect(starter).toBeDefined();
    expect(responder).toBeDefined();
    expect(targetTrap).toBeDefined();
    expect(mst).toBeDefined();
    moveDuelCard(session.state, starter!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 0);
    moveDuelCard(session.state, targetTrap!.uid, "spellTrapZone", 0);
    targetTrap!.position = "faceDown";
    targetTrap!.faceUp = false;
    moveDuelCard(session.state, mst!.uid, "spellTrapZone", 1);
    mst!.position = "faceDown";
    mst!.faceUp = false;
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
    expect(host.loadCardScript(Number(mstCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const starterAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === starter!.uid);
    expect(starterAction).toBeDefined();
    applyAndAssert(session, starterAction!);
    expect(session.state.chain).toHaveLength(1);

    const mstAction = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === mst!.uid);
    expect(mstAction).toBeDefined();
    applyAndAssert(session, mstAction!);
    expect(session.state.chain).toHaveLength(2);
    expect(session.state.chain[1]).toMatchObject({
      sourceUid: mst!.uid,
      targetUids: [targetTrap!.uid],
      operationInfos: [{ category: 0x1, targetUids: [targetTrap!.uid], count: 1, player: 1, parameter: 0 }],
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.chain).toHaveLength(2);
    expect(restored.session.state.chain[1]).toMatchObject({
      sourceUid: mst!.uid,
      targetUids: [targetTrap!.uid],
      operationInfos: [{ category: 0x1, targetUids: [targetTrap!.uid], count: 1, player: 1, parameter: 0 }],
    });

    const pass = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === targetTrap!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === mst!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.host.messages).toContain("mst chain starter resolved");
    expect(restored.host.messages).not.toContain("mst chain responder resolved");
  });
});

function chainStarterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("mst chain starter resolved") end)
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
      e:SetOperation(function(e,tp) Debug.Message("mst chain responder resolved") end)
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
