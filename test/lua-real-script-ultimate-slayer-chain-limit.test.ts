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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Ultimate Slayer chain-limit restore", () => {
  it("restores the Project Ignis monster-response block while allowing chain-player monster responses", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sourceCode = "2263869";
    const costCode = "910";
    const targetCode = "920";
    const blockedMonsterCode = "930";
    const allowedSpellCode = "940";
    const chainPlayerMonsterCode = "950";
    const sourceCards = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sourceCode);
    const cards: DuelCardData[] = [
      ...sourceCards,
      { code: costCode, name: "Extra Deck Xyz Cost", kind: "extra", typeFlags: 0x800001, level: 4 },
      { code: targetCode, name: "Opponent Xyz Target", kind: "monster", typeFlags: 0x800001, level: 4 },
      { code: blockedMonsterCode, name: "Blocked Monster Quick", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: allowedSpellCode, name: "Allowed Spell Quick", kind: "spell", typeFlags: 0x2 },
      { code: chainPlayerMonsterCode, name: "Chain Player Monster Quick", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 444, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sourceCode, chainPlayerMonsterCode], extra: [costCode] }, 1: { main: [targetCode, blockedMonsterCode, allowedSpellCode] } });
    startDuel(session);

    const sourceCard = session.state.cards.find((card) => card.code === sourceCode && card.location === "deck");
    const target = session.state.cards.find((card) => card.code === targetCode && card.location === "deck");
    const blockedMonster = session.state.cards.find((card) => card.code === blockedMonsterCode && card.location === "deck");
    const allowedSpell = session.state.cards.find((card) => card.code === allowedSpellCode && card.location === "deck");
    const chainPlayerMonster = session.state.cards.find((card) => card.code === chainPlayerMonsterCode && card.location === "deck");
    expect(sourceCard).toBeDefined();
    expect(target).toBeDefined();
    expect(blockedMonster).toBeDefined();
    expect(allowedSpell).toBeDefined();
    expect(chainPlayerMonster).toBeDefined();
    moveDuelCard(session.state, sourceCard!.uid, "hand", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);
    target!.faceUp = true;
    moveDuelCard(session.state, blockedMonster!.uid, "monsterZone", 1);
    blockedMonster!.faceUp = true;
    moveDuelCard(session.state, allowedSpell!.uid, "hand", 1);
    moveDuelCard(session.state, chainPlayerMonster!.uid, "monsterZone", 0);
    chainPlayerMonster!.faceUp = true;

    const source = {
      readScript(name: string) {
        if (name === `c${blockedMonsterCode}.lua`) return chainOnlyQuickScript("blocked monster quick resolved", "LOCATION_MZONE", "EFFECT_TYPE_QUICK_O");
        if (name === `c${allowedSpellCode}.lua`) return chainOnlyQuickScript("allowed spell quick resolved", "LOCATION_HAND", "EFFECT_TYPE_QUICK_O");
        if (name === `c${chainPlayerMonsterCode}.lua`) return chainOnlyQuickScript("chain-player monster quick resolved", "LOCATION_MZONE", "EFFECT_TYPE_QUICK_O");
        return workspace.readScript(name);
      },
    };

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sourceCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(blockedMonsterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(allowedSpellCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(chainPlayerMonsterCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);

    const sourceAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === sourceCard!.uid);
    expect(sourceAction).toBeDefined();
    expect(applyResponse(session, sourceAction!).ok).toBe(true);

    const registryKey = `lua-chain-limit:${sourceCode}:0:link:known:closure:not-active-type-response-player:1`;
    expect(serializeDuel(session).state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(hasActivateEffect(getLegalActions(session, 1), blockedMonster!.uid)).toBe(false);
    expect(hasActivateEffect(getLegalActions(session, 1), allowedSpell!.uid)).toBe(true);

    const restoredOpponentWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredOpponentWindow.restoreComplete, restoredOpponentWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredOpponentWindow.missingRegistryKeys).toEqual([]);
    expect(restoredOpponentWindow.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredOpponentWindow.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(hasActivateEffect(getLuaRestoreLegalActions(restoredOpponentWindow, 1), blockedMonster!.uid)).toBe(false);
    expect(hasActivateEffect(getLuaRestoreLegalActions(restoredOpponentWindow, 1), allowedSpell!.uid)).toBe(true);
    expect(getLuaRestoreLegalActionGroups(restoredOpponentWindow, 1)).toEqual(getGroupedDuelLegalActions(restoredOpponentWindow.session, 1));

    const opponentPass = getLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(opponentPass).toBeDefined();
    expect(applyResponse(session, opponentPass!).ok).toBe(true);
    expect(hasActivateEffect(getLegalActions(session, 0), chainPlayerMonster!.uid)).toBe(true);

    const restoredChainPlayerWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredChainPlayerWindow.restoreComplete, restoredChainPlayerWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChainPlayerWindow.missingRegistryKeys).toEqual([]);
    expect(restoredChainPlayerWindow.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredChainPlayerWindow.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(hasActivateEffect(getLuaRestoreLegalActions(restoredChainPlayerWindow, 0), chainPlayerMonster!.uid)).toBe(true);
    expect(getLuaRestoreLegalActionGroups(restoredChainPlayerWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredChainPlayerWindow.session, 0));
  });
});

function chainOnlyQuickScript(message: string, range: "LOCATION_HAND" | "LOCATION_MZONE", effectType: "EFFECT_TYPE_QUICK_O"): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(${effectType})
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
