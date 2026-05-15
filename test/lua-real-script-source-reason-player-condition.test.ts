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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script source reason player condition", () => {
  it("restores source GetReasonPlayer and IsReasonPlayer checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const panzerDragonCode = "72959823";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === panzerDragonCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7297, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { extra: [panzerDragonCode], main: [] }, 1: { main: [] } });
    startDuel(session);

    const panzer = session.state.cards.find((card) => card.code === panzerDragonCode);
    expect(panzer).toBeDefined();
    moveDuelCard(session.state, panzer!.uid, "monsterZone", 0);
    panzer!.faceUp = true;
    panzer!.position = "faceUpAttack";
    panzer!.reason = duelReason.destroy | duelReason.effect;
    panzer!.reasonPlayer = 1;

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${panzerDragonCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_MZONE)
      e:SetCondition(function(e,tp) return e:GetHandler():GetReasonPlayer()~=tp end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      local e2=e:Clone()
      e2:SetCondition(function(e,tp) return e:GetHandler():GetReasonPlayer()==1-tp end)
      c:RegisterEffect(e2)
      local e3=e:Clone()
      e3:SetCondition(function(e,tp) return e:GetHandler():IsReasonPlayer(1-tp) end)
      c:RegisterEffect(e3)
      local e4=e:Clone()
      e4:SetCondition(function(e,tp) return e:GetHandler():GetReasonPlayer()==tp end)
      c:RegisterEffect(e4)
      `,
      "panzer-dragon-official-source-reason-player-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects.filter((effect) => effect.code === 71)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ luaConditionDescriptor: "condition:source-reason-player:opponent" }),
        expect.objectContaining({ luaConditionDescriptor: "condition:source-reason-player:self" }),
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
    const opponentEffects = restored.session.state.effects.filter((effect) => effect.sourceUid === panzer!.uid && effect.luaConditionDescriptor === "condition:source-reason-player:opponent");
    const selfEffect = restored.session.state.effects.find((effect) => effect.sourceUid === panzer!.uid && effect.luaConditionDescriptor === "condition:source-reason-player:self");
    expect(restoredPanzer).toBeDefined();
    expect(opponentEffects).toHaveLength(3);
    expect(selfEffect).toBeDefined();

    const ctx = targetContext(restored.session.state, restoredPanzer!);
    for (const effect of opponentEffects) {
      expect(effect.canActivate?.(ctx)).toBe(true);
    }
    expect(selfEffect!.canActivate?.(ctx)).toBe(false);
    restoredPanzer!.reasonPlayer = 0;
    for (const effect of opponentEffects) {
      expect(effect.canActivate?.(ctx)).toBe(false);
      expect(effect.canActivate?.({ ...ctx, eventReasonPlayer: 1 })).toBe(true);
    }
    expect(selfEffect!.canActivate?.(ctx)).toBe(true);
    expect(selfEffect!.canActivate?.({ ...ctx, eventReasonPlayer: 1 })).toBe(false);
    delete restoredPanzer!.reasonPlayer;
    expect(selfEffect!.canActivate?.(ctx)).toBe(true);
  });

  it("restores local source GetReasonPlayer and IsReasonPlayer checks", () => {
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
    panzer!.reasonPlayer = 1;

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${panzerDragonCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_MZONE)
      e:SetCondition(function(e,tp)
        local c=e:GetHandler()
        return c:GetReasonPlayer()~=tp
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      local e2=e:Clone()
      e2:SetCondition(function(e,tp)
        local c=e:GetHandler()
        return c:GetReasonPlayer()==1-tp
      end)
      c:RegisterEffect(e2)
      local e3=e:Clone()
      e3:SetCondition(function(e,tp)
        local c=e:GetHandler()
        return c:IsReasonPlayer(1-tp)
      end)
      c:RegisterEffect(e3)
      local e4=e:Clone()
      e4:SetCondition(function(e,tp)
        local c=e:GetHandler()
        return c:GetReasonPlayer()==tp
      end)
      c:RegisterEffect(e4)
      `,
      "panzer-dragon-official-local-source-reason-player-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects.filter((effect) => effect.code === 71)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ luaConditionDescriptor: "condition:source-reason-player:opponent" }),
        expect.objectContaining({ luaConditionDescriptor: "condition:source-reason-player:self" }),
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
    const opponentEffects = restored.session.state.effects.filter((effect) => effect.sourceUid === panzer!.uid && effect.luaConditionDescriptor === "condition:source-reason-player:opponent");
    const selfEffect = restored.session.state.effects.find((effect) => effect.sourceUid === panzer!.uid && effect.luaConditionDescriptor === "condition:source-reason-player:self");
    expect(restoredPanzer).toBeDefined();
    expect(opponentEffects).toHaveLength(3);
    expect(selfEffect).toBeDefined();

    const ctx = targetContext(restored.session.state, restoredPanzer!);
    for (const effect of opponentEffects) {
      expect(effect.canActivate?.(ctx)).toBe(true);
    }
    expect(selfEffect!.canActivate?.(ctx)).toBe(false);
    restoredPanzer!.reasonPlayer = 0;
    for (const effect of opponentEffects) {
      expect(effect.canActivate?.(ctx)).toBe(false);
    }
    expect(selfEffect!.canActivate?.(ctx)).toBe(true);
    delete restoredPanzer!.reasonPlayer;
    expect(selfEffect!.canActivate?.(ctx)).toBe(true);
  });
});
