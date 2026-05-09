import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Goblin Pothole chain-limit restore", () => {
  it("restores the summon-success Trap activation limit from the Project Ignis script", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sourceCode = "12755462";
    const starterCode = "200";
    const blockedTrapCode = "300";
    const allowedTrapCode = "400";
    const sourceCards = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sourceCode);
    const cards: DuelCardData[] = [
      ...sourceCards,
      { code: starterCode, name: "Open Chain Starter", kind: "monster" },
      { code: blockedTrapCode, name: "Blocked Trap Activation", kind: "trap" },
      { code: allowedTrapCode, name: "Allowed Trap Quick Effect", kind: "trap" },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 438, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sourceCode, starterCode] }, 1: { main: [blockedTrapCode, allowedTrapCode] } });
    startDuel(session);

    const sourceCard = session.state.cards.find((card) => card.code === sourceCode && card.location === "deck");
    const starter = session.state.cards.find((card) => card.code === starterCode && card.location === "deck");
    const blockedTrap = session.state.cards.find((card) => card.code === blockedTrapCode && card.location === "deck");
    const allowedTrap = session.state.cards.find((card) => card.code === allowedTrapCode && card.location === "deck");
    expect(sourceCard).toBeDefined();
    expect(starter).toBeDefined();
    expect(blockedTrap).toBeDefined();
    expect(allowedTrap).toBeDefined();
    moveDuelCard(session.state, sourceCard!.uid, "hand", 0);
    moveDuelCard(session.state, starter!.uid, "hand", 0);
    moveDuelCard(session.state, blockedTrap!.uid, "hand", 1);
    moveDuelCard(session.state, allowedTrap!.uid, "hand", 1);

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return openQuickScript("real-script chain starter resolved");
        if (name === `c${blockedTrapCode}.lua`) return chainOnlyScript("blocked trap activation resolved", "EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE");
        if (name === `c${allowedTrapCode}.lua`) return chainOnlyScript("allowed trap quick effect resolved", "EFFECT_TYPE_QUICK_O");
        return workspace.readScript(name);
      },
    };

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sourceCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(blockedTrapCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(allowedTrapCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThanOrEqual(4);

    const summon = getLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === sourceCard!.uid);
    expect(summon).toBeDefined();
    expect(applyResponse(session, summon!).ok).toBe(true);

    const registryKey = `lua-chain-limit:${sourceCode}:0:chain:known:closure:not-source-type-effect-type:4:16`;
    expect(serializeDuel(session).state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });
    const restoredOpenWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredOpenWindow.restoreComplete, restoredOpenWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredOpenWindow.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredOpenWindow.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });
    expect(getLuaRestoreLegalActionGroups(restoredOpenWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredOpenWindow.session, 0));

    const startChain = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === starter!.uid);
    expect(startChain).toBeDefined();
    expect(applyResponse(session, startChain!).ok).toBe(true);
    expect(getLegalActions(session, 1).some((action) => action.type === "activateEffect" && action.uid === blockedTrap!.uid)).toBe(false);
    expect(getLegalActions(session, 1).some((action) => action.type === "activateEffect" && action.uid === allowedTrap!.uid)).toBe(true);

    const restoredResponseWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredResponseWindow.restoreComplete, restoredResponseWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredResponseWindow.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredResponseWindow.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });
    expect(getLuaRestoreLegalActions(restoredResponseWindow, 1).some((action) => action.type === "activateEffect" && action.uid === blockedTrap!.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredResponseWindow, 1).some((action) => action.type === "activateEffect" && action.uid === allowedTrap!.uid)).toBe(true);
    expect(getLuaRestoreLegalActionGroups(restoredResponseWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredResponseWindow.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredResponseWindow, 1)).toEqual(getGroupedDuelLegalActions(restoredResponseWindow.session, 1));
  });
});

function openQuickScript(message: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("${message}") end)
      c:RegisterEffect(e)
    end
  `;
}

function chainOnlyScript(message: string, effectType: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(${effectType})
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("${message}") end)
      c:RegisterEffect(e)
    end
  `;
}
