import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Obelisk chain-limit restore", () => {
  it("restores Obelisk's Project Ignis aux.FALSE summon-success chain limit", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const obeliskCode = "10000000";
    const tributeCode = "46986414";
    const starterCode = "840";
    const responderCode = "850";
    const realCards = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === obeliskCode || card.code === tributeCode);
    const cards: DuelCardData[] = [
      ...realCards,
      { code: starterCode, name: "Post-Obelisk Starter", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "Blocked Obelisk Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 449, startingHandSize: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [obeliskCode, tributeCode, tributeCode, tributeCode, starterCode] },
      1: { main: [responderCode] },
    });
    startDuel(session);

    const obelisk = session.state.cards.find((card) => card.code === obeliskCode && card.location === "deck");
    const tributes = session.state.cards.filter((card) => card.code === tributeCode && card.location === "deck");
    const starter = session.state.cards.find((card) => card.code === starterCode && card.location === "deck");
    const responder = session.state.cards.find((card) => card.code === responderCode && card.location === "deck");
    expect(obelisk).toBeDefined();
    expect(tributes).toHaveLength(3);
    expect(starter).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, obelisk!.uid, "hand", 0);
    for (const tribute of tributes) moveDuelCard(session.state, tribute.uid, "monsterZone", 0);
    moveDuelCard(session.state, starter!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return ignitionStarterScript();
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(obeliskCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const summon = getLegalActions(session, 0).find((action) => action.type === "tributeSummon" && action.uid === obelisk!.uid && action.tributeUids.length === 3);
    expect(summon).toBeDefined();
    const summoned = applyResponse(session, summon!);
    expect(summoned.ok, summoned.error).toBe(true);

    const registryKey = `lua-chain-limit:${obeliskCode}:0:chain:known:aux.FALSE`;
    const snapshot = serializeDuel(session);
    expect(queryPublicState(session)).toMatchObject({ waitingFor: 0, windowKind: "open" });
    expect(snapshot.state.chain).toEqual([]);
    expect(snapshot.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });

    const restored = restoreDuelWithLuaScripts(snapshot, source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });
    expect(queryPublicState(restored.session)).toMatchObject({ waitingFor: 0, windowKind: "open" });
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(hasActivateEffect(getLuaRestoreLegalActions(restored, 0), starter!.uid)).toBe(true);

    const nextChain = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === starter!.uid);
    expect(nextChain).toBeDefined();
    const resolved = applyResponse(restored.session, nextChain!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [] });
    expect(restored.session.state.chainLimits).toEqual([]);
    expect(restored.host.messages).toContain("post-obelisk starter resolved");
    expect(restored.host.messages).not.toContain("blocked obelisk responder resolved");
  });
});

function ignitionStarterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("post-obelisk starter resolved") end)
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
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("blocked obelisk responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function hasActivateEffect(actions: ReturnType<typeof getLegalActions>, uid: string): boolean {
  return actions.some((action) => action.type === "activateEffect" && action.uid === uid);
}
