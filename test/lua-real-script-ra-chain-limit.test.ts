import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Ra chain-limit restore", () => {
  it("restores Ra's summon-success handler-only chain limit from the Project Ignis script", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const raCode = "10000010";
    const tributeCode = "46986414";
    const responderCode = "200";
    const raCards = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === raCode || card.code === tributeCode);
    const cards: DuelCardData[] = [
      ...raCards,
      { code: responderCode, name: "Blocked Chain Responder", kind: "monster" },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 341, startingHandSize: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [raCode, tributeCode, tributeCode, tributeCode] },
      1: { main: [responderCode] },
    });
    startDuel(session);

    const ra = session.state.cards.find((card) => card.code === raCode && card.location === "deck");
    const tributes = session.state.cards.filter((card) => card.code === tributeCode && card.location === "deck");
    const responder = session.state.cards.find((card) => card.code === responderCode && card.location === "deck");
    expect(ra).toBeDefined();
    expect(tributes).toHaveLength(3);
    expect(responder).toBeDefined();
    moveDuelCard(session.state, ra!.uid, "hand", 0);
    for (const tribute of tributes) moveDuelCard(session.state, tribute.uid, "monsterZone", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);

    const source = {
      readScript(name: string) {
        if (name === `c${raCode}.lua`) {
          const script = workspace.readScript(name);
          return script === undefined ? undefined : `${script}\n${raSameHandlerQuickPatch()}`;
        }
        if (name === `c${responderCode}.lua`) return chainResponderScript(responderCode);
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(raCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "tributeSummon" && action.uid === ra!.uid && action.tributeUids.length === 3);
    expect(summon).toBeDefined();
    const summoned = applyResponse(session, summon!);
    expect(summoned.ok, summoned.error).toBe(true);

    const registryKey = `lua-chain-limit:${raCode}:0:chain:known:closure:card-handler:${ra!.uid}`;
    expect(serializeDuel(session).state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });
    const raTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.uid === ra!.uid);
    expect(raTrigger).toBeDefined();

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredTriggerWindow.restoreComplete, restoredTriggerWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTriggerWindow.missingRegistryKeys).toEqual([]);
    expect(restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredTriggerWindow.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });
    expect(getLuaRestoreLegalActionGroups(restoredTriggerWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredTriggerWindow.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredTriggerWindow, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredTriggerWindow, 0));

    const chained = applyResponse(session, raTrigger!);
    expect(chained.ok, chained.error).toBe(true);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.waitingFor).toBe(0);
    expect(getDuelLegalActions(session, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(false);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "activateEffect" && action.uid === ra!.uid)).toBe(true);

    const restoredResponseWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredResponseWindow.restoreComplete, restoredResponseWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredResponseWindow.missingRegistryKeys).toEqual([]);
    expect(restoredResponseWindow.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredResponseWindow.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });
    expect(getLuaRestoreLegalActions(restoredResponseWindow, 0).some((action) => action.type === "activateEffect" && action.uid === ra!.uid)).toBe(true);
    expect(getLuaRestoreLegalActions(restoredResponseWindow, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(false);
    expect(getLuaRestoreLegalActionGroups(restoredResponseWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredResponseWindow.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredResponseWindow, 1)).toEqual(getGroupedDuelLegalActions(restoredResponseWindow.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredResponseWindow, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredResponseWindow, 0));
    expect(getLuaRestoreLegalActionGroups(restoredResponseWindow, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredResponseWindow, 1));
  });
});

function raSameHandlerQuickPatch(): string {
  return `
    local __ra_initial_effect=s.initial_effect
    function s.initial_effect(c)
      __ra_initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetRange(LOCATION_MZONE)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("ra same-handler response resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function chainResponderScript(code: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("blocked responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
