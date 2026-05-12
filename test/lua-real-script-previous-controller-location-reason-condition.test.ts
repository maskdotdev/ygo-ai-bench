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
const locationGraveyard = 0x10;

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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script previous controller location reason condition", () => {
  it("restores comma-local previous-controller current-location battle-reason checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const defenderCode = "24025620";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === defenderCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 2403, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [defenderCode] }, 1: { main: [] } });
    startDuel(session);

    const defender = session.state.cards.find((card) => card.code === defenderCode);
    expect(defender).toBeDefined();
    moveDuelCard(session.state, defender!.uid, "monsterZone", 0);
    moveDuelCard(session.state, defender!.uid, "graveyard", 0, duelReason.battle, 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${defenderCode}),0,LOCATION_GRAVE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_GRAVE)
      e:SetCondition(function(e,tp)
        local c,p=e:GetHandler(),e:GetHandlerPlayer()
        return c:IsPreviousControler(tp) and c:IsLocation(LOCATION_GRAVE) and c:IsReason(REASON_BATTLE)
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "defender-comma-local-previous-controller-current-location-reason-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const descriptor = `condition:source-previous-controller-location-reason:${locationGraveyard}:${duelReason.battle}`;
    expect(session.state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ luaConditionDescriptor: descriptor, sourceUid: defender!.uid })]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredDefender = restored.session.state.cards.find((card) => card.code === defenderCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === defender!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = conditionContext(restored.session.state, restoredDefender!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredDefender!.location = "monsterZone";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredDefender!.location = "graveyard";
    restoredDefender!.previousController = 1;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredDefender!.previousController = 0;
    restoredDefender!.reason = duelReason.effect;
    expect(effect!.canActivate!(ctx)).toBe(false);
    expect(effect!.canActivate!({ ...ctx, eventReason: duelReason.battle })).toBe(true);
  });

  it("restores previous-controller current-location battle-reason checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const defenderCode = "24025620";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === defenderCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8246, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [defenderCode] }, 1: { main: [] } });
    startDuel(session);

    const defender = session.state.cards.find((card) => card.code === defenderCode);
    expect(defender).toBeDefined();
    moveDuelCard(session.state, defender!.uid, "monsterZone", 0);
    moveDuelCard(session.state, defender!.uid, "graveyard", 0, duelReason.battle, 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(defenderCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: `condition:source-previous-controller-location-reason:${locationGraveyard}:${duelReason.battle}`,
          sourceUid: defender!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredDefender = restored.session.state.cards.find((card) => card.code === defenderCode);
    const descriptor = `condition:source-previous-controller-location-reason:${locationGraveyard}:${duelReason.battle}`;
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === defender!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = conditionContext(restored.session.state, restoredDefender!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredDefender!.reason = duelReason.effect;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredDefender!.reason = duelReason.battle;
    restoredDefender!.location = "monsterZone";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredDefender!.location = "graveyard";
    restoredDefender!.previousController = 1;
    expect(effect!.canActivate!(ctx)).toBe(false);
  });

  it("restores previous-controller first current-location battle-reason checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const defenderCode = "24025620";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === defenderCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 2402, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [defenderCode] }, 1: { main: [] } });
    startDuel(session);

    const defender = session.state.cards.find((card) => card.code === defenderCode);
    expect(defender).toBeDefined();
    moveDuelCard(session.state, defender!.uid, "monsterZone", 0);
    moveDuelCard(session.state, defender!.uid, "graveyard", 0, duelReason.battle, 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${defenderCode}),0,LOCATION_GRAVE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_GRAVE)
      e:SetCondition(function(e)
        local c=e:GetHandler()
        return c:IsPreviousControler(tp) and c:IsLocation(LOCATION_GRAVE) and c:IsReason(REASON_BATTLE)
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "defender-previous-controller-first-current-location-reason-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const descriptor = `condition:source-previous-controller-location-reason:${locationGraveyard}:${duelReason.battle}`;
    expect(session.state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ luaConditionDescriptor: descriptor, sourceUid: defender!.uid })]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredDefender = restored.session.state.cards.find((card) => card.code === defenderCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === defender!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = conditionContext(restored.session.state, restoredDefender!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredDefender!.location = "monsterZone";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredDefender!.location = "graveyard";
    restoredDefender!.previousController = 1;
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});
