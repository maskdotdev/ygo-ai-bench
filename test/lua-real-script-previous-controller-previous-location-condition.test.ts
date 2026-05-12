import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script previous controller previous location condition", () => {
  it("restores comma-local previous-controller previous-location checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const darkTinkerCode = "76614003";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === darkTinkerCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7662, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [darkTinkerCode] }, 1: { main: [] } });
    startDuel(session);

    const darkTinker = session.state.cards.find((card) => card.code === darkTinkerCode);
    expect(darkTinker).toBeDefined();
    moveDuelCard(session.state, darkTinker!.uid, "monsterZone", 0);
    moveDuelCard(session.state, darkTinker!.uid, "graveyard", 0);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${darkTinkerCode}),0,LOCATION_GRAVE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetCondition(function(e)
        local c,tp=e:GetHandler(),e:GetHandlerPlayer()
        return c:IsPreviousControler(tp) and c:IsPreviousLocation(LOCATION_ONFIELD)
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "dark-tinker-comma-local-previous-controller-location-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const descriptor = `condition:source-previous-controller-previous-location:${locationOnField}`;
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: descriptor,
          luaValueDescriptor: "cannot-be-effect-target:opponent",
          sourceUid: darkTinker!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredDarkTinker = restored.session.state.cards.find((card) => card.code === darkTinkerCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === darkTinker!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect).toMatchObject({ luaValueDescriptor: "cannot-be-effect-target:opponent" });
    expect(effect?.canActivate).toBeDefined();
    const ctx = conditionContext(restored.session.state, restoredDarkTinker!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredDarkTinker!.previousLocation = "spellTrapZone";
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredDarkTinker!.previousLocation = "deck";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredDarkTinker!.previousLocation = "monsterZone";
    restoredDarkTinker!.previousController = 1;
    expect(effect!.canActivate!(ctx)).toBe(false);
  });

  it("restores previous-controller previous-location checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const darkTinkerCode = "76614003";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === darkTinkerCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7661, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [darkTinkerCode] }, 1: { main: [] } });
    startDuel(session);

    const darkTinker = session.state.cards.find((card) => card.code === darkTinkerCode);
    expect(darkTinker).toBeDefined();
    moveDuelCard(session.state, darkTinker!.uid, "monsterZone", 0);
    moveDuelCard(session.state, darkTinker!.uid, "graveyard", 0);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(darkTinkerCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    const descriptor = `condition:source-previous-controller-previous-location:${locationOnField}`;
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: descriptor,
          sourceUid: darkTinker!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredDarkTinker = restored.session.state.cards.find((card) => card.code === darkTinkerCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === darkTinker!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = conditionContext(restored.session.state, restoredDarkTinker!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredDarkTinker!.previousLocation = "deck";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredDarkTinker!.previousLocation = "monsterZone";
    restoredDarkTinker!.previousController = 1;
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});
