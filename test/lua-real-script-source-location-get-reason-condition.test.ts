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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script source location and GetReason condition", () => {
  it("restores comma-local source IsLocation and GetReason bitmask checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const panzerDragonCode = "72959823";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === panzerDragonCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7304, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
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
        return c:IsLocation(LOCATION_GRAVE) and (c:GetReason()&REASON_BATTLE)~=0
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      local e2=e:Clone()
      e2:SetCondition(function(e)
        local c,tp=e:GetHandler(),e:GetHandlerPlayer()
        return c:IsLocation(LOCATION_GRAVE) and c:GetReason()&REASON_BATTLE>0
      end)
      c:RegisterEffect(e2)
      `,
      "panzer-dragon-comma-local-source-location-get-reason-condition.lua",
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
    const restoredPanzer = restored.session.state.cards.find((card) => card.code === panzerDragonCode);
    const restoredEffects = restored.session.state.effects.filter((effect) => effect.sourceUid === panzer!.uid && effect.code === 71);
    expect(restoredPanzer).toBeDefined();
    expect(restoredPanzer).toMatchObject({ location: "graveyard", reason: duelReason.battle });
    expect(restoredEffects).toHaveLength(2);
    const ctx = targetContext(restored.session.state, restoredPanzer!);
    for (const effect of restoredEffects) {
      expect(effect.luaConditionDescriptor).toBe("condition:source-location-reason:16:32");
      expect(effect.canActivate!(ctx)).toBe(true);
      restoredPanzer!.reason = duelReason.effect;
      expect(effect.canActivate!(ctx)).toBe(false);
      restoredPanzer!.reason = duelReason.battle;
      moveDuelCard(restored.session.state, restoredPanzer!.uid, "hand", 0);
      expect(effect.canActivate!(ctx)).toBe(false);
      moveDuelCard(restored.session.state, restoredPanzer!.uid, "graveyard", 0);
      restoredPanzer!.reason = duelReason.battle;
    }
  });

  it("restores compound source IsLocation and GetReason bitmask checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const panzerDragonCode = "72959823";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === panzerDragonCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7303, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
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
      e:SetCondition(function(e) return e:GetHandler():IsLocation(LOCATION_GRAVE) and (e:GetHandler():GetReason()&REASON_BATTLE)~=0 end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      local e2=e:Clone()
      e2:SetCondition(function(e) return e:GetHandler():IsLocation(LOCATION_GRAVE) and e:GetHandler():GetReason()&REASON_BATTLE>0 end)
      c:RegisterEffect(e2)
      `,
      "panzer-dragon-official-source-location-get-reason-condition.lua",
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
    const restoredPanzer = restored.session.state.cards.find((card) => card.code === panzerDragonCode);
    const restoredEffects = restored.session.state.effects.filter((effect) => effect.sourceUid === panzer!.uid && effect.code === 71);
    expect(restoredPanzer).toBeDefined();
    expect(restoredPanzer).toMatchObject({ location: "graveyard", reason: duelReason.battle });
    expect(restoredEffects).toHaveLength(2);
    const ctx = targetContext(restored.session.state, restoredPanzer!);
    for (const effect of restoredEffects) {
      expect(effect.luaConditionDescriptor).toBe("condition:source-location-reason:16:32");
      expect(effect.canActivate!(ctx)).toBe(true);
      restoredPanzer!.reason = duelReason.effect;
      expect(effect.canActivate!(ctx)).toBe(false);
      restoredPanzer!.reason = duelReason.battle;
      moveDuelCard(restored.session.state, restoredPanzer!.uid, "hand", 0);
      expect(effect.canActivate!(ctx)).toBe(false);
      moveDuelCard(restored.session.state, restoredPanzer!.uid, "graveyard", 0);
      restoredPanzer!.reason = duelReason.battle;
    }
  });
});
