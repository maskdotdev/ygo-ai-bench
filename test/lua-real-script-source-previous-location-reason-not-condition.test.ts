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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script source previous location and negated reason condition", () => {
  it("restores comma-local source previous-location and not IsReason checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const panzerDragonCode = "72959823";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === panzerDragonCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 73052, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { extra: [panzerDragonCode], main: [] }, 1: { main: [] } });
    startDuel(session);

    const panzer = session.state.cards.find((card) => card.code === panzerDragonCode);
    expect(panzer).toBeDefined();
    moveDuelCard(session.state, panzer!.uid, "monsterZone", 0);
    moveDuelCard(session.state, panzer!.uid, "graveyard", 0, duelReason.effect);

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
        return c:IsPreviousLocation(LOCATION_ONFIELD) and not c:IsReason(REASON_BATTLE)
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "panzer-dragon-comma-local-source-previous-location-reason-not-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(
      session.state.effects.filter(
        (effect) =>
          effect.code === 71 && effect.luaConditionDescriptor === "condition:source-previous-location-reason-not:12:32",
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
          "luaConditionDescriptor": "condition:source-previous-location-reason-not:12:32",
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
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const restoredPanzer = restored.session.state.cards.find((card) => card.code === panzerDragonCode);
    const restoredEffect = restored.session.state.effects.find((effect) => effect.sourceUid === panzer!.uid && effect.code === 71);
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredPanzer!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredPanzer!.reason = duelReason.effect | duelReason.battle;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    expect(restoredEffect!.canActivate!({ ...ctx, eventReason: duelReason.effect })).toBe(true);
    restoredPanzer!.reason = duelReason.effect;
    restoredPanzer!.previousLocation = "hand";
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });

  it("restores compound source not IsReason and IsPreviousLocation checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const panzerDragonCode = "72959823";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === panzerDragonCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7305, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { extra: [panzerDragonCode], main: [] }, 1: { main: [] } });
    startDuel(session);

    const panzer = session.state.cards.find((card) => card.code === panzerDragonCode);
    expect(panzer).toBeDefined();
    moveDuelCard(session.state, panzer!.uid, "monsterZone", 0);
    moveDuelCard(session.state, panzer!.uid, "graveyard", 0, duelReason.effect);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${panzerDragonCode}),0,LOCATION_GRAVE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_GRAVE)
      e:SetCondition(function(e) return not e:GetHandler():IsReason(REASON_BATTLE) and e:GetHandler():IsPreviousLocation(LOCATION_ONFIELD) end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "panzer-dragon-official-source-previous-location-reason-not-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(
      session.state.effects.filter(
        (effect) =>
          effect.code === 71 && effect.luaConditionDescriptor === "condition:source-previous-location-reason-not:12:32",
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
          "luaConditionDescriptor": "condition:source-previous-location-reason-not:12:32",
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
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const restoredPanzer = restored.session.state.cards.find((card) => card.code === panzerDragonCode);
    const restoredEffect = restored.session.state.effects.find((effect) => effect.sourceUid === panzer!.uid && effect.code === 71);
    expect(restoredPanzer).toMatchObject({ previousLocation: "monsterZone", reason: duelReason.effect });
    expect(restoredEffect).toMatchObject({
      luaConditionDescriptor: "condition:source-previous-location-reason-not:12:32",
      luaValueDescriptor: "cannot-be-effect-target:opponent",
      range: ["graveyard"],
    });
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredPanzer!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredPanzer!.reason = duelReason.effect | duelReason.battle;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    restoredPanzer!.reason = duelReason.effect;
    restoredPanzer!.previousLocation = "hand";
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    delete restoredPanzer!.reason;
    restoredPanzer!.previousLocation = "monsterZone";
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
  });

  it("restores local handler source previous-location and not IsReason checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const panzerDragonCode = "72959823";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === panzerDragonCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 73051, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { extra: [panzerDragonCode], main: [] }, 1: { main: [] } });
    startDuel(session);

    const panzer = session.state.cards.find((card) => card.code === panzerDragonCode);
    expect(panzer).toBeDefined();
    moveDuelCard(session.state, panzer!.uid, "monsterZone", 0);
    moveDuelCard(session.state, panzer!.uid, "graveyard", 0, duelReason.effect);

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
        return c:IsPreviousLocation(LOCATION_ONFIELD) and not c:IsReason(REASON_BATTLE)
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "panzer-dragon-local-source-previous-location-reason-not-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(
      session.state.effects.filter(
        (effect) =>
          effect.code === 71 && effect.luaConditionDescriptor === "condition:source-previous-location-reason-not:12:32",
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
          "luaConditionDescriptor": "condition:source-previous-location-reason-not:12:32",
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
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const restoredPanzer = restored.session.state.cards.find((card) => card.code === panzerDragonCode);
    const restoredEffect = restored.session.state.effects.find((effect) => effect.sourceUid === panzer!.uid && effect.code === 71);
    expect(restoredPanzer).toMatchObject({ previousLocation: "monsterZone", reason: duelReason.effect });
    expect(restoredEffect).toMatchObject({
      luaConditionDescriptor: "condition:source-previous-location-reason-not:12:32",
      luaValueDescriptor: "cannot-be-effect-target:opponent",
      range: ["graveyard"],
    });
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredPanzer!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredPanzer!.reason = duelReason.effect | duelReason.battle;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    restoredPanzer!.reason = duelReason.effect;
    restoredPanzer!.previousLocation = "hand";
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    delete restoredPanzer!.reason;
    restoredPanzer!.previousLocation = "monsterZone";
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
  });
});
