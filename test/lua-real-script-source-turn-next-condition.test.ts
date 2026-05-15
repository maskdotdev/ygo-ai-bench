import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
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
    player: 0,
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script source next turn condition", () => {
  it("restores comma-local source GetTurnID plus one checks from serialized card turn id", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const panzerDragonCode = "72959823";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === panzerDragonCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7315, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { extra: [panzerDragonCode], main: [] }, 1: { main: [] } });
    startDuel(session);

    const panzer = session.state.cards.find((card) => card.code === panzerDragonCode);
    expect(panzer).toBeDefined();
    moveDuelCard(session.state, panzer!.uid, "graveyard", 0);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${panzerDragonCode}),0,LOCATION_GRAVE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_GRAVE)
      e:SetCondition(function(e)
        local c,tp=e:GetHandler(),e:GetHandlerPlayer()
        return Duel.GetTurnCount()==c:GetTurnID()+1
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "panzer-dragon-official-comma-local-source-turn-next-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(
      session.state.effects.filter(
        (effect) => effect.code === 71 && effect.luaConditionDescriptor === "condition:source-turn-next",
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "battleDamageValue": [Function],
          "canActivate": [Function],
          "code": 71,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-1-71",
          "lifePointValue": [Function],
          "luaConditionDescriptor": "condition:source-turn-next",
          "luaTypeFlags": 1,
          "luaValueDescriptor": "cannot-be-effect-target:opponent",
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "property": 131072,
          "range": [
            "graveyard",
          ],
          "registryKey": "lua:72959823:lua-1-71",
          "sourceUid": "p0-extraDeck-72959823-0",
          "statValue": [Function],
          "target": [Function],
          "valueCardPredicate": [Function],
          "valuePredicate": [Function],
        },
      ]
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const restoredPanzer = restored.session.state.cards.find((card) => card.code === panzerDragonCode);
    const restoredEffect = restored.session.state.effects.find((effect) => effect.sourceUid === panzer!.uid && effect.code === 71);
    expect(restoredPanzer).toMatchObject({ turnId: restored.session.state.turn });
    expect(restoredEffect).toMatchObject({
      luaConditionDescriptor: "condition:source-turn-next",
      luaValueDescriptor: "cannot-be-effect-target:opponent",
      range: ["graveyard"],
    });
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredPanzer!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    restoredPanzer!.turnId = restored.session.state.turn - 1;
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredPanzer!.turnId = restored.session.state.turn - 2;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    restoredPanzer!.turnId = restored.session.state.turn + 1;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });

  it("restores source GetTurnID plus one checks from serialized card turn id", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const psychicProcessorCode = "70843274";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === psychicProcessorCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7309, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [psychicProcessorCode] }, 1: { main: [] } });
    startDuel(session);

    const processor = session.state.cards.find((card) => card.code === psychicProcessorCode);
    expect(processor).toBeDefined();
    moveDuelCard(session.state, processor!.uid, "banished", 0);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(psychicProcessorCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(
      session.state.effects.filter(
        (effect) =>
          effect.event === "trigger" &&
          effect.luaConditionDescriptor === "condition:source-turn-next" &&
          effect.triggerEvent === "phaseStandby",
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "category": 8,
          "code": 4098,
          "controller": 0,
          "cost": [Function],
          "countLimit": 1,
          "countLimitCode": 290174050320,
          "description": 1133492385,
          "event": "trigger",
          "id": "lua-2-4098",
          "luaConditionDescriptor": "condition:source-turn-next",
          "luaTypeFlags": 130,
          "oncePerTurn": true,
          "operation": [Function],
          "optional": true,
          "promptOperation": [Function],
          "range": [
            "banished",
          ],
          "registryKey": "lua:70843274:lua-2-4098",
          "sourceUid": "p0-deck-70843274-0",
          "target": [Function],
          "targetCardPredicate": [Function],
          "triggerCode": 4098,
          "triggerEvent": "phaseStandby",
          "triggerTiming": "when",
        },
      ]
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const restoredProcessor = restored.session.state.cards.find((card) => card.code === psychicProcessorCode);
    const restoredEffect = restored.session.state.effects.find((effect) => effect.sourceUid === processor!.uid && effect.triggerEvent === "phaseStandby");
    expect(restoredProcessor).toMatchObject({ turnId: restored.session.state.turn });
    expect(restoredEffect).toMatchObject({
      luaConditionDescriptor: "condition:source-turn-next",
      range: ["banished"],
    });
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredProcessor!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    restoredProcessor!.turnId = restored.session.state.turn - 1;
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredProcessor!.turnId = restored.session.state.turn - 2;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    restoredProcessor!.turnId = restored.session.state.turn + 1;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });

  it("restores local source GetTurnID plus one checks from serialized card turn id", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const panzerDragonCode = "72959823";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === panzerDragonCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7312, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { extra: [panzerDragonCode], main: [] }, 1: { main: [] } });
    startDuel(session);

    const panzer = session.state.cards.find((card) => card.code === panzerDragonCode);
    expect(panzer).toBeDefined();
    moveDuelCard(session.state, panzer!.uid, "graveyard", 0);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${panzerDragonCode}),0,LOCATION_GRAVE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_GRAVE)
      e:SetCondition(function(e)
        local c=e:GetHandler()
        return Duel.GetTurnCount()==c:GetTurnID()+1
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "panzer-dragon-official-local-source-turn-next-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(
      session.state.effects.filter(
        (effect) => effect.code === 71 && effect.luaConditionDescriptor === "condition:source-turn-next",
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "battleDamageValue": [Function],
          "canActivate": [Function],
          "code": 71,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-1-71",
          "lifePointValue": [Function],
          "luaConditionDescriptor": "condition:source-turn-next",
          "luaTypeFlags": 1,
          "luaValueDescriptor": "cannot-be-effect-target:opponent",
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "property": 131072,
          "range": [
            "graveyard",
          ],
          "registryKey": "lua:72959823:lua-1-71",
          "sourceUid": "p0-extraDeck-72959823-0",
          "statValue": [Function],
          "target": [Function],
          "valueCardPredicate": [Function],
          "valuePredicate": [Function],
        },
      ]
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const restoredPanzer = restored.session.state.cards.find((card) => card.code === panzerDragonCode);
    const restoredEffect = restored.session.state.effects.find((effect) => effect.sourceUid === panzer!.uid && effect.code === 71);
    expect(restoredPanzer).toMatchObject({ turnId: restored.session.state.turn });
    expect(restoredEffect).toMatchObject({
      luaConditionDescriptor: "condition:source-turn-next",
      luaValueDescriptor: "cannot-be-effect-target:opponent",
      range: ["graveyard"],
    });
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredPanzer!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    restoredPanzer!.turnId = restored.session.state.turn - 1;
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredPanzer!.turnId = restored.session.state.turn - 2;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    restoredPanzer!.turnId = restored.session.state.turn + 1;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });
});
