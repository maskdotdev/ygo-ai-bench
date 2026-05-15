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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script source location and reason condition", () => {
  it("restores comma-local source IsLocation and IsReason checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const panzerDragonCode = "72959823";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === panzerDragonCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 73013, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { extra: [panzerDragonCode], main: [] }, 1: { main: [] } });
    startDuel(session);

    const panzer = session.state.cards.find((card) => card.code === panzerDragonCode);
    expect(panzer).toBeDefined();
    moveDuelCard(session.state, panzer!.uid, "graveyard", 0);
    panzer!.reason = duelReason.battle;

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
        return c:IsLocation(LOCATION_GRAVE) and c:IsReason(REASON_BATTLE)
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      local e2=e:Clone()
      e2:SetCondition(function(e)
        local c,tp=e:GetHandler(),e:GetHandlerPlayer()
        return c:IsReason(REASON_BATTLE) and c:IsLocation(LOCATION_GRAVE)
      end)
      c:RegisterEffect(e2)
      `,
      "panzer-dragon-comma-local-source-location-reason-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects.filter((effect) => effect.code === 71)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: "condition:source-location-reason:16:32",
          luaValueDescriptor: "cannot-be-effect-target:opponent",
          range: ["graveyard"],
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const restoredPanzer = restored.session.state.cards.find((card) => card.code === panzerDragonCode);
    const restoredEffects = restored.session.state.effects.filter((effect) => effect.sourceUid === panzer!.uid && effect.code === 71);
    expect(restoredPanzer).toBeDefined();
    expect(restoredEffects).toHaveLength(2);
    const ctx = targetContext(restored.session.state, restoredPanzer!);
    for (const effect of restoredEffects) {
      expect(effect.luaConditionDescriptor).toBe("condition:source-location-reason:16:32");
      expect(effect.canActivate!(ctx)).toBe(true);
      restoredPanzer!.reason = duelReason.effect;
      expect(effect.canActivate!(ctx)).toBe(false);
      expect(effect.canActivate!({ ...ctx, eventReason: duelReason.battle })).toBe(true);
      restoredPanzer!.reason = duelReason.battle;
      moveDuelCard(restored.session.state, restoredPanzer!.uid, "hand", 0);
      expect(effect.canActivate!(ctx)).toBe(false);
      moveDuelCard(restored.session.state, restoredPanzer!.uid, "graveyard", 0);
      restoredPanzer!.reason = duelReason.battle;
    }
  });

  it("restores compound source IsLocation and IsReason checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const panzerDragonCode = "72959823";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === panzerDragonCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7301, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { extra: [panzerDragonCode], main: [] }, 1: { main: [] } });
    startDuel(session);

    const panzer = session.state.cards.find((card) => card.code === panzerDragonCode);
    expect(panzer).toBeDefined();
    moveDuelCard(session.state, panzer!.uid, "graveyard", 0);
    panzer!.reason = duelReason.battle;

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${panzerDragonCode}),0,LOCATION_GRAVE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_GRAVE)
      e:SetCondition(function(e) return e:GetHandler():IsLocation(LOCATION_GRAVE) and e:GetHandler():IsReason(REASON_BATTLE) end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "panzer-dragon-official-source-location-reason-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 71,
          luaConditionDescriptor: "condition:source-location-reason:16:32",
          luaValueDescriptor: "cannot-be-effect-target:opponent",
          range: ["graveyard"],
        }),
      ]),
    );

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
    expect(restoredPanzer).toBeDefined();
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredPanzer!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredPanzer!.reason = duelReason.effect;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    restoredPanzer!.reason = duelReason.battle;
    moveDuelCard(restored.session.state, restoredPanzer!.uid, "hand", 0);
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    moveDuelCard(restored.session.state, restoredPanzer!.uid, "graveyard", 0);
    delete restoredPanzer!.reason;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });

  it("restores compound source IsReason and IsLocation checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const panzerDragonCode = "72959823";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === panzerDragonCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 73011, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { extra: [panzerDragonCode], main: [] }, 1: { main: [] } });
    startDuel(session);

    const panzer = session.state.cards.find((card) => card.code === panzerDragonCode);
    expect(panzer).toBeDefined();
    moveDuelCard(session.state, panzer!.uid, "graveyard", 0);
    panzer!.reason = duelReason.battle;

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${panzerDragonCode}),0,LOCATION_GRAVE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_GRAVE)
      e:SetCondition(function(e) return e:GetHandler():IsReason(REASON_BATTLE) and e:GetHandler():IsLocation(LOCATION_GRAVE) end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "panzer-dragon-source-reason-location-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 71,
          luaConditionDescriptor: "condition:source-location-reason:16:32",
          luaValueDescriptor: "cannot-be-effect-target:opponent",
          range: ["graveyard"],
        }),
      ]),
    );

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
    expect(restoredPanzer).toBeDefined();
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredPanzer!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredPanzer!.reason = duelReason.effect;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    restoredPanzer!.reason = duelReason.battle;
    moveDuelCard(restored.session.state, restoredPanzer!.uid, "hand", 0);
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    moveDuelCard(restored.session.state, restoredPanzer!.uid, "graveyard", 0);
    delete restoredPanzer!.reason;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });

  it("restores local handler source IsLocation and IsReason checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const panzerDragonCode = "72959823";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === panzerDragonCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 73012, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { extra: [panzerDragonCode], main: [] }, 1: { main: [] } });
    startDuel(session);

    const panzer = session.state.cards.find((card) => card.code === panzerDragonCode);
    expect(panzer).toBeDefined();
    moveDuelCard(session.state, panzer!.uid, "graveyard", 0);
    panzer!.reason = duelReason.battle;

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
        return c:IsLocation(LOCATION_GRAVE) and c:IsReason(REASON_BATTLE)
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "panzer-dragon-local-source-location-reason-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 71,
          luaConditionDescriptor: "condition:source-location-reason:16:32",
          luaValueDescriptor: "cannot-be-effect-target:opponent",
          range: ["graveyard"],
        }),
      ]),
    );

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
    expect(restoredPanzer).toBeDefined();
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredPanzer!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredPanzer!.reason = duelReason.effect;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    restoredPanzer!.reason = duelReason.battle;
    moveDuelCard(restored.session.state, restoredPanzer!.uid, "hand", 0);
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    moveDuelCard(restored.session.state, restoredPanzer!.uid, "graveyard", 0);
    delete restoredPanzer!.reason;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });
});
