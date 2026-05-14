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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Goblin Pothole chain-limit restore", () => {
  it("restores the summon-success Trap activation limit from the Project Ignis script", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sourceCode = "12755462";
    const starterCode = "200";
    const blockedTrapCode = "300";
    const allowedTrapCode = "400";
    const sourceCards = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sourceCode);
    const cards: DuelCardData[] = [
      ...sourceCards,
      { code: starterCode, name: "Open Chain Starter", kind: "monster" },
      { code: blockedTrapCode, name: "Blocked Trap Activation", kind: "trap" },
      { code: allowedTrapCode, name: "Allowed Trap Quick Effect", kind: "trap" },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 438, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sourceCode, starterCode] }, 1: { main: [blockedTrapCode, allowedTrapCode] } });
    startDuel(session);

    const sourceCard = session.state.cards.find((card) => card.code === sourceCode && card.location === "deck");
    const starter = session.state.cards.find((card) => card.code === starterCode && card.location === "deck");
    const blockedTrap = session.state.cards.find((card) => card.code === blockedTrapCode && card.location === "deck");
    const allowedTrap = session.state.cards.find((card) => card.code === allowedTrapCode && card.location === "deck");
    expect(sourceCard).toBeDefined();
    expect(starter).toBeDefined();
    expect(blockedTrap).toBeDefined();
    expect(allowedTrap).toBeDefined();
    moveDuelCard(session.state, sourceCard!.uid, "hand", 0);
    moveDuelCard(session.state, starter!.uid, "hand", 0);
    moveDuelCard(session.state, blockedTrap!.uid, "hand", 1);
    moveDuelCard(session.state, allowedTrap!.uid, "hand", 1);

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return openQuickScript("real-script chain starter resolved");
        if (name === `c${blockedTrapCode}.lua`) return chainOnlyScript("blocked trap activation resolved", "EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE");
        if (name === `c${allowedTrapCode}.lua`) return chainOnlyScript("allowed trap quick effect resolved", "EFFECT_TYPE_QUICK_O");
        return workspace.readScript(name);
      },
    };

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sourceCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(blockedTrapCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(allowedTrapCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);

    const summon = getLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === sourceCard!.uid);
    expect(summon).toBeDefined();
    expect(applyResponse(session, summon!).ok).toBe(true);

    const registryKey = `lua-chain-limit:${sourceCode}:0:chain:known:closure:not-source-type-effect-type:4:16`;
    expect(serializeDuel(session).state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });
    const restoredOpenWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredOpenWindow.restoreComplete, restoredOpenWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredOpenWindow.missingRegistryKeys).toEqual([]);
    expect(restoredOpenWindow.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredOpenWindow.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });
    expect(getLuaRestoreLegalActionGroups(restoredOpenWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredOpenWindow.session, 0));

    const startChain = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === starter!.uid);
    expect(startChain).toBeDefined();
    expect(applyResponse(session, startChain!).ok).toBe(true);
    expect(getLegalActions(session, 1).some((action) => action.type === "activateEffect" && action.uid === blockedTrap!.uid)).toBe(false);
    expect(getLegalActions(session, 1).some((action) => action.type === "activateEffect" && action.uid === allowedTrap!.uid)).toBe(true);

    const restoredResponseWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredResponseWindow.restoreComplete, restoredResponseWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredResponseWindow.missingRegistryKeys).toEqual([]);
    expect(restoredResponseWindow.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredResponseWindow.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });
    expect(getLuaRestoreLegalActions(restoredResponseWindow, 1).some((action) => action.type === "activateEffect" && action.uid === blockedTrap!.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredResponseWindow, 1).some((action) => action.type === "activateEffect" && action.uid === allowedTrap!.uid)).toBe(true);
    expect(getLuaRestoreLegalActionGroups(restoredResponseWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredResponseWindow.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredResponseWindow, 1)).toEqual(getGroupedDuelLegalActions(restoredResponseWindow.session, 1));
  });

  it("restores the cloned field Trap Hole activation limit from the Project Ignis script", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sourceCode = "12755462";
    const summonedCode = "201";
    const starterCode = "202";
    const blockedTrapHoleCode = "301";
    const allowedTrapHoleQuickCode = "302";
    const allowedOffSetTrapCode = "303";
    const sourceCards = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sourceCode);
    const cards: DuelCardData[] = [
      ...sourceCards,
      { code: summonedCode, name: "Summoned Other Monster", kind: "monster" },
      { code: starterCode, name: "Open Chain Starter", kind: "monster" },
      { code: blockedTrapHoleCode, name: "Blocked Trap Hole Activation", kind: "trap", setcodes: [0x4c] },
      { code: allowedTrapHoleQuickCode, name: "Allowed Trap Hole Quick Effect", kind: "trap", setcodes: [0x4c] },
      { code: allowedOffSetTrapCode, name: "Allowed Off-Set Trap Activation", kind: "trap", setcodes: [0x123] },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 439, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sourceCode, summonedCode, starterCode] }, 1: { main: [blockedTrapHoleCode, allowedTrapHoleQuickCode, allowedOffSetTrapCode] } });
    startDuel(session);

    const sourceCard = session.state.cards.find((card) => card.code === sourceCode && card.location === "deck");
    const summoned = session.state.cards.find((card) => card.code === summonedCode && card.location === "deck");
    const starter = session.state.cards.find((card) => card.code === starterCode && card.location === "deck");
    const blockedTrapHole = session.state.cards.find((card) => card.code === blockedTrapHoleCode && card.location === "deck");
    const allowedTrapHoleQuick = session.state.cards.find((card) => card.code === allowedTrapHoleQuickCode && card.location === "deck");
    const allowedOffSetTrap = session.state.cards.find((card) => card.code === allowedOffSetTrapCode && card.location === "deck");
    expect(sourceCard).toBeDefined();
    expect(summoned).toBeDefined();
    expect(starter).toBeDefined();
    expect(blockedTrapHole).toBeDefined();
    expect(allowedTrapHoleQuick).toBeDefined();
    expect(allowedOffSetTrap).toBeDefined();
    moveDuelCard(session.state, sourceCard!.uid, "monsterZone", 0);
    sourceCard!.faceUp = true;
    sourceCard!.position = "faceUpAttack";
    moveDuelCard(session.state, summoned!.uid, "hand", 0);
    moveDuelCard(session.state, starter!.uid, "hand", 0);
    moveDuelCard(session.state, blockedTrapHole!.uid, "hand", 1);
    moveDuelCard(session.state, allowedTrapHoleQuick!.uid, "hand", 1);
    moveDuelCard(session.state, allowedOffSetTrap!.uid, "hand", 1);

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return openQuickScript("real-script setcode chain starter resolved");
        if (name === `c${blockedTrapHoleCode}.lua`) return chainOnlyScript("blocked trap hole activation resolved", "EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE");
        if (name === `c${allowedTrapHoleQuickCode}.lua`) return chainOnlyScript("allowed trap hole quick effect resolved", "EFFECT_TYPE_QUICK_O");
        if (name === `c${allowedOffSetTrapCode}.lua`) return chainOnlyScript("allowed off-set trap activation resolved", "EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE");
        return workspace.readScript(name);
      },
    };

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sourceCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(blockedTrapHoleCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(allowedTrapHoleQuickCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(allowedOffSetTrapCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(5);

    const summon = getLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeDefined();
    expect(applyResponse(session, summon!).ok).toBe(true);

    const registryKey = `lua-chain-limit:${sourceCode}:0:chain:known:closure:not-source-type-effect-type-setcode:4:16:76`;
    expect(serializeDuel(session).state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });
    const restoredOpenWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredOpenWindow.restoreComplete, restoredOpenWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredOpenWindow.missingRegistryKeys).toEqual([]);
    expect(restoredOpenWindow.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredOpenWindow.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });
    expect(getLuaRestoreLegalActionGroups(restoredOpenWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredOpenWindow.session, 0));

    const startChain = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === starter!.uid);
    expect(startChain).toBeDefined();
    expect(applyResponse(session, startChain!).ok).toBe(true);
    expect(getLegalActions(session, 1).some((action) => action.type === "activateEffect" && action.uid === blockedTrapHole!.uid)).toBe(false);
    expect(getLegalActions(session, 1).some((action) => action.type === "activateEffect" && action.uid === allowedTrapHoleQuick!.uid)).toBe(true);
    expect(getLegalActions(session, 1).some((action) => action.type === "activateEffect" && action.uid === allowedOffSetTrap!.uid)).toBe(true);

    const restoredResponseWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredResponseWindow.restoreComplete, restoredResponseWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredResponseWindow.missingRegistryKeys).toEqual([]);
    expect(restoredResponseWindow.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredResponseWindow.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });
    expect(getLuaRestoreLegalActions(restoredResponseWindow, 1).some((action) => action.type === "activateEffect" && action.uid === blockedTrapHole!.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredResponseWindow, 1).some((action) => action.type === "activateEffect" && action.uid === allowedTrapHoleQuick!.uid)).toBe(true);
    expect(getLuaRestoreLegalActions(restoredResponseWindow, 1).some((action) => action.type === "activateEffect" && action.uid === allowedOffSetTrap!.uid)).toBe(true);
    expect(getLuaRestoreLegalActionGroups(restoredResponseWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredResponseWindow.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredResponseWindow, 1)).toEqual(getGroupedDuelLegalActions(restoredResponseWindow.session, 1));
  });

  it("restores the chain-end Trap Hole activation limit after a Project Ignis special-summon event", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sourceCode = "12755462";
    const specialStarterCode = "211";
    const specialTargetCode = "212";
    const followUpStarterCode = "213";
    const blockedTrapHoleCode = "311";
    const allowedTrapHoleQuickCode = "312";
    const allowedOffSetTrapCode = "313";
    const sourceCards = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sourceCode);
    const cards: DuelCardData[] = [
      ...sourceCards,
      { code: specialStarterCode, name: "Special Summon Chain Starter", kind: "monster" },
      { code: specialTargetCode, name: "Special Summon Target", kind: "monster" },
      { code: followUpStarterCode, name: "Follow-Up Chain Starter", kind: "monster" },
      { code: blockedTrapHoleCode, name: "Blocked Chain-End Trap Hole Activation", kind: "trap", setcodes: [0x4c] },
      { code: allowedTrapHoleQuickCode, name: "Allowed Chain-End Trap Hole Quick Effect", kind: "trap", setcodes: [0x4c] },
      { code: allowedOffSetTrapCode, name: "Allowed Chain-End Off-Set Trap Activation", kind: "trap", setcodes: [0x123] },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 440, startingHandSize: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [sourceCode, specialStarterCode, specialTargetCode, followUpStarterCode] },
      1: { main: [blockedTrapHoleCode, allowedTrapHoleQuickCode, allowedOffSetTrapCode] },
    });
    startDuel(session);

    const sourceCard = session.state.cards.find((card) => card.code === sourceCode && card.location === "deck");
    const specialStarter = session.state.cards.find((card) => card.code === specialStarterCode && card.location === "deck");
    const specialTarget = session.state.cards.find((card) => card.code === specialTargetCode && card.location === "deck");
    const followUpStarter = session.state.cards.find((card) => card.code === followUpStarterCode && card.location === "deck");
    const blockedTrapHole = session.state.cards.find((card) => card.code === blockedTrapHoleCode && card.location === "deck");
    const allowedTrapHoleQuick = session.state.cards.find((card) => card.code === allowedTrapHoleQuickCode && card.location === "deck");
    const allowedOffSetTrap = session.state.cards.find((card) => card.code === allowedOffSetTrapCode && card.location === "deck");
    expect(sourceCard).toBeDefined();
    expect(specialStarter).toBeDefined();
    expect(specialTarget).toBeDefined();
    expect(followUpStarter).toBeDefined();
    expect(blockedTrapHole).toBeDefined();
    expect(allowedTrapHoleQuick).toBeDefined();
    expect(allowedOffSetTrap).toBeDefined();
    moveDuelCard(session.state, sourceCard!.uid, "monsterZone", 0);
    sourceCard!.faceUp = true;
    sourceCard!.position = "faceUpAttack";
    moveDuelCard(session.state, specialStarter!.uid, "hand", 0);
    moveDuelCard(session.state, specialTarget!.uid, "hand", 0);
    moveDuelCard(session.state, followUpStarter!.uid, "hand", 0);
    moveDuelCard(session.state, blockedTrapHole!.uid, "hand", 1);
    moveDuelCard(session.state, allowedTrapHoleQuick!.uid, "hand", 1);
    moveDuelCard(session.state, allowedOffSetTrap!.uid, "hand", 1);

    const source = {
      readScript(name: string) {
        if (name === `c${specialStarterCode}.lua`) return specialSummonFromHandScript("real-script chain-end special summon resolved", specialTargetCode);
        if (name === `c${followUpStarterCode}.lua`) return openQuickScript("real-script chain-end follow-up starter resolved");
        if (name === `c${blockedTrapHoleCode}.lua`) return chainOnlyScript("blocked chain-end trap hole activation resolved", "EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE");
        if (name === `c${allowedTrapHoleQuickCode}.lua`) return chainOnlyScript("allowed chain-end trap hole quick effect resolved", "EFFECT_TYPE_QUICK_O");
        if (name === `c${allowedOffSetTrapCode}.lua`) return chainOnlyScript("allowed chain-end off-set trap activation resolved", "EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE");
        return workspace.readScript(name);
      },
    };

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sourceCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(specialStarterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(followUpStarterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(blockedTrapHoleCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(allowedTrapHoleQuickCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(allowedOffSetTrapCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(6);

    const specialSummonChain = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === specialStarter!.uid);
    expect(specialSummonChain).toBeDefined();
    expect(applyResponse(session, specialSummonChain!).ok).toBe(true);
    passChain(session, 1);
    passChain(session, 0);
    expect(specialTarget!.location).toBe("monsterZone");

    const registryKey = `lua-chain-limit:${sourceCode}:0:chain:known:closure:not-source-type-effect-type-setcode:4:16:76`;
    expect(serializeDuel(session).state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });
    const restoredOpenWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredOpenWindow.restoreComplete, restoredOpenWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredOpenWindow.missingRegistryKeys).toEqual([]);
    expect(restoredOpenWindow.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredOpenWindow.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });
    expect(getLuaRestoreLegalActionGroups(restoredOpenWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredOpenWindow.session, 0));

    const startChain = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === followUpStarter!.uid);
    expect(startChain).toBeDefined();
    expect(applyResponse(session, startChain!).ok).toBe(true);
    expect(getLegalActions(session, 1).some((action) => action.type === "activateEffect" && action.uid === blockedTrapHole!.uid)).toBe(false);
    expect(getLegalActions(session, 1).some((action) => action.type === "activateEffect" && action.uid === allowedTrapHoleQuick!.uid)).toBe(true);
    expect(getLegalActions(session, 1).some((action) => action.type === "activateEffect" && action.uid === allowedOffSetTrap!.uid)).toBe(true);

    const restoredResponseWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredResponseWindow.restoreComplete, restoredResponseWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredResponseWindow.missingRegistryKeys).toEqual([]);
    expect(restoredResponseWindow.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredResponseWindow.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });
    expect(getLuaRestoreLegalActions(restoredResponseWindow, 1).some((action) => action.type === "activateEffect" && action.uid === blockedTrapHole!.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredResponseWindow, 1).some((action) => action.type === "activateEffect" && action.uid === allowedTrapHoleQuick!.uid)).toBe(true);
    expect(getLuaRestoreLegalActions(restoredResponseWindow, 1).some((action) => action.type === "activateEffect" && action.uid === allowedOffSetTrap!.uid)).toBe(true);
    expect(getLuaRestoreLegalActionGroups(restoredResponseWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredResponseWindow.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredResponseWindow, 1)).toEqual(getGroupedDuelLegalActions(restoredResponseWindow.session, 1));
  });
});

function openQuickScript(message: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("${message}") end)
      c:RegisterEffect(e)
    end
  `;
}

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

function specialSummonFromHandScript(message: string, targetCode: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp)
        local tc=Duel.SelectMatchingCard(tp,aux.FilterBoolFunction(Card.IsCode,${targetCode}),tp,LOCATION_HAND,0,1,1,nil):GetFirst()
        if tc then Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP_ATTACK) end
        Debug.Message("${message}")
      end)
      c:RegisterEffect(e)
    end
  `;
}

function passChain(session: ReturnType<typeof createDuel>, player: 0 | 1): void {
  const pass = getLegalActions(session, player).find((action) => action.type === "passChain");
  expect(pass).toBeDefined();
  expect(applyResponse(session, pass!).ok).toBe(true);
}
