import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Titanic Galaxy chain-limit restore", () => {
  it("restores the multi-target handler response block from the Project Ignis script", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sourceCode = "16110708";
    const blockedFirstCode = "301";
    const blockedSecondCode = "302";
    const allowedResponderCode = "303";
    const sourceCards = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sourceCode);
    const cards: DuelCardData[] = [
      ...sourceCards,
      { code: blockedFirstCode, name: "Blocked Hybrid Material 1", kind: "monster", typeFlags: 0x5, level: 9 },
      { code: blockedSecondCode, name: "Blocked Hybrid Material 2", kind: "monster", typeFlags: 0x5, level: 9 },
      { code: allowedResponderCode, name: "Allowed Hand Quick", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 443, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sourceCode] }, 1: { main: [blockedFirstCode, blockedSecondCode, allowedResponderCode] } });
    startDuel(session);

    const sourceCard = session.state.cards.find((card) => card.code === sourceCode && card.location === "deck");
    const blockedFirst = session.state.cards.find((card) => card.code === blockedFirstCode && card.location === "deck");
    const blockedSecond = session.state.cards.find((card) => card.code === blockedSecondCode && card.location === "deck");
    const allowedResponder = session.state.cards.find((card) => card.code === allowedResponderCode && card.location === "deck");
    expect(sourceCard).toBeDefined();
    expect(blockedFirst).toBeDefined();
    expect(blockedSecond).toBeDefined();
    expect(allowedResponder).toBeDefined();
    moveDuelCard(session.state, sourceCard!.uid, "monsterZone", 0);
    sourceCard!.faceUp = true;
    moveDuelCard(session.state, blockedFirst!.uid, "monsterZone", 1);
    blockedFirst!.faceUp = true;
    moveDuelCard(session.state, blockedSecond!.uid, "monsterZone", 1);
    blockedSecond!.faceUp = true;
    moveDuelCard(session.state, allowedResponder!.uid, "hand", 1);

    const source = {
      readScript(name: string) {
        if (name === `c${blockedFirstCode}.lua`) return chainOnlyQuickScript("blocked first material resolved", "LOCATION_MZONE");
        if (name === `c${blockedSecondCode}.lua`) return chainOnlyQuickScript("blocked second material resolved", "LOCATION_MZONE");
        if (name === `c${allowedResponderCode}.lua`) return chainOnlyQuickScript("allowed hand quick resolved", "LOCATION_HAND");
        return workspace.readScript(name);
      },
    };

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sourceCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(blockedFirstCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(blockedSecondCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(allowedResponderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);

    const sourceAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === sourceCard!.uid);
    expect(sourceAction).toBeDefined();
    expect(applyResponse(session, sourceAction!).ok).toBe(true);

    const blockedUids = [blockedFirst!.uid, blockedSecond!.uid].sort();
    const registryKey = `lua-chain-limit:${sourceCode}:0:link:known:closure:cards-not-handler:${blockedUids.map(encodeURIComponent).join(",")}`;
    expect(serializeDuel(session).state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(hasActivateEffect(getLegalActions(session, 1), blockedFirst!.uid)).toBe(false);
    expect(hasActivateEffect(getLegalActions(session, 1), blockedSecond!.uid)).toBe(false);
    expect(hasActivateEffect(getLegalActions(session, 1), allowedResponder!.uid)).toBe(true);

    const restoredResponseWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredResponseWindow.restoreComplete, restoredResponseWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredResponseWindow.missingRegistryKeys).toEqual([]);
    expect(restoredResponseWindow.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredResponseWindow.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(hasActivateEffect(getLuaRestoreLegalActions(restoredResponseWindow, 1), blockedFirst!.uid)).toBe(false);
    expect(hasActivateEffect(getLuaRestoreLegalActions(restoredResponseWindow, 1), blockedSecond!.uid)).toBe(false);
    expect(hasActivateEffect(getLuaRestoreLegalActions(restoredResponseWindow, 1), allowedResponder!.uid)).toBe(true);
    expect(getLuaRestoreLegalActionGroups(restoredResponseWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredResponseWindow.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredResponseWindow, 1)).toEqual(getGroupedDuelLegalActions(restoredResponseWindow.session, 1));

    const restoredAction = getLuaRestoreLegalActions(restoredResponseWindow, 1).find((action) => action.type === "activateEffect" && action.uid === allowedResponder!.uid);
    expect(restoredAction).toBeDefined();
    expect(applyLuaRestoreResponse(restoredResponseWindow, restoredAction!).ok).toBe(true);
  });
});

function chainOnlyQuickScript(message: string, range: "LOCATION_HAND" | "LOCATION_MZONE"): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(${range})
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("${message}") end)
      c:RegisterEffect(e)
    end
  `;
}

function hasActivateEffect(actions: ReturnType<typeof getLegalActions>, uid: string): boolean {
  return actions.some((action) => action.type === "activateEffect" && action.uid === uid);
}
