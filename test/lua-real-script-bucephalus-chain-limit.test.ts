import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, collectDuelGroupedTriggerEffects, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Tri-Brigade Arms Bucephalus II chain-limit restore", () => {
  it("restores its summon-success until-chain-end response-player limit", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sourceCode = "10019086";
    const starterCode = "10019087";
    const controllerQuickCode = "10019088";
    const opponentQuickCode = "10019089";
    const sourceCards = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sourceCode);
    const cards: DuelCardData[] = [
      ...sourceCards,
      { code: starterCode, name: "Bucephalus Followup Starter", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: controllerQuickCode, name: "Bucephalus Controller Quick", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: opponentQuickCode, name: "Bucephalus Opponent Quick", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 10019086, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [starterCode, controllerQuickCode], extra: [sourceCode] }, 1: { main: [opponentQuickCode] } });
    startDuel(session);

    const sourceCard = session.state.cards.find((card) => card.code === sourceCode && card.location === "extraDeck");
    const starter = session.state.cards.find((card) => card.code === starterCode && card.location === "deck");
    const controllerQuick = session.state.cards.find((card) => card.code === controllerQuickCode && card.location === "deck");
    const opponentQuick = session.state.cards.find((card) => card.code === opponentQuickCode && card.location === "deck");
    expect(sourceCard).toBeDefined();
    expect(starter).toBeDefined();
    expect(controllerQuick).toBeDefined();
    expect(opponentQuick).toBeDefined();
    moveDuelCard(session.state, sourceCard!.uid, "monsterZone", 0);
    sourceCard!.faceUp = true;
    sourceCard!.summonType = "link";
    sourceCard!.summonPlayer = 0;
    moveDuelCard(session.state, starter!.uid, "hand", 0);
    moveDuelCard(session.state, controllerQuick!.uid, "hand", 0);
    moveDuelCard(session.state, opponentQuick!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return ignitionStarterScript();
        if (name === `c${controllerQuickCode}.lua`) return chainOnlyQuickScript("bucephalus controller quick resolved");
        if (name === `c${opponentQuickCode}.lua`) return chainOnlyQuickScript("bucephalus opponent quick resolved");
        return workspace.readScript(name);
      },
    };

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sourceCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(controllerQuickCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(opponentQuickCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);

    collectDuelGroupedTriggerEffects(session.state, "specialSummoned", [sourceCard!], { eventPlayer: 0, eventReasonPlayer: 0 });

    const registryKey = `lua-chain-limit:${sourceCode}:0:chain:known:closure:response-matches-chain-player`;
    const snapshot = serializeDuel(session);
    expect(queryPublicState(session)).toMatchObject({ waitingFor: 0, windowKind: "open" });
    expect(snapshot.state.chain).toEqual([]);
    expect(snapshot.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });

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
    const chained = applyLuaRestoreResponse(restored, starterAction!);
    expect(chained.ok, chained.error).toBe(true);
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);
    expect(hasActivateEffect(getLuaRestoreLegalActions(restored, 0), controllerQuick!.uid)).toBe(true);

    const quickAction = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === controllerQuick!.uid);
    expect(quickAction).toBeDefined();
    const response = applyLuaRestoreResponse(restored, quickAction!);
    expect(response.ok, response.error).toBe(true);
    expect(restored.session.state.chain).toHaveLength(2);
    expect(restored.session.state.chain[1]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 1,
        "chainIndex": 2,
        "effectId": "lua-2-1002",
        "id": "chain-4",
        "player": 0,
        "sourceUid": "p0-deck-10019088-1",
      }
    `);
    expect(restored.host.messages).not.toContain("bucephalus opponent quick resolved");
  });
});

function ignitionStarterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("bucephalus starter resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

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
