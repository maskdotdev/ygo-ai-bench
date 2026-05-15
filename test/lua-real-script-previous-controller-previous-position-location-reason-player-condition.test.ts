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
const positionFaceDown = 0x0a;
const locationOnField = 0x0c;

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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script previous controller previous position location reason-player condition", () => {
  it("restores opponent-effect previous-position previous-location checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const tongueCode = "85640370";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === tongueCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8564, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [tongueCode] }, 1: { main: [] } });
    startDuel(session);

    const tongue = session.state.cards.find((card) => card.code === tongueCode);
    expect(tongue).toBeDefined();
    moveDuelCard(session.state, tongue!.uid, "spellTrapZone", 0).position = "faceDown";
    moveDuelCard(session.state, tongue!.uid, "graveyard", 0, duelReason.effect, 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(tongueCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const descriptor = `condition:source-previous-controller-previous-position-location-reason-player-reason:${positionFaceDown}:${locationOnField}:${duelReason.effect}:opponent`;
    expect(session.state.effects.find((effect) => effect.luaConditionDescriptor === descriptor && effect.sourceUid === tongue!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "category": 2097152,
        "code": 1029,
        "controller": 0,
        "cost": [Function],
        "description": 1370245921,
        "event": "trigger",
        "id": "lua-2-1029",
        "luaConditionDescriptor": "condition:source-previous-controller-previous-position-location-reason-player-reason:10:12:64:opponent",
        "luaTypeFlags": 129,
        "oncePerTurn": false,
        "operation": [Function],
        "optional": true,
        "promptOperation": [Function],
        "property": 65552,
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
        "registryKey": "lua:85640370:lua-2-1029",
        "sourceUid": "p0-deck-85640370-0",
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
    const restoredTongue = restored.session.state.cards.find((card) => card.code === tongueCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === tongue!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredTongue!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredTongue!.reason = duelReason.battle;
    expect(effect!.canActivate!(ctx)).toBe(false);
    expect(effect!.canActivate!({ ...ctx, eventReason: duelReason.effect })).toBe(true);
    restoredTongue!.reason = duelReason.effect;
    restoredTongue!.reasonPlayer = 0;
    expect(effect!.canActivate!(ctx)).toBe(false);
    expect(effect!.canActivate!({ ...ctx, eventReasonPlayer: 1 })).toBe(true);
    restoredTongue!.reasonPlayer = 1;
    restoredTongue!.previousPosition = "faceUpAttack";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredTongue!.previousPosition = "faceDown";
    restoredTongue!.previousLocation = "hand";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredTongue!.previousLocation = "spellTrapZone";
    restoredTongue!.previousController = 1;
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});
