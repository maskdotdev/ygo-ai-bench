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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Newbee summon location condition", () => {
  it("restores source Summon Location checks using the source previous location", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const newbeeCode = "10807219";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === newbeeCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1080, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [newbeeCode] }, 1: { main: [] } });
    startDuel(session);
    const newbee = session.state.cards.find((card) => card.code === newbeeCode);
    expect(newbee).toBeDefined();
    moveDuelCard(session.state, newbee!.uid, "monsterZone", 0);
    newbee!.faceUp = true;
    newbee!.position = "faceUpAttack";
    newbee!.summonType = "special";
    newbee!.previousLocation = "hand";

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${newbeeCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_MZONE)
      e:SetCondition(function(e) return e:GetHandler():IsSummonLocation(LOCATION_HAND) end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "newbee-official-summon-location-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 71,
          luaConditionDescriptor: "condition:source-summon-location:2",
          luaValueDescriptor: "cannot-be-effect-target:opponent",
          range: ["monsterZone"],
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredNewbee = restored.session.state.cards.find((card) => card.code === newbeeCode);
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 71 && effect.sourceUid === newbee!.uid);
    expect(restoredNewbee).toBeDefined();
    expect(restoredEffect).toMatchObject({
      event: "continuous",
      code: 71,
      luaConditionDescriptor: "condition:source-summon-location:2",
      luaValueDescriptor: "cannot-be-effect-target:opponent",
      range: ["monsterZone"],
    });
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredNewbee!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredNewbee!.previousLocation = "graveyard";
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    delete restoredNewbee!.summonType;
    restoredNewbee!.previousLocation = "hand";
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });

  it("restores local source Summon Location checks using the source previous location", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const newbeeCode = "10807219";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === newbeeCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1081, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [newbeeCode] }, 1: { main: [] } });
    startDuel(session);
    const newbee = session.state.cards.find((card) => card.code === newbeeCode);
    expect(newbee).toBeDefined();
    moveDuelCard(session.state, newbee!.uid, "monsterZone", 0);
    newbee!.faceUp = true;
    newbee!.position = "faceUpAttack";
    newbee!.summonType = "special";
    newbee!.previousLocation = "hand";

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${newbeeCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_MZONE)
      e:SetCondition(function(e)
        local c=e:GetHandler()
        return c:IsSummonLocation(LOCATION_HAND)
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "newbee-official-local-summon-location-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 71,
          luaConditionDescriptor: "condition:source-summon-location:2",
          luaValueDescriptor: "cannot-be-effect-target:opponent",
          range: ["monsterZone"],
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredNewbee = restored.session.state.cards.find((card) => card.code === newbeeCode);
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 71 && effect.sourceUid === newbee!.uid);
    expect(restoredNewbee).toBeDefined();
    expect(restoredEffect).toMatchObject({
      event: "continuous",
      code: 71,
      luaConditionDescriptor: "condition:source-summon-location:2",
      luaValueDescriptor: "cannot-be-effect-target:opponent",
      range: ["monsterZone"],
    });
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredNewbee!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredNewbee!.previousLocation = "graveyard";
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    delete restoredNewbee!.summonType;
    restoredNewbee!.previousLocation = "hand";
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });
});
