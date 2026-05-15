import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelCardInstance, DuelEffectContext } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

function targetContext(duel: DuelEffectContext["duel"], source: DuelCardInstance): DuelEffectContext {
  return {
    duel,
    source,
    player: source.controller,
    targetUids: [],
    log: () => {},
    moveCard: () => source,
    negateChainLink: () => false,
    setTargets: () => {},
    getTargets: () => [],
    setTargetPlayer: () => {},
    setTargetParam: () => {},
  };
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script previous controller reason player condition", () => {
  it("restores opponent-caused previous-controller checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const windaCode = "65193366";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === windaCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 6519, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [windaCode] }, 1: { main: [] } });
    startDuel(session);

    const winda = session.state.cards.find((card) => card.code === windaCode);
    expect(winda).toBeDefined();
    moveDuelCard(session.state, winda!.uid, "monsterZone", 0);
    moveDuelCard(session.state, winda!.uid, "graveyard", 0, duelReason.destroy | duelReason.effect, 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(windaCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.luaConditionDescriptor === "condition:source-previous-controller-reason-player:opponent" && effect.sourceUid === winda!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "category": 512,
        "code": 1029,
        "controller": 0,
        "cost": [Function],
        "description": 1043093856,
        "event": "trigger",
        "id": "lua-1-1029",
        "luaConditionDescriptor": "condition:source-previous-controller-reason-player:opponent",
        "luaTypeFlags": 129,
        "oncePerTurn": false,
        "operation": [Function],
        "optional": true,
        "promptOperation": [Function],
        "property": 65536,
        "range": [
          "deck",
          "hand",
          "monsterZone",
          "spellTrapZone",
          "graveyard",
          "banished",
          "extraDeck",
          "overlay",
        ],
        "registryKey": "lua:65193366:lua-1-1029",
        "sourceUid": "p0-deck-65193366-0",
        "target": [Function],
        "targetCardPredicate": [Function],
        "triggerCode": 1029,
        "triggerEvent": "destroyed",
        "triggerSourceOnly": true,
        "triggerTiming": "if",
      }
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const restoredWinda = restored.session.state.cards.find((card) => card.code === windaCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === winda!.uid && candidate.luaConditionDescriptor === "condition:source-previous-controller-reason-player:opponent");
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredWinda!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredWinda!.reasonPlayer = 0;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredWinda!.reasonPlayer = 1;
    restoredWinda!.previousController = 1;
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});
