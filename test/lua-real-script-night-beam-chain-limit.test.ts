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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Night Beam chain-limit restore", () => {
  it("restores the selected handler response block from the Project Ignis script", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sourceCode = "89882100";
    const blockedTargetCode = "301";
    const allowedResponderCode = "302";
    const sourceCards = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sourceCode);
    const cards: DuelCardData[] = [
      ...sourceCards,
      { code: blockedTargetCode, name: "Blocked Targeted Trap", kind: "trap" },
      { code: allowedResponderCode, name: "Allowed Untargeted Trap", kind: "trap" },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 442, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sourceCode] }, 1: { main: [blockedTargetCode, allowedResponderCode] } });
    startDuel(session);

    const sourceCard = session.state.cards.find((card) => card.code === sourceCode && card.location === "deck");
    const blockedTarget = session.state.cards.find((card) => card.code === blockedTargetCode && card.location === "deck");
    const allowedResponder = session.state.cards.find((card) => card.code === allowedResponderCode && card.location === "deck");
    expect(sourceCard).toBeDefined();
    expect(blockedTarget).toBeDefined();
    expect(allowedResponder).toBeDefined();
    moveDuelCard(session.state, sourceCard!.uid, "hand", 0);
    moveDuelCard(session.state, blockedTarget!.uid, "spellTrapZone", 1);
    blockedTarget!.faceUp = false;
    moveDuelCard(session.state, allowedResponder!.uid, "hand", 1);

    const source = {
      readScript(name: string) {
        if (name === `c${blockedTargetCode}.lua`) return chainOnlyQuickScript("blocked targeted trap resolved", "LOCATION_SZONE");
        if (name === `c${allowedResponderCode}.lua`) return chainOnlyQuickScript("allowed untargeted trap resolved", "LOCATION_HAND");
        return workspace.readScript(name);
      },
    };

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sourceCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(blockedTargetCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(allowedResponderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const sourceAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === sourceCard!.uid);
    expect(sourceAction).toBeDefined();
    expect(applyResponse(session, sourceAction!).ok).toBe(true);

    const registryKey = `lua-chain-limit:${sourceCode}:0:link:known:closure:card-not-handler:${blockedTarget!.uid}`;
    expect(serializeDuel(session).state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(getLegalActions(session, 1).some((action) => action.type === "activateEffect" && action.uid === blockedTarget!.uid)).toBe(false);
    expect(getLegalActions(session, 1).some((action) => action.type === "activateEffect" && action.uid === allowedResponder!.uid)).toBe(true);

    const restoredResponseWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredResponseWindow.restoreComplete, restoredResponseWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredResponseWindow.missingRegistryKeys).toEqual([]);
    expect(restoredResponseWindow.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredResponseWindow.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(getLuaRestoreLegalActions(restoredResponseWindow, 1).some((action) => action.type === "activateEffect" && action.uid === blockedTarget!.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredResponseWindow, 1).some((action) => action.type === "activateEffect" && action.uid === allowedResponder!.uid)).toBe(true);
    expect(getLuaRestoreLegalActionGroups(restoredResponseWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredResponseWindow.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredResponseWindow, 1)).toEqual(getGroupedDuelLegalActions(restoredResponseWindow.session, 1));
  });
});

function chainOnlyQuickScript(message: string, range: "LOCATION_HAND" | "LOCATION_SZONE"): string {
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
