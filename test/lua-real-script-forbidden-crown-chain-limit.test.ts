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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Forbidden Crown chain-limit restore", () => {
  it("restores the monster-effect response block from the Project Ignis script", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sourceCode = "98829635";
    const targetCode = "201";
    const blockedMonsterCode = "301";
    const allowedSpellCode = "302";
    const allowedTrapCode = "303";
    const sourceCards = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sourceCode);
    const cards: DuelCardData[] = [
      ...sourceCards,
      { code: targetCode, name: "Face-Up Crown Target", kind: "monster" },
      { code: blockedMonsterCode, name: "Blocked Monster Quick Effect", kind: "monster" },
      { code: allowedSpellCode, name: "Allowed Spell Activation", kind: "spell" },
      { code: allowedTrapCode, name: "Allowed Trap Activation", kind: "trap" },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 441, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sourceCode, targetCode] }, 1: { main: [blockedMonsterCode, allowedSpellCode, allowedTrapCode] } });
    startDuel(session);

    const sourceCard = session.state.cards.find((card) => card.code === sourceCode && card.location === "deck");
    const target = session.state.cards.find((card) => card.code === targetCode && card.location === "deck");
    const blockedMonster = session.state.cards.find((card) => card.code === blockedMonsterCode && card.location === "deck");
    const allowedSpell = session.state.cards.find((card) => card.code === allowedSpellCode && card.location === "deck");
    const allowedTrap = session.state.cards.find((card) => card.code === allowedTrapCode && card.location === "deck");
    expect(sourceCard).toBeDefined();
    expect(target).toBeDefined();
    expect(blockedMonster).toBeDefined();
    expect(allowedSpell).toBeDefined();
    expect(allowedTrap).toBeDefined();
    moveDuelCard(session.state, sourceCard!.uid, "hand", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);
    target!.faceUp = true;
    target!.position = "faceUpAttack";
    moveDuelCard(session.state, blockedMonster!.uid, "hand", 1);
    moveDuelCard(session.state, allowedSpell!.uid, "hand", 1);
    moveDuelCard(session.state, allowedTrap!.uid, "hand", 1);

    const source = {
      readScript(name: string) {
        if (name === `c${blockedMonsterCode}.lua`) return chainOnlyScript("blocked monster quick effect resolved", "EFFECT_TYPE_QUICK_O");
        if (name === `c${allowedSpellCode}.lua`) return chainOnlyScript("allowed spell activation resolved", "EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE");
        if (name === `c${allowedTrapCode}.lua`) return chainOnlyScript("allowed trap activation resolved", "EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE");
        return workspace.readScript(name);
      },
    };

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sourceCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(blockedMonsterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(allowedSpellCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(allowedTrapCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);

    const sourceAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === sourceCard!.uid);
    expect(sourceAction).toBeDefined();
    expect(applyResponse(session, sourceAction!).ok).toBe(true);

    const registryKey = `lua-chain-limit:${sourceCode}:0:link:known:closure:not-active-type:1`;
    expect(serializeDuel(session).state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(getLegalActions(session, 1).some((action) => action.type === "activateEffect" && action.uid === blockedMonster!.uid)).toBe(false);
    expect(getLegalActions(session, 1).some((action) => action.type === "activateEffect" && action.uid === allowedSpell!.uid)).toBe(true);
    expect(getLegalActions(session, 1).some((action) => action.type === "activateEffect" && action.uid === allowedTrap!.uid)).toBe(true);

    const restoredResponseWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredResponseWindow.restoreComplete, restoredResponseWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredResponseWindow.missingRegistryKeys).toEqual([]);
    expect(restoredResponseWindow.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredResponseWindow.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expectRestoredLegalActions(restoredResponseWindow, 0);
    expectRestoredLegalActions(restoredResponseWindow, 1);
    expect(getLuaRestoreLegalActions(restoredResponseWindow, 1).some((action) => action.type === "activateEffect" && action.uid === blockedMonster!.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredResponseWindow, 1).some((action) => action.type === "activateEffect" && action.uid === allowedSpell!.uid)).toBe(true);
    expect(getLuaRestoreLegalActions(restoredResponseWindow, 1).some((action) => action.type === "activateEffect" && action.uid === allowedTrap!.uid)).toBe(true);
  });
});

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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
