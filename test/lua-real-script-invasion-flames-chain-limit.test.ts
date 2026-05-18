import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Invasion of Flames chain-limit restore", () => {
  it("restores its summon-success Trap activation limit across the response window", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sourceCode = "26082229";
    const starterCode = "26082230";
    const blockedTrapCode = "26082231";
    const allowedTrapCode = "26082232";
    const sourceScript = workspace.readScript(`c${sourceCode}.lua`);
    expect(sourceScript).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_CONTINUOUS)");
    expect(sourceScript).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(sourceScript).toContain("Duel.SetChainLimitTillChainEnd(s.chlimit)");
    expect(sourceScript).toContain("return not re:GetHandler():IsTrap() or not re:IsHasType(EFFECT_TYPE_ACTIVATE)");

    const cards: DuelCardData[] = [
      { code: sourceCode, name: "Invasion of Flames", kind: "monster", typeFlags: typeMonster, level: 3, attack: 1300, defense: 1200 },
      { code: starterCode, name: "Invasion Chain Starter", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: blockedTrapCode, name: "Blocked Trap Activation", kind: "trap" },
      { code: allowedTrapCode, name: "Allowed Trap Quick Effect", kind: "trap" },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 26082229, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [sourceCode, starterCode] },
      1: { main: [blockedTrapCode, allowedTrapCode] },
    });
    startDuel(session);

    const sourceCard = session.state.cards.find((card) => card.code === sourceCode);
    const starter = session.state.cards.find((card) => card.code === starterCode);
    const blockedTrap = session.state.cards.find((card) => card.code === blockedTrapCode);
    const allowedTrap = session.state.cards.find((card) => card.code === allowedTrapCode);
    expect(sourceCard).toBeDefined();
    expect(starter).toBeDefined();
    expect(blockedTrap).toBeDefined();
    expect(allowedTrap).toBeDefined();
    moveDuelCard(session.state, sourceCard!.uid, "hand", 0);
    moveDuelCard(session.state, starter!.uid, "hand", 0);
    moveDuelCard(session.state, blockedTrap!.uid, "hand", 1);
    moveDuelCard(session.state, allowedTrap!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return quickScript("invasion starter resolved", "EFFECT_TYPE_QUICK_O", false);
        if (name === `c${blockedTrapCode}.lua`) return quickScript("blocked trap activation resolved", "EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE");
        if (name === `c${allowedTrapCode}.lua`) return quickScript("allowed trap quick effect resolved", "EFFECT_TYPE_QUICK_O");
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sourceCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(blockedTrapCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(allowedTrapCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredSummonWindow);
    expectRestoredLegalActions(restoredSummonWindow, 0);
    const summon = getLuaRestoreLegalActions(restoredSummonWindow, 0).find((action) => action.type === "normalSummon" && action.uid === sourceCard!.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummonWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonWindow, summon!);

    const registryKey = `lua-chain-limit:${sourceCode}:0:chain:known:closure:not-source-type-effect-type:4:16`;
    expect(serializeDuel(restoredSummonWindow.session).state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });

    const restoredOpenWindow = restoreDuelWithLuaScripts(serializeDuel(restoredSummonWindow.session), source, reader);
    expectCleanRestore(restoredOpenWindow);
    expect(restoredOpenWindow.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });
    expectRestoredLegalActions(restoredOpenWindow, 0);
    const startChain = getLuaRestoreLegalActions(restoredOpenWindow, 0).find((action) => action.type === "activateEffect" && action.uid === starter!.uid);
    expect(startChain, JSON.stringify(getLuaRestoreLegalActions(restoredOpenWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpenWindow, startChain!);

    expect(getLuaRestoreLegalActions(restoredOpenWindow, 1).some((action) => action.type === "activateEffect" && action.uid === blockedTrap!.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredOpenWindow, 1).some((action) => action.type === "activateEffect" && action.uid === allowedTrap!.uid)).toBe(true);
    const restoredResponseWindow = restoreDuelWithLuaScripts(serializeDuel(restoredOpenWindow.session), source, reader);
    expectCleanRestore(restoredResponseWindow);
    expect(restoredResponseWindow.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });
    expectRestoredLegalActions(restoredResponseWindow, 0);
    expectRestoredLegalActions(restoredResponseWindow, 1);
    expect(getLuaRestoreLegalActions(restoredResponseWindow, 1).some((action) => action.type === "activateEffect" && action.uid === blockedTrap!.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredResponseWindow, 1).some((action) => action.type === "activateEffect" && action.uid === allowedTrap!.uid)).toBe(true);

    passChain(restoredResponseWindow);
    expect(restoredResponseWindow.session.state.chainLimits).toEqual([]);
    expect(restoredResponseWindow.host.messages).toEqual(["invasion starter resolved"]);
    expect(restoredResponseWindow.host.messages).not.toContain("blocked trap activation resolved");
    expect(restoredResponseWindow.host.messages).not.toContain("allowed trap quick effect resolved");
  });
});

function quickScript(message: string, effectType: string, chainOnly = true): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(${effectType})
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      ${chainOnly ? "e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)" : ""}
      e:SetOperation(function(e,tp) Debug.Message("${message}") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function passChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  expect(result.legalActions).toEqual(getLegalActions(restored.session, result.state.waitingFor!));
  expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, result.state.waitingFor!));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}
