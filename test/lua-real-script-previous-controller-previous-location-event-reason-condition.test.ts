import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelCardInstance, DuelEffectContext, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const locationDeck = 0x01;
const locationOnField = 0x0c;

function conditionContext(duel: DuelEffectContext["duel"], source: DuelCardInstance): DuelEffectContext {
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script previous controller previous location event reason condition", () => {
  it("restores event-reason previous-controller previous-location checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const cupidVolleyCode = "11851647";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === cupidVolleyCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1185, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [cupidVolleyCode] }, 1: { main: [] } });
    startDuel(session);

    const cupidVolley = session.state.cards.find((card) => card.code === cupidVolleyCode);
    expect(cupidVolley).toBeDefined();
    moveDuelCard(session.state, cupidVolley!.uid, "monsterZone", 0);
    moveDuelCard(session.state, cupidVolley!.uid, "graveyard", 0, duelReason.destroy, 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(cupidVolleyCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const descriptor = `condition:source-previous-controller-previous-location-reason:${locationOnField}:${duelReason.destroy}`;
    expect(session.state.effects.find((effect) => effect.luaConditionDescriptor === descriptor && effect.sourceUid === cupidVolley!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "category": 1048576,
        "code": 1014,
        "controller": 0,
        "cost": [Function],
        "countLimit": 1,
        "countLimitCode": 48544346128,
        "description": 189626353,
        "event": "trigger",
        "id": "lua-2-1014",
        "luaConditionDescriptor": "condition:source-previous-controller-previous-location-reason:12:1",
        "luaTypeFlags": 513,
        "oncePerTurn": true,
        "operation": [Function],
        "optional": false,
        "promptOperation": [Function],
        "property": 2048,
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
        "registryKey": "lua:11851647:lua-2-1014",
        "sourceUid": "p0-deck-11851647-0",
        "target": [Function],
        "targetCardPredicate": [Function],
        "triggerCode": 1014,
        "triggerEvent": "sentToGraveyard",
        "triggerSourceOnly": true,
        "triggerTiming": "when",
      }
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 0);
    const restoredCupidVolley = restored.session.state.cards.find((card) => card.code === cupidVolleyCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === cupidVolley!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = conditionContext(restored.session.state, restoredCupidVolley!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredCupidVolley!.reason = duelReason.effect;
    expect(effect!.canActivate!(ctx)).toBe(false);
    expect(effect!.canActivate!({ ...ctx, eventReason: duelReason.destroy })).toBe(true);
    restoredCupidVolley!.reason = duelReason.destroy;
    restoredCupidVolley!.previousLocation = "hand";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredCupidVolley!.previousLocation = "monsterZone";
    restoredCupidVolley!.previousController = 1;
    expect(effect!.canActivate!(ctx)).toBe(false);
  });

  it("restores event-reason previous-controller GetPreviousLocation equality checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const zhugeKongCode = "32422602";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === zhugeKongCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 3242, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [zhugeKongCode] }, 1: { main: [] } });
    startDuel(session);

    const zhugeKong = session.state.cards.find((card) => card.code === zhugeKongCode);
    expect(zhugeKong).toBeDefined();
    moveDuelCard(session.state, zhugeKong!.uid, "hand", 0, duelReason.effect, 0);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(zhugeKongCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const descriptor = `condition:source-previous-controller-previous-location-reason:${locationDeck}:${duelReason.effect}`;
    expect(session.state.effects.find((effect) => effect.luaConditionDescriptor === descriptor && effect.sourceUid === zhugeKong!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "category": 512,
        "code": 1012,
        "controller": 0,
        "cost": [Function],
        "countLimit": 1,
        "countLimitCode": 32422602,
        "description": 518761632,
        "event": "trigger",
        "id": "lua-1-1012",
        "luaConditionDescriptor": "condition:source-previous-controller-previous-location-reason:1:64",
        "luaTypeFlags": 129,
        "oncePerTurn": true,
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
        "registryKey": "lua:32422602:lua-1-1012",
        "sourceUid": "p0-deck-32422602-0",
        "target": [Function],
        "targetCardPredicate": [Function],
        "triggerCode": 1012,
        "triggerEvent": "sentToHand",
        "triggerSourceOnly": true,
        "triggerTiming": "if",
      }
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 0);
    const restoredZhugeKong = restored.session.state.cards.find((card) => card.code === zhugeKongCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === zhugeKong!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = conditionContext(restored.session.state, restoredZhugeKong!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredZhugeKong!.reason = 0;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredZhugeKong!.reason = duelReason.effect;
    restoredZhugeKong!.previousLocation = "hand";
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(
    getLuaRestoreLegalActions(restored, player),
  );
}
