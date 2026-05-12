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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script previous controller previous location reason-player condition", () => {
  it("restores comma-local previous-controller previous-location opponent reason-player checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const coppeliaCode = "77841719";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === coppeliaCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7785, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [coppeliaCode] }, 1: { main: [] } });
    startDuel(session);

    const coppelia = session.state.cards.find((card) => card.code === coppeliaCode);
    expect(coppelia).toBeDefined();
    moveDuelCard(session.state, coppelia!.uid, "monsterZone", 0);
    moveDuelCard(session.state, coppelia!.uid, "graveyard", 0, duelReason.effect, 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${coppeliaCode}),0,LOCATION_GRAVE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_GRAVE)
      e:SetCondition(function(e,tp,r,rp)
        local c,p=e:GetHandler(),e:GetHandlerPlayer()
        return c:IsPreviousLocation(LOCATION_MZONE) and c:IsPreviousControler(tp) and c:GetReasonPlayer()~=tp
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "coppelia-comma-local-previous-controller-previous-location-reason-player-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const descriptor = "condition:source-previous-controller-previous-location-reason-player:4:opponent";
    expect(session.state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ luaConditionDescriptor: descriptor, sourceUid: coppelia!.uid })]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredCoppelia = restored.session.state.cards.find((card) => card.code === coppeliaCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === coppelia!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = conditionContext(restored.session.state, restoredCoppelia!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredCoppelia!.reasonPlayer = 0;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredCoppelia!.reasonPlayer = 1;
    restoredCoppelia!.previousLocation = "spellTrapZone";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredCoppelia!.previousLocation = "monsterZone";
    restoredCoppelia!.previousController = 1;
    expect(effect!.canActivate!(ctx)).toBe(false);
  });

  it("restores previous-controller previous-location opponent reason-player checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const ranshinCode = "58324930";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === ranshinCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 5832, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ranshinCode] }, 1: { main: [] } });
    startDuel(session);

    const ranshin = session.state.cards.find((card) => card.code === ranshinCode);
    expect(ranshin).toBeDefined();
    moveDuelCard(session.state, ranshin!.uid, "monsterZone", 0);
    moveDuelCard(session.state, ranshin!.uid, "graveyard", 0, duelReason.effect, 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(ranshinCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    const descriptor = `condition:source-previous-controller-previous-location-reason-player:${locationOnField}:opponent`;
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: descriptor,
          sourceUid: ranshin!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredRanshin = restored.session.state.cards.find((card) => card.code === ranshinCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === ranshin!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = conditionContext(restored.session.state, restoredRanshin!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredRanshin!.reasonPlayer = 0;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredRanshin!.reasonPlayer = 1;
    restoredRanshin!.previousLocation = "deck";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredRanshin!.previousLocation = "monsterZone";
    restoredRanshin!.previousController = 1;
    expect(effect!.canActivate!(ctx)).toBe(false);
  });

  it("restores local-handler previous-location previous-controller opponent reason-player checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const coppeliaCode = "77841719";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === coppeliaCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7784, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [coppeliaCode] }, 1: { main: [] } });
    startDuel(session);

    const coppelia = session.state.cards.find((card) => card.code === coppeliaCode);
    expect(coppelia).toBeDefined();
    moveDuelCard(session.state, coppelia!.uid, "monsterZone", 0);
    moveDuelCard(session.state, coppelia!.uid, "graveyard", 0, duelReason.effect, 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(coppeliaCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    const descriptor = "condition:source-previous-controller-previous-location-reason-player:4:opponent";
    expect(session.state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ luaConditionDescriptor: descriptor, sourceUid: coppelia!.uid })]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredCoppelia = restored.session.state.cards.find((card) => card.code === coppeliaCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === coppelia!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = conditionContext(restored.session.state, restoredCoppelia!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredCoppelia!.reasonPlayer = 0;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredCoppelia!.reasonPlayer = 1;
    restoredCoppelia!.previousLocation = "spellTrapZone";
    expect(effect!.canActivate!(ctx)).toBe(false);
  });

  it("restores local-handler GetPreviousControler previous-location opponent reason-player checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const ascalonCode = "48891960";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === ascalonCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 4889, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [], extra: [ascalonCode] }, 1: { main: [] } });
    startDuel(session);

    const ascalon = session.state.cards.find((card) => card.code === ascalonCode);
    expect(ascalon).toBeDefined();
    moveDuelCard(session.state, ascalon!.uid, "monsterZone", 0);
    moveDuelCard(session.state, ascalon!.uid, "graveyard", 0, duelReason.effect, 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(ascalonCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    const descriptor = "condition:source-previous-controller-previous-location-reason-player:4:opponent";
    expect(session.state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ luaConditionDescriptor: descriptor, sourceUid: ascalon!.uid })]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredAscalon = restored.session.state.cards.find((card) => card.code === ascalonCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === ascalon!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = conditionContext(restored.session.state, restoredAscalon!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredAscalon!.previousController = 1;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredAscalon!.previousController = 0;
    restoredAscalon!.reasonPlayer = 0;
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});
