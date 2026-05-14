import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelCardInstance, DuelEffectContext } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { restoreDuelWithLuaScripts } from "#lua/snapshot.js";

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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script source previous position and reason condition", () => {
  it("restores comma-local source IsReason and IsPreviousPosition checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const giantKozakyCode = "58185394";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === giantKozakyCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 5820, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [giantKozakyCode] }, 1: { main: [] } });
    startDuel(session);

    const giantKozaky = session.state.cards.find((card) => card.code === giantKozakyCode);
    expect(giantKozaky).toBeDefined();
    moveDuelCard(session.state, giantKozaky!.uid, "monsterZone", 0);
    giantKozaky!.position = "faceUpAttack";
    moveDuelCard(session.state, giantKozaky!.uid, "graveyard", 0, duelReason.destroy);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${giantKozakyCode}),0,LOCATION_GRAVE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_GRAVE)
      e:SetCondition(function(e)
        local c,tp=e:GetHandler(),e:GetHandlerPlayer()
        return c:IsReason(REASON_DESTROY) and c:IsPreviousPosition(POS_FACEUP)
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "giant-kozaky-comma-local-source-previous-position-reason-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const descriptor = `condition:source-previous-position-reason:5:${duelReason.destroy}`;
    expect(session.state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ code: 71, luaConditionDescriptor: descriptor, sourceUid: giantKozaky!.uid })]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredGiantKozaky = restored.session.state.cards.find((card) => card.code === giantKozakyCode);
    const restoredEffect = restored.session.state.effects.find((effect) => effect.sourceUid === giantKozaky!.uid && effect.luaConditionDescriptor === descriptor);
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredGiantKozaky!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredGiantKozaky!.reason = duelReason.battle;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    expect(restoredEffect!.canActivate!({ ...ctx, eventReason: duelReason.destroy })).toBe(true);
    restoredGiantKozaky!.reason = duelReason.destroy;
    restoredGiantKozaky!.previousPosition = "faceDownDefense";
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });

  it("restores compound source IsReason and IsPreviousPosition checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const panzerDragonCode = "72959823";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === panzerDragonCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7306, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { extra: [panzerDragonCode], main: [] }, 1: { main: [] } });
    startDuel(session);

    const panzer = session.state.cards.find((card) => card.code === panzerDragonCode);
    expect(panzer).toBeDefined();
    moveDuelCard(session.state, panzer!.uid, "monsterZone", 0);
    panzer!.position = "faceUpAttack";
    moveDuelCard(session.state, panzer!.uid, "graveyard", 0, duelReason.battle);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${panzerDragonCode}),0,LOCATION_GRAVE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_GRAVE)
      e:SetCondition(function(e) return e:GetHandler():IsReason(REASON_BATTLE) and e:GetHandler():IsPreviousPosition(POS_FACEUP) end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "panzer-dragon-official-source-previous-position-reason-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 71,
          luaConditionDescriptor: "condition:source-previous-position-reason:5:32",
          luaValueDescriptor: "cannot-be-effect-target:opponent",
          range: ["graveyard"],
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredPanzer = restored.session.state.cards.find((card) => card.code === panzerDragonCode);
    const restoredEffect = restored.session.state.effects.find((effect) => effect.sourceUid === panzer!.uid && effect.code === 71);
    expect(restoredPanzer).toMatchObject({ previousPosition: "faceUpAttack", reason: duelReason.battle });
    expect(restoredEffect).toMatchObject({
      luaConditionDescriptor: "condition:source-previous-position-reason:5:32",
      luaValueDescriptor: "cannot-be-effect-target:opponent",
      range: ["graveyard"],
    });
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredPanzer!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredPanzer!.reason = duelReason.effect;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    restoredPanzer!.reason = duelReason.battle;
    restoredPanzer!.previousPosition = "faceDownDefense";
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    delete restoredPanzer!.previousPosition;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });

  it("restores direct source IsPreviousPosition and IsReason checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const panzerDragonCode = "72959823";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === panzerDragonCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 73061, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { extra: [panzerDragonCode], main: [] }, 1: { main: [] } });
    startDuel(session);

    const panzer = session.state.cards.find((card) => card.code === panzerDragonCode);
    expect(panzer).toBeDefined();
    moveDuelCard(session.state, panzer!.uid, "monsterZone", 0);
    panzer!.position = "faceUpAttack";
    moveDuelCard(session.state, panzer!.uid, "graveyard", 0, duelReason.battle);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${panzerDragonCode}),0,LOCATION_GRAVE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_GRAVE)
      e:SetCondition(function(e) return e:GetHandler():IsPreviousPosition(POS_FACEUP) and e:GetHandler():IsReason(REASON_BATTLE) end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "panzer-dragon-direct-source-previous-position-reason-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 71,
          luaConditionDescriptor: "condition:source-previous-position-reason:5:32",
          luaValueDescriptor: "cannot-be-effect-target:opponent",
          range: ["graveyard"],
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredPanzer = restored.session.state.cards.find((card) => card.code === panzerDragonCode);
    const restoredEffect = restored.session.state.effects.find((effect) => effect.sourceUid === panzer!.uid && effect.code === 71);
    expect(restoredPanzer).toMatchObject({ previousPosition: "faceUpAttack", reason: duelReason.battle });
    expect(restoredEffect).toMatchObject({
      luaConditionDescriptor: "condition:source-previous-position-reason:5:32",
      luaValueDescriptor: "cannot-be-effect-target:opponent",
      range: ["graveyard"],
    });
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredPanzer!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredPanzer!.reason = duelReason.effect;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    restoredPanzer!.reason = duelReason.battle;
    restoredPanzer!.previousPosition = "faceDownDefense";
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    delete restoredPanzer!.previousPosition;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });

  it("restores local handler source IsReason and IsPreviousPosition checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const giantKozakyCode = "58185394";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === giantKozakyCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 5818, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [giantKozakyCode] }, 1: { main: [] } });
    startDuel(session);

    const giantKozaky = session.state.cards.find((card) => card.code === giantKozakyCode);
    expect(giantKozaky).toBeDefined();
    moveDuelCard(session.state, giantKozaky!.uid, "monsterZone", 0);
    giantKozaky!.position = "faceUpAttack";
    moveDuelCard(session.state, giantKozaky!.uid, "graveyard", 0, duelReason.destroy);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${giantKozakyCode}),0,LOCATION_GRAVE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_GRAVE)
      e:SetCondition(function(e)
        local c=e:GetHandler()
        return c:IsReason(REASON_DESTROY) and c:IsPreviousPosition(POS_FACEUP)
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "giant-kozaky-official-local-source-previous-position-reason-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const descriptor = `condition:source-previous-position-reason:5:${duelReason.destroy}`;
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 71,
          luaConditionDescriptor: descriptor,
          luaValueDescriptor: "cannot-be-effect-target:opponent",
          range: ["graveyard"],
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredGiantKozaky = restored.session.state.cards.find((card) => card.code === giantKozakyCode);
    const restoredEffect = restored.session.state.effects.find((effect) => effect.sourceUid === giantKozaky!.uid && effect.code === 71);
    expect(restoredEffect).toMatchObject({
      luaConditionDescriptor: descriptor,
      luaValueDescriptor: "cannot-be-effect-target:opponent",
      range: ["graveyard"],
    });
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredGiantKozaky!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredGiantKozaky!.reason = duelReason.battle;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    restoredGiantKozaky!.reason = duelReason.destroy;
    restoredGiantKozaky!.previousPosition = "faceDownDefense";
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });

  it("restores card-filter source IsPreviousPosition and IsReason checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const panzerDragonCode = "72959823";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === panzerDragonCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 9602, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { extra: [panzerDragonCode], main: [] }, 1: { main: [] } });
    startDuel(session);

    const panzer = session.state.cards.find((card) => card.code === panzerDragonCode);
    expect(panzer).toBeDefined();
    moveDuelCard(session.state, panzer!.uid, "monsterZone", 0);
    panzer!.position = "faceUpAttack";
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
        return c:IsPreviousPosition(POS_FACEUP) and c:IsReason(REASON_EFFECT)
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "panzer-dragon-card-filter-source-previous-position-reason-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const descriptor = `condition:source-previous-position-reason:5:${duelReason.effect}`;
    expect(session.state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ code: 71, luaConditionDescriptor: descriptor, sourceUid: panzer!.uid })]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredPanzer = restored.session.state.cards.find((card) => card.code === panzerDragonCode);
    const restoredEffect = restored.session.state.effects.find((effect) => effect.sourceUid === panzer!.uid && effect.luaConditionDescriptor === descriptor);
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredPanzer!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredPanzer!.reason = duelReason.battle;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    restoredPanzer!.reason = duelReason.effect;
    restoredPanzer!.previousPosition = "faceDownDefense";
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });
});
