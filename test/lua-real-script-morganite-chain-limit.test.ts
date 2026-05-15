import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Time-Tearing Morganite chain-limit restore", () => {
  it("restores its Normal Summon until-chain-end monster response limit", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sourceCode = "19403423";
    const summonCode = "19403424";
    const opponentMonsterCode = "19403425";
    const opponentSpellCode = "19403426";
    const starterCode = "19403427";
    const sourceCards = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sourceCode);
    const cards: DuelCardData[] = [
      ...sourceCards,
      { code: summonCode, name: "Morganite Normal Summon", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: opponentMonsterCode, name: "Morganite Blocked Monster", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: opponentSpellCode, name: "Morganite Allowed Spell", kind: "spell", typeFlags: 0x2 },
      { code: starterCode, name: "Morganite Followup Starter", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 19403423, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sourceCode, sourceCode, summonCode, starterCode] }, 1: { main: [opponentMonsterCode, opponentSpellCode] } });
    startDuel(session);

    const graveMorganite = session.state.cards.find((card) => card.code === sourceCode && card.location === "deck");
    const discardMorganite = session.state.cards.find((card) => card.code === sourceCode && card.uid !== graveMorganite?.uid);
    const normalSummon = session.state.cards.find((card) => card.code === summonCode && card.location === "deck");
    const starter = session.state.cards.find((card) => card.code === starterCode && card.location === "deck");
    const opponentMonster = session.state.cards.find((card) => card.code === opponentMonsterCode && card.location === "deck");
    const opponentSpell = session.state.cards.find((card) => card.code === opponentSpellCode && card.location === "deck");
    expect(graveMorganite).toBeDefined();
    expect(discardMorganite).toBeDefined();
    expect(normalSummon).toBeDefined();
    expect(starter).toBeDefined();
    expect(opponentMonster).toBeDefined();
    expect(opponentSpell).toBeDefined();
    moveDuelCard(session.state, graveMorganite!.uid, "graveyard", 0);
    moveDuelCard(session.state, discardMorganite!.uid, "hand", 0);
    moveDuelCard(session.state, normalSummon!.uid, "hand", 0);
    moveDuelCard(session.state, starter!.uid, "hand", 0);
    moveDuelCard(session.state, opponentMonster!.uid, "hand", 1);
    moveDuelCard(session.state, opponentSpell!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${opponentMonsterCode}.lua`) return chainOnlyMonsterScript("morganite blocked monster resolved");
        if (name === `c${opponentSpellCode}.lua`) return chainOnlySpellScript("morganite allowed spell resolved");
        if (name === `c${starterCode}.lua`) return ignitionStarterScript("morganite starter resolved");
        return workspace.readScript(name);
      },
    };

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sourceCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(opponentMonsterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(opponentSpellCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(5);

    const graveAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === graveMorganite!.uid);
    expect(graveAction, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    expect(applyResponse(session, graveAction!).ok).toBe(true);
    passChain(session, 1);

    const summonAction = getLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === normalSummon!.uid);
    expect(summonAction, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    expect(applyResponse(session, summonAction!).ok).toBe(true);

    const registryKey = `lua-chain-limit:${sourceCode}:0:chain:known:closure:not-active-type-response-player:1`;
    const snapshot = serializeDuel(session);
    expect(queryPublicState(session)).toMatchObject({ waitingFor: 0, windowKind: "open" });
    expect(snapshot.state.chain).toEqual([]);
    expect(snapshot.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });
    expect(hasActivateEffect(getLegalActions(session, 0), starter!.uid)).toBe(true);

    const restored = restoreDuelWithLuaScripts(snapshot, source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(hasActivateEffect(getLuaRestoreLegalActions(restored, 0), starter!.uid)).toBe(true);
    const starterAction = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === starter!.uid);
    expect(starterAction).toBeDefined();
    const chained = applyResponse(restored.session, starterAction!);
    expect(chained.ok, chained.error).toBe(true);
    expect(hasActivateEffect(getLuaRestoreLegalActions(restored, 1), opponentMonster!.uid)).toBe(false);
    expect(hasActivateEffect(getLuaRestoreLegalActions(restored, 1), opponentSpell!.uid)).toBe(true);
  });
});

function passChain(session: DuelSession, player: 0 | 1): void {
  const pass = getLegalActions(session, player).find((action) => action.type === "passChain");
  expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
  expect(applyResponse(session, pass!).ok).toBe(true);
}

function ignitionStarterScript(message: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("${message}") end)
      c:RegisterEffect(e)
    end
  `;
}

function chainOnlyMonsterScript(message: string): string {
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

function chainOnlySpellScript(message: string): string {
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
