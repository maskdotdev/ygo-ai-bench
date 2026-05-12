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
const locationMonsterZone = 0x04;

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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script source GetPreviousLocation condition", () => {
  it("restores comma-local source previous-location equality checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const vylonTetraCode = "1281505";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === vylonTetraCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1282, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [vylonTetraCode] }, 1: { main: [] } });
    startDuel(session);

    const vylonTetra = session.state.cards.find((card) => card.code === vylonTetraCode);
    expect(vylonTetra).toBeDefined();
    moveDuelCard(session.state, vylonTetra!.uid, "monsterZone", 0);
    vylonTetra!.faceUp = true;
    vylonTetra!.position = "faceUpAttack";
    vylonTetra!.previousLocation = "monsterZone";

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${vylonTetraCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_MZONE)
      e:SetCondition(function(e)
        local c,tp=e:GetHandler(),e:GetHandlerPlayer()
        return c:GetPreviousLocation()==LOCATION_MZONE
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "vylon-tetra-comma-local-get-previous-location-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const descriptor = `condition:source-previous-location:${locationMonsterZone}`;
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 71,
          luaConditionDescriptor: descriptor,
          luaValueDescriptor: "cannot-be-effect-target:opponent",
          range: ["monsterZone"],
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredVylonTetra = restored.session.state.cards.find((card) => card.code === vylonTetraCode);
    const restoredEffect = restored.session.state.effects.find((effect) => effect.sourceUid === vylonTetra!.uid && effect.code === 71);
    expect(restoredEffect).toMatchObject({
      luaConditionDescriptor: descriptor,
      luaValueDescriptor: "cannot-be-effect-target:opponent",
      range: ["monsterZone"],
    });
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredVylonTetra!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredVylonTetra!.previousLocation = "spellTrapZone";
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    delete restoredVylonTetra!.previousLocation;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });

  it("restores source previous-location equality checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const babyRocCode = "14983497";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === babyRocCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1498, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [babyRocCode] }, 1: { main: [] } });
    startDuel(session);

    const babyRoc = session.state.cards.find((card) => card.code === babyRocCode);
    expect(babyRoc).toBeDefined();
    moveDuelCard(session.state, babyRoc!.uid, "monsterZone", 0);
    babyRoc!.faceUp = true;
    babyRoc!.position = "faceUpAttack";
    babyRoc!.previousLocation = "hand";

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${babyRocCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_MZONE)
      e:SetCondition(function(e) return e:GetHandler():GetPreviousLocation()==LOCATION_HAND end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "baby-roc-official-get-previous-location-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 71,
          luaConditionDescriptor: "condition:source-previous-location:2",
          luaValueDescriptor: "cannot-be-effect-target:opponent",
          range: ["monsterZone"],
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredBabyRoc = restored.session.state.cards.find((card) => card.code === babyRocCode);
    const restoredEffect = restored.session.state.effects.find((effect) => effect.sourceUid === babyRoc!.uid && effect.code === 71);
    expect(restoredBabyRoc).toBeDefined();
    expect(restoredEffect).toMatchObject({
      code: 71,
      luaConditionDescriptor: "condition:source-previous-location:2",
      luaValueDescriptor: "cannot-be-effect-target:opponent",
      range: ["monsterZone"],
    });
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredBabyRoc!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredBabyRoc!.previousLocation = "deck";
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    delete restoredBabyRoc!.previousLocation;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });

  it("restores local source previous-location equality checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const vylonTetraCode = "1281505";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === vylonTetraCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1281, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [vylonTetraCode] }, 1: { main: [] } });
    startDuel(session);

    const vylonTetra = session.state.cards.find((card) => card.code === vylonTetraCode);
    expect(vylonTetra).toBeDefined();
    moveDuelCard(session.state, vylonTetra!.uid, "monsterZone", 0);
    vylonTetra!.faceUp = true;
    vylonTetra!.position = "faceUpAttack";
    vylonTetra!.previousLocation = "monsterZone";

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${vylonTetraCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_MZONE)
      e:SetCondition(function(e)
        local c=e:GetHandler()
        return c:GetPreviousLocation()==LOCATION_MZONE
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "vylon-tetra-official-local-get-previous-location-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const descriptor = `condition:source-previous-location:${locationMonsterZone}`;
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 71,
          luaConditionDescriptor: descriptor,
          luaValueDescriptor: "cannot-be-effect-target:opponent",
          range: ["monsterZone"],
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredVylonTetra = restored.session.state.cards.find((card) => card.code === vylonTetraCode);
    const restoredEffect = restored.session.state.effects.find((effect) => effect.sourceUid === vylonTetra!.uid && effect.code === 71);
    expect(restoredEffect).toMatchObject({ luaConditionDescriptor: descriptor });
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredVylonTetra!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredVylonTetra!.previousLocation = "hand";
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });
});
