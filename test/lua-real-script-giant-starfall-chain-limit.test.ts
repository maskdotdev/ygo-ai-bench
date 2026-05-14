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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Giant Starfall chain-limit restore", () => {
  it("restores the Project Ignis no-Level monster response block from a real Trap activation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sourceCode = "43986064";
    const targetCode = "810";
    const allowedMonsterCode = "820";
    const blockedNoLevelCode = "830";
    const allowedSpellCode = "840";
    const sourceCards = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sourceCode);
    const cards: DuelCardData[] = [
      ...sourceCards,
      { code: targetCode, name: "Face-Up No-Level Target", kind: "monster", typeFlags: 0x800001, level: 4 },
      { code: allowedMonsterCode, name: "Allowed Level Monster Quick", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: blockedNoLevelCode, name: "Blocked No-Level Monster Quick", kind: "monster", typeFlags: 0x800001, level: 4 },
      { code: allowedSpellCode, name: "Allowed Spell Quick", kind: "spell", typeFlags: 0x2 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 447, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sourceCode, targetCode] }, 1: { main: [allowedMonsterCode, blockedNoLevelCode, allowedSpellCode] } });
    startDuel(session);

    const sourceCard = session.state.cards.find((card) => card.code === sourceCode && card.location === "deck");
    const target = session.state.cards.find((card) => card.code === targetCode && card.location === "deck");
    const allowedMonster = session.state.cards.find((card) => card.code === allowedMonsterCode && card.location === "deck");
    const blockedNoLevel = session.state.cards.find((card) => card.code === blockedNoLevelCode && card.location === "deck");
    const allowedSpell = session.state.cards.find((card) => card.code === allowedSpellCode && card.location === "deck");
    expect(sourceCard).toBeDefined();
    expect(target).toBeDefined();
    expect(allowedMonster).toBeDefined();
    expect(blockedNoLevel).toBeDefined();
    expect(allowedSpell).toBeDefined();
    moveDuelCard(session.state, sourceCard!.uid, "spellTrapZone", 0);
    sourceCard!.faceUp = false;
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);
    target!.faceUp = true;
    target!.position = "faceUpAttack";
    moveDuelCard(session.state, allowedMonster!.uid, "hand", 1);
    moveDuelCard(session.state, blockedNoLevel!.uid, "hand", 1);
    moveDuelCard(session.state, allowedSpell!.uid, "hand", 1);

    const source = {
      readScript(name: string) {
        if (name === `c${allowedMonsterCode}.lua`) return chainOnlyQuickScript("allowed Level monster resolved");
        if (name === `c${blockedNoLevelCode}.lua`) return chainOnlyQuickScript("blocked no-Level monster resolved");
        if (name === `c${allowedSpellCode}.lua`) return chainOnlyQuickScript("allowed spell resolved");
        return workspace.readScript(name);
      },
    };

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sourceCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(allowedMonsterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(blockedNoLevelCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(allowedSpellCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);

    const sourceAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === sourceCard!.uid);
    expect(sourceAction).toBeDefined();
    expect(applyResponse(session, sourceAction!).ok).toBe(true);

    const registryKey = `lua-chain-limit:${sourceCode}:0:link:known:closure:not-monster-without-level`;
    expect(serializeDuel(session).state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(hasActivateEffect(getLegalActions(session, 1), allowedMonster!.uid)).toBe(true);
    expect(hasActivateEffect(getLegalActions(session, 1), blockedNoLevel!.uid)).toBe(false);
    expect(hasActivateEffect(getLegalActions(session, 1), allowedSpell!.uid)).toBe(true);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(hasActivateEffect(getLuaRestoreLegalActions(restored, 1), allowedMonster!.uid)).toBe(true);
    expect(hasActivateEffect(getLuaRestoreLegalActions(restored, 1), blockedNoLevel!.uid)).toBe(false);
    expect(hasActivateEffect(getLuaRestoreLegalActions(restored, 1), allowedSpell!.uid)).toBe(true);
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
