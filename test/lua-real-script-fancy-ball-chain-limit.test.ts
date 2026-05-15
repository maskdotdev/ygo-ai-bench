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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script W:P Fancy Ball chain-limit restore", () => {
  it("restores the Project Ignis Link Monster response block from a real quick effect", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sourceCode = "4993187";
    const summonableLinkCode = "810";
    const allowedMonsterCode = "820";
    const blockedLinkCode = "830";
    const allowedSpellCode = "840";
    const sourceCards = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sourceCode);
    const cards: DuelCardData[] = [
      ...sourceCards,
      { code: summonableLinkCode, name: "Link Summonable Extra", kind: "extra", typeFlags: 0x4000001, level: 1 },
      { code: allowedMonsterCode, name: "Allowed Non-Link Monster Quick", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: blockedLinkCode, name: "Blocked Link Monster Quick", kind: "monster", typeFlags: 0x4000001, level: 2 },
      { code: allowedSpellCode, name: "Allowed Spell Quick", kind: "spell", typeFlags: 0x2 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 446, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [allowedMonsterCode, blockedLinkCode, allowedSpellCode] }, 1: { main: [], extra: [sourceCode, summonableLinkCode] } });
    startDuel(session);

    const sourceCard = session.state.cards.find((card) => card.code === sourceCode && card.location === "extraDeck");
    const allowedMonster = session.state.cards.find((card) => card.code === allowedMonsterCode && card.location === "deck");
    const blockedLink = session.state.cards.find((card) => card.code === blockedLinkCode && card.location === "deck");
    const allowedSpell = session.state.cards.find((card) => card.code === allowedSpellCode && card.location === "deck");
    expect(sourceCard).toBeDefined();
    expect(allowedMonster).toBeDefined();
    expect(blockedLink).toBeDefined();
    expect(allowedSpell).toBeDefined();
    moveDuelCard(session.state, sourceCard!.uid, "monsterZone", 1);
    sourceCard!.faceUp = true;
    moveDuelCard(session.state, allowedMonster!.uid, "hand", 0);
    moveDuelCard(session.state, blockedLink!.uid, "hand", 0);
    moveDuelCard(session.state, allowedSpell!.uid, "hand", 0);
    session.state.waitingFor = 1;

    const source = {
      readScript(name: string) {
        if (name === `c${allowedMonsterCode}.lua`) return chainOnlyQuickScript("allowed non-link monster resolved");
        if (name === `c${blockedLinkCode}.lua`) return chainOnlyQuickScript("blocked link monster resolved");
        if (name === `c${allowedSpellCode}.lua`) return chainOnlyQuickScript("allowed spell resolved");
        return workspace.readScript(name);
      },
    };

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sourceCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(allowedMonsterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(blockedLinkCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(allowedSpellCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);

    const sourceAction = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === sourceCard!.uid);
    expect(sourceAction).toBeDefined();
    expect(applyResponse(session, sourceAction!).ok).toBe(true);

    const registryKey = `lua-chain-limit:${sourceCode}:1:link:known:closure:not-active-monster-link`;
    expect(serializeDuel(session).state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(hasActivateEffect(getLegalActions(session, 0), allowedMonster!.uid)).toBe(true);
    expect(hasActivateEffect(getLegalActions(session, 0), blockedLink!.uid)).toBe(false);
    expect(hasActivateEffect(getLegalActions(session, 0), allowedSpell!.uid)).toBe(true);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(hasActivateEffect(getLuaRestoreLegalActions(restored, 0), allowedMonster!.uid)).toBe(true);
    expect(hasActivateEffect(getLuaRestoreLegalActions(restored, 0), blockedLink!.uid)).toBe(false);
    expect(hasActivateEffect(getLuaRestoreLegalActions(restored, 0), allowedSpell!.uid)).toBe(true);
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
