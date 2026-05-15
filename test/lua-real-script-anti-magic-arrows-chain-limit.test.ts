import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Anti-Magic Arrows chain-limit", () => {
  it("applies Anti-Magic Arrows' Project Ignis aux.FALSE activation response block", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const arrowsCode = "97120394";
    const responderCode = "860";
    const arrowsCards = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === arrowsCode);
    const cards: DuelCardData[] = [
      ...arrowsCards,
      { code: responderCode, name: "Blocked Arrows Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 450, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [arrowsCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const arrows = session.state.cards.find((card) => card.code === arrowsCode && card.location === "deck");
    const responder = session.state.cards.find((card) => card.code === responderCode && card.location === "deck");
    expect(arrows).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, arrows!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(arrowsCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const battle = getLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battle).toBeDefined();
    expect(applyResponse(session, battle!).ok).toBe(true);
    expect(queryPublicState(session)).toMatchObject({ phase: "battle", waitingFor: 0, windowKind: "open" });

    const restoredBattleStart = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredBattleStart.restoreComplete, restoredBattleStart.incompleteReasons.join("; ")).toBe(true);
    expect(restoredBattleStart.missingRegistryKeys).toEqual([]);
    expect(restoredBattleStart.missingChainLimitRegistryKeys).toEqual([]);
    expect(queryPublicState(restoredBattleStart.session)).toMatchObject({ phase: "battle", waitingFor: 0, windowKind: "open" });
    expect(getLuaRestoreLegalActionGroups(restoredBattleStart, 0)).toEqual(getGroupedDuelLegalActions(restoredBattleStart.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredBattleStart, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredBattleStart, 0));
    const arrowsAction = getLuaRestoreLegalActions(restoredBattleStart, 0).find((action) => action.type === "activateEffect" && action.uid === arrows!.uid);
    expect(arrowsAction, JSON.stringify(getLuaRestoreLegalActions(restoredBattleStart, 0), null, 2)).toBeDefined();
    const activated = applyResponse(restoredBattleStart.session, arrowsAction!);
    expect(activated.ok, activated.error).toBe(true);

    expect(queryPublicState(restoredBattleStart.session)).toMatchObject({ phase: "battle", waitingFor: 0, windowKind: "open", chain: [] });
    expect(restoredBattleStart.session.state.chainLimits).toEqual([]);
    expect(activated.legalActions.some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(false);
    expect(restoredBattleStart.host.messages).not.toContain("blocked arrows responder resolved");
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("blocked arrows responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
