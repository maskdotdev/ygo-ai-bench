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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script source GetReason all-bits condition", () => {
  it("restores source GetReason equality checks as all-bit reason requirements", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const panzerDragonCode = "72959823";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === panzerDragonCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7298, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { extra: [panzerDragonCode], main: [] }, 1: { main: [] } });
    startDuel(session);

    const panzer = session.state.cards.find((card) => card.code === panzerDragonCode);
    expect(panzer).toBeDefined();
    moveDuelCard(session.state, panzer!.uid, "monsterZone", 0);
    panzer!.faceUp = true;
    panzer!.position = "faceUpAttack";
    panzer!.reason = duelReason.destroy | duelReason.effect;

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${panzerDragonCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_MZONE)
      e:SetCondition(function(e) return (e:GetHandler():GetReason()&(REASON_DESTROY|REASON_EFFECT))==(REASON_DESTROY|REASON_EFFECT) end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      local e2=e:Clone()
      e2:SetCondition(function(e) return e:GetHandler():GetReason()&(REASON_DESTROY+REASON_EFFECT)==REASON_DESTROY+REASON_EFFECT end)
      c:RegisterEffect(e2)
      `,
      "panzer-dragon-official-source-get-reason-all-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects.filter((effect) => effect.code === 71)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ luaConditionDescriptor: "condition:source-reason-all:65" }),
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
    for (const restoredEffect of restoredEffects) {
      expect(restoredEffect).toMatchObject({
        luaConditionDescriptor: "condition:source-reason-all:65",
        luaValueDescriptor: "cannot-be-effect-target:opponent",
        range: ["monsterZone"],
      });
      expect(restoredEffect.canActivate).toBeDefined();
      const ctx = targetContext(restored.session.state, restoredPanzer!);
      expect(restoredEffect.canActivate!(ctx)).toBe(true);
      restoredPanzer!.reason = duelReason.destroy;
      expect(restoredEffect.canActivate!(ctx)).toBe(false);
      expect(restoredEffect.canActivate!({ ...ctx, eventReason: duelReason.destroy | duelReason.effect })).toBe(true);
      restoredPanzer!.reason = duelReason.effect;
      expect(restoredEffect.canActivate!(ctx)).toBe(false);
      delete restoredPanzer!.reason;
      expect(restoredEffect.canActivate!(ctx)).toBe(false);
      restoredPanzer!.reason = duelReason.destroy | duelReason.effect | duelReason.battle;
      expect(restoredEffect.canActivate!(ctx)).toBe(true);
    }
  });

  it("restores local source GetReason equality checks as all-bit reason requirements", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const panzerDragonCode = "72959823";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === panzerDragonCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7299, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { extra: [panzerDragonCode], main: [] }, 1: { main: [] } });
    startDuel(session);

    const panzer = session.state.cards.find((card) => card.code === panzerDragonCode);
    expect(panzer).toBeDefined();
    moveDuelCard(session.state, panzer!.uid, "monsterZone", 0);
    panzer!.faceUp = true;
    panzer!.position = "faceUpAttack";
    panzer!.reason = duelReason.destroy | duelReason.effect;

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${panzerDragonCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_MZONE)
      e:SetCondition(function(e)
        local c=e:GetHandler()
        return (c:GetReason()&(REASON_DESTROY|REASON_EFFECT))==(REASON_DESTROY|REASON_EFFECT)
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      local e2=e:Clone()
      e2:SetCondition(function(e)
        local c=e:GetHandler()
        return c:GetReason()&(REASON_DESTROY+REASON_EFFECT)==REASON_DESTROY+REASON_EFFECT
      end)
      c:RegisterEffect(e2)
      `,
      "panzer-dragon-official-local-source-get-reason-all-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects.filter((effect) => effect.code === 71)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ luaConditionDescriptor: "condition:source-reason-all:65" }),
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
    for (const restoredEffect of restoredEffects) {
      expect(restoredEffect).toMatchObject({
        luaConditionDescriptor: "condition:source-reason-all:65",
        luaValueDescriptor: "cannot-be-effect-target:opponent",
        range: ["monsterZone"],
      });
      expect(restoredEffect.canActivate).toBeDefined();
      const ctx = targetContext(restored.session.state, restoredPanzer!);
      expect(restoredEffect.canActivate!(ctx)).toBe(true);
      restoredPanzer!.reason = duelReason.destroy;
      expect(restoredEffect.canActivate!(ctx)).toBe(false);
      restoredPanzer!.reason = duelReason.effect;
      expect(restoredEffect.canActivate!(ctx)).toBe(false);
      delete restoredPanzer!.reason;
      expect(restoredEffect.canActivate!(ctx)).toBe(false);
      restoredPanzer!.reason = duelReason.destroy | duelReason.effect | duelReason.battle;
      expect(restoredEffect.canActivate!(ctx)).toBe(true);
    }
  });
});
