import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeTrap = 0x4;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Galaxy Destroyer chain-limit restore", () => {
  it("restores the named activation-type response block from the Project Ignis script", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sourceCode = "66523544";
    const materialCode = "665235441";
    const opponentSpellCode = "665235442";
    const opponentTrapResponderCode = "665235443";
    const opponentMonsterResponderCode = "665235444";
    const chainPlayerTrapResponderCode = "665235445";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sourceCode),
      { code: materialCode, name: "Galaxy Destroyer Overlay Material", kind: "monster", typeFlags: typeMonster, level: 10, attack: 1000, defense: 1000 },
      { code: opponentSpellCode, name: "Galaxy Destroyer Destroy Target", kind: "spell", typeFlags: typeSpell },
      { code: opponentTrapResponderCode, name: "Blocked Opponent Trap Response", kind: "trap", typeFlags: typeTrap },
      { code: opponentMonsterResponderCode, name: "Allowed Opponent Monster Response", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: chainPlayerTrapResponderCode, name: "Allowed Chain Player Trap Response", kind: "trap", typeFlags: typeTrap },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 66523544, startingHandSize: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [materialCode, chainPlayerTrapResponderCode], extra: [sourceCode] },
      1: { main: [opponentSpellCode, opponentTrapResponderCode, opponentMonsterResponderCode] },
    });
    startDuel(session);

    const sourceCard = session.state.cards.find((card) => card.code === sourceCode && card.location === "extraDeck");
    const material = session.state.cards.find((card) => card.code === materialCode && card.location === "deck");
    const opponentSpell = session.state.cards.find((card) => card.code === opponentSpellCode && card.location === "deck");
    const opponentTrapResponder = session.state.cards.find((card) => card.code === opponentTrapResponderCode && card.location === "deck");
    const opponentMonsterResponder = session.state.cards.find((card) => card.code === opponentMonsterResponderCode && card.location === "deck");
    const chainPlayerTrapResponder = session.state.cards.find((card) => card.code === chainPlayerTrapResponderCode && card.location === "deck");
    expect(sourceCard).toBeDefined();
    expect(material).toBeDefined();
    expect(opponentSpell).toBeDefined();
    expect(opponentTrapResponder).toBeDefined();
    expect(opponentMonsterResponder).toBeDefined();
    expect(chainPlayerTrapResponder).toBeDefined();
    moveDuelCard(session.state, sourceCard!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, material!.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
    sourceCard!.overlayUids.push(material!.uid);
    moveDuelCard(session.state, opponentSpell!.uid, "spellTrapZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, opponentTrapResponder!.uid, "spellTrapZone", 1);
    opponentTrapResponder!.faceUp = false;
    opponentTrapResponder!.position = "faceDown";
    moveDuelCard(session.state, opponentMonsterResponder!.uid, "hand", 1);
    moveDuelCard(session.state, chainPlayerTrapResponder!.uid, "spellTrapZone", 0);
    chainPlayerTrapResponder!.faceUp = false;
    chainPlayerTrapResponder!.position = "faceDown";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${opponentTrapResponderCode}.lua`) return chainOnlyTrapScript("blocked opponent trap resolved");
        if (name === `c${opponentMonsterResponderCode}.lua`) return chainOnlyMonsterScript("allowed opponent monster resolved");
        if (name === `c${chainPlayerTrapResponderCode}.lua`) return chainOnlyTrapScript("allowed chain-player trap resolved");
        return workspace.readScript(name);
      },
    };

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sourceCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(opponentTrapResponderCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(opponentMonsterResponderCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(chainPlayerTrapResponderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);

    const sourceAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === sourceCard!.uid);
    expect(sourceAction, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    const activated = applyResponse(session, sourceAction!);
    expect(activated.ok, activated.error).toBe(true);

    const registryKey = `lua-chain-limit:${sourceCode}:0:link:known:closure:not-effect-type-response-player:16`;
    expect(serializeDuel(session).state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(hasActivateEffect(getLegalActions(session, 1), opponentTrapResponder!.uid)).toBe(false);
    expect(hasActivateEffect(getLegalActions(session, 1), opponentMonsterResponder!.uid)).toBe(true);
    expect(getLegalActions(session, 0)).toEqual([]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(hasActivateEffect(getLuaRestoreLegalActions(restored, 1), opponentTrapResponder!.uid)).toBe(false);
    expect(hasActivateEffect(getLuaRestoreLegalActions(restored, 1), opponentMonsterResponder!.uid)).toBe(true);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual([]);

    const restoredAction = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "activateEffect" && action.uid === opponentMonsterResponder!.uid);
    expect(restoredAction).toBeDefined();
    const chained = applyLuaRestoreResponse(restored, restoredAction!);
    expect(chained.ok, chained.error).toBe(true);
    expect(restored.session.state.chain).toEqual(expect.arrayContaining([expect.objectContaining({ sourceUid: opponentMonsterResponder!.uid })]));
    expect(restored.host.messages).not.toContain("blocked opponent trap resolved");
    expect(restored.host.messages).not.toContain("allowed chain-player trap resolved");
  });
});

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

function chainOnlyTrapScript(message: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("${message}") end)
      c:RegisterEffect(e)
    end
  `;
}

function hasActivateEffect(actions: ReturnType<typeof getLegalActions>, uid: string): boolean {
  return actions.some((action) => action.type === "activateEffect" && action.uid === uid);
}
