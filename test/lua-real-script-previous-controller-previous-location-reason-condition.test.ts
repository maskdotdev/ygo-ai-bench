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
const locationOnField = 0x0c;
const locationMonsterZone = 0x04;

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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script previous controller previous location reason condition", () => {
  it("restores comma-local previous-location previous-controller reason order checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const asmodeusCode = "85771019";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === asmodeusCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8579, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [asmodeusCode] }, 1: { main: [] } });
    startDuel(session);

    const asmodeus = session.state.cards.find((card) => card.code === asmodeusCode);
    expect(asmodeus).toBeDefined();
    moveDuelCard(session.state, asmodeus!.uid, "monsterZone", 0);
    moveDuelCard(session.state, asmodeus!.uid, "graveyard", 0, duelReason.destroy, 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${asmodeusCode}),0,LOCATION_GRAVE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_GRAVE)
      e:SetCondition(function(e,tp)
        local c,p=e:GetHandler(),e:GetHandlerPlayer()
        return c:IsPreviousLocation(LOCATION_ONFIELD) and c:IsPreviousControler(tp) and c:IsReason(REASON_DESTROY)
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "asmodeus-comma-local-previous-location-controller-reason-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const descriptor = `condition:source-previous-controller-previous-location-reason:${locationOnField}:${duelReason.destroy}`;
    expect(session.state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ code: 71, luaConditionDescriptor: descriptor, sourceUid: asmodeus!.uid })]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expectRestoreActionParity(restored, 0);
    const restoredAsmodeus = restored.session.state.cards.find((card) => card.code === asmodeusCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === asmodeus!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredAsmodeus!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredAsmodeus!.previousLocation = "deck";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredAsmodeus!.previousLocation = "monsterZone";
    restoredAsmodeus!.previousController = 1;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredAsmodeus!.previousController = 0;
    restoredAsmodeus!.reason = duelReason.effect;
    expect(effect!.canActivate!(ctx)).toBe(false);
  });

  it("restores comma-local previous-controller previous-location reason checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const asmodeusCode = "85771019";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === asmodeusCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8578, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [asmodeusCode] }, 1: { main: [] } });
    startDuel(session);

    const asmodeus = session.state.cards.find((card) => card.code === asmodeusCode);
    expect(asmodeus).toBeDefined();
    moveDuelCard(session.state, asmodeus!.uid, "monsterZone", 0);
    moveDuelCard(session.state, asmodeus!.uid, "graveyard", 0, duelReason.effect, 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${asmodeusCode}),0,LOCATION_GRAVE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_GRAVE)
      e:SetCondition(function(e,tp)
        local c,p=e:GetHandler(),e:GetHandlerPlayer()
        return c:IsPreviousControler(tp) and c:IsPreviousLocation(LOCATION_ONFIELD) and c:IsReason(REASON_EFFECT)
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "asmodeus-comma-local-previous-controller-location-reason-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const descriptor = `condition:source-previous-controller-previous-location-reason:${locationOnField}:${duelReason.effect}`;
    expect(session.state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ code: 71, luaConditionDescriptor: descriptor, sourceUid: asmodeus!.uid })]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expectRestoreActionParity(restored, 0);
    const restoredAsmodeus = restored.session.state.cards.find((card) => card.code === asmodeusCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === asmodeus!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredAsmodeus!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredAsmodeus!.reason = duelReason.destroy;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredAsmodeus!.reason = duelReason.effect;
    restoredAsmodeus!.previousLocation = "deck";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredAsmodeus!.previousLocation = "monsterZone";
    restoredAsmodeus!.previousController = 1;
    expect(effect!.canActivate!(ctx)).toBe(false);
  });

  it("restores previous-controller previous-location destroy-reason checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const asmodeusCode = "85771019";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === asmodeusCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8267, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [asmodeusCode] }, 1: { main: [] } });
    startDuel(session);

    const asmodeus = session.state.cards.find((card) => card.code === asmodeusCode);
    expect(asmodeus).toBeDefined();
    moveDuelCard(session.state, asmodeus!.uid, "monsterZone", 0);
    moveDuelCard(session.state, asmodeus!.uid, "graveyard", 0, duelReason.destroy, 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(asmodeusCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const descriptor = `condition:source-previous-controller-previous-location-reason:${locationOnField}:${duelReason.destroy}`;
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: descriptor,
          sourceUid: asmodeus!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expectRestoreActionParity(restored, 0);
    const restoredAsmodeus = restored.session.state.cards.find((card) => card.code === asmodeusCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === asmodeus!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredAsmodeus!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredAsmodeus!.reason = duelReason.effect;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredAsmodeus!.reason = duelReason.destroy;
    restoredAsmodeus!.previousLocation = "deck";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredAsmodeus!.previousLocation = "monsterZone";
    restoredAsmodeus!.previousController = 1;
    expect(effect!.canActivate!(ctx)).toBe(false);
  });

  it("restores local previous-location previous-controller reason order checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const asmodeusCode = "85771019";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === asmodeusCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8577, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [asmodeusCode] }, 1: { main: [] } });
    startDuel(session);

    const asmodeus = session.state.cards.find((card) => card.code === asmodeusCode);
    expect(asmodeus).toBeDefined();
    moveDuelCard(session.state, asmodeus!.uid, "monsterZone", 0);
    moveDuelCard(session.state, asmodeus!.uid, "graveyard", 0, duelReason.effect, 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${asmodeusCode}),0,LOCATION_GRAVE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_GRAVE)
      e:SetCondition(function(e)
        local c=e:GetHandler()
        return c:IsPreviousLocation(LOCATION_ONFIELD) and c:IsPreviousControler(tp) and c:IsReason(REASON_EFFECT)
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "asmodeus-local-previous-location-controller-reason-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const descriptor = `condition:source-previous-controller-previous-location-reason:${locationOnField}:${duelReason.effect}`;
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 71,
          luaConditionDescriptor: descriptor,
          sourceUid: asmodeus!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expectRestoreActionParity(restored, 0);
    const restoredAsmodeus = restored.session.state.cards.find((card) => card.code === asmodeusCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === asmodeus!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredAsmodeus!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredAsmodeus!.reason = duelReason.destroy;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredAsmodeus!.reason = duelReason.effect;
    restoredAsmodeus!.previousController = 1;
    expect(effect!.canActivate!(ctx)).toBe(false);
  });

  it("restores card-filter previous-controller previous-location reason checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const asmodeusCode = "85771019";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === asmodeusCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 6471, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [asmodeusCode] }, 1: { main: [] } });
    startDuel(session);

    const asmodeus = session.state.cards.find((card) => card.code === asmodeusCode);
    expect(asmodeus).toBeDefined();
    moveDuelCard(session.state, asmodeus!.uid, "monsterZone", 0);
    moveDuelCard(session.state, asmodeus!.uid, "graveyard", 0, duelReason.destroy, 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${asmodeusCode}),0,LOCATION_GRAVE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_GRAVE)
      e:SetCondition(function(e,tp)
        local c=e:GetHandler()
        return c:GetPreviousControler()==tp and c:IsPreviousLocation(LOCATION_MZONE) and c:IsReason(REASON_DESTROY)
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "asmodeus-card-filter-previous-controller-location-reason-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const descriptor = `condition:source-previous-controller-previous-location-reason:${locationMonsterZone}:${duelReason.destroy}`;
    expect(session.state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ code: 71, luaConditionDescriptor: descriptor, sourceUid: asmodeus!.uid })]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expectRestoreActionParity(restored, 0);
    const restoredAsmodeus = restored.session.state.cards.find((card) => card.code === asmodeusCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === asmodeus!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredAsmodeus!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredAsmodeus!.previousLocation = "spellTrapZone";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredAsmodeus!.previousLocation = "monsterZone";
    restoredAsmodeus!.reason = duelReason.effect;
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});

function expectRestoreActionParity(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(
    getLuaRestoreLegalActions(restored, player),
  );
}
