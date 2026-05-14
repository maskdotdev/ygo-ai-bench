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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Borrelend Dragon chain-limit restore", () => {
  it("restores Project Ignis response-matches-chain-player limits from a real quick effect", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sourceCode = "98630720";
    const rokketCode = "960";
    const targetCode = "970";
    const opponentQuickCode = "980";
    const chainPlayerQuickCode = "990";
    const sourceCards = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sourceCode);
    const cards: DuelCardData[] = [
      ...sourceCards,
      { code: rokketCode, name: "Rokket Graveyard Target", kind: "monster", typeFlags: 0x21, setcodes: [0x102], level: 4 },
      { code: targetCode, name: "Opponent Negatable Monster", kind: "monster", typeFlags: 0x21, level: 4 },
      { code: opponentQuickCode, name: "Opponent Quick", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: chainPlayerQuickCode, name: "Chain Player Quick", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 445, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [rokketCode, chainPlayerQuickCode], extra: [sourceCode] }, 1: { main: [targetCode, opponentQuickCode] } });
    startDuel(session);

    const sourceCard = session.state.cards.find((card) => card.code === sourceCode && card.location === "extraDeck");
    const rokket = session.state.cards.find((card) => card.code === rokketCode && card.location === "deck");
    const target = session.state.cards.find((card) => card.code === targetCode && card.location === "deck");
    const opponentQuick = session.state.cards.find((card) => card.code === opponentQuickCode && card.location === "deck");
    const chainPlayerQuick = session.state.cards.find((card) => card.code === chainPlayerQuickCode && card.location === "deck");
    expect(sourceCard).toBeDefined();
    expect(rokket).toBeDefined();
    expect(target).toBeDefined();
    expect(opponentQuick).toBeDefined();
    expect(chainPlayerQuick).toBeDefined();
    moveDuelCard(session.state, sourceCard!.uid, "monsterZone", 0);
    sourceCard!.faceUp = true;
    moveDuelCard(session.state, rokket!.uid, "graveyard", 0);
    rokket!.faceUp = true;
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);
    target!.faceUp = true;
    moveDuelCard(session.state, opponentQuick!.uid, "hand", 1);
    moveDuelCard(session.state, chainPlayerQuick!.uid, "hand", 0);

    const source = {
      readScript(name: string) {
        if (name === `c${opponentQuickCode}.lua`) return chainOnlyQuickScript("opponent quick resolved");
        if (name === `c${chainPlayerQuickCode}.lua`) return chainOnlyQuickScript("chain-player quick resolved");
        return workspace.readScript(name);
      },
    };

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sourceCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(opponentQuickCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(chainPlayerQuickCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const sourceAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === sourceCard!.uid);
    expect(sourceAction).toBeDefined();
    expect(applyResponse(session, sourceAction!).ok).toBe(true);

    const registryKey = `lua-chain-limit:${sourceCode}:0:link:known:closure:response-matches-chain-player`;
    expect(serializeDuel(session).state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(getLegalActions(session, 1)).toEqual([]);
    expect(hasActivateEffect(getLegalActions(session, 0), chainPlayerQuick!.uid)).toBe(true);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);
    expect(hasActivateEffect(getLuaRestoreLegalActions(restored, 0), chainPlayerQuick!.uid)).toBe(true);

    const restoredAction = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === chainPlayerQuick!.uid);
    expect(restoredAction).toBeDefined();
    expect(applyLuaRestoreResponse(restored, restoredAction!).ok).toBe(true);
  });
});

function chainOnlyQuickScript(message: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("${message}") end)
      c:RegisterEffect(e)
    end
  `;
}

function hasActivateEffect(actions: ReturnType<typeof getLegalActions>, uid: string): boolean {
  return actions.some((action) => action.type === "activateEffect" && action.uid === uid);
}
