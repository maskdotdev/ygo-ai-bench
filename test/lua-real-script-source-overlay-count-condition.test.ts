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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script source overlay count condition", () => {
  it("restores comma-local source overlay-count positive and zero checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sargasCode = "11132674";
    const materialCode = "11132677";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sargasCode),
      { code: materialCode, name: "Sargas Overlay Material Fixture 3", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1115, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode], extra: [sargasCode] }, 1: { main: [] } });
    startDuel(session);

    const sargas = session.state.cards.find((card) => card.code === sargasCode);
    const material = session.state.cards.find((card) => card.code === materialCode);
    expect(sargas).toBeDefined();
    expect(material).toBeDefined();
    moveDuelCard(session.state, sargas!.uid, "monsterZone", 0);
    moveDuelCard(session.state, material!.uid, "overlay", 0);
    sargas!.faceUp = true;
    sargas!.position = "faceUpAttack";
    sargas!.overlayUids.push(material!.uid);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${sargasCode}),0,LOCATION_MZONE,0,nil)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_SINGLE)
      e1:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e1:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e1:SetRange(LOCATION_MZONE)
      e1:SetCondition(function(e)
        local c,tp=e:GetHandler(),e:GetHandlerPlayer()
        return c:GetOverlayCount()>0
      end)
      e1:SetValue(aux.tgoval)
      c:RegisterEffect(e1)
      local e2=Effect.CreateEffect(c)
      e2:SetType(EFFECT_TYPE_SINGLE)
      e2:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e2:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e2:SetRange(LOCATION_MZONE)
      e2:SetCondition(function(e)
        local c,tp=e:GetHandler(),e:GetHandlerPlayer()
        return c:GetOverlayCount()==0
      end)
      e2:SetValue(aux.tgoval)
      c:RegisterEffect(e2)
      `,
      "sargas-official-comma-local-overlay-count-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 71, luaConditionDescriptor: "condition:source-overlay-count-positive" }),
        expect.objectContaining({ code: 71, luaConditionDescriptor: "condition:source-overlay-count-zero" }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredSargas = restored.session.state.cards.find((card) => card.code === sargasCode);
    const positiveEffect = restored.session.state.effects.find((effect) => effect.sourceUid === sargas!.uid && effect.luaConditionDescriptor === "condition:source-overlay-count-positive");
    const zeroEffect = restored.session.state.effects.find((effect) => effect.sourceUid === sargas!.uid && effect.luaConditionDescriptor === "condition:source-overlay-count-zero");
    expect(restoredSargas).toBeDefined();
    expect(positiveEffect).toMatchObject({ luaConditionDescriptor: "condition:source-overlay-count-positive" });
    expect(zeroEffect).toMatchObject({ luaConditionDescriptor: "condition:source-overlay-count-zero" });
    const ctx = targetContext(restored.session.state, restoredSargas!);
    expect(positiveEffect?.canActivate?.(ctx)).toBe(true);
    expect(zeroEffect?.canActivate?.(ctx)).toBe(false);
    restoredSargas!.overlayUids = [];
    expect(positiveEffect?.canActivate?.(ctx)).toBe(false);
    expect(zeroEffect?.canActivate?.(ctx)).toBe(true);
  });

  it("restores source overlay-count positive and zero checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sargasCode = "11132674";
    const materialCode = "11132675";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sargasCode),
      { code: materialCode, name: "Sargas Overlay Material Fixture", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1113, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode], extra: [sargasCode] }, 1: { main: [] } });
    startDuel(session);

    const sargas = session.state.cards.find((card) => card.code === sargasCode);
    const material = session.state.cards.find((card) => card.code === materialCode);
    expect(sargas).toBeDefined();
    expect(material).toBeDefined();
    moveDuelCard(session.state, sargas!.uid, "monsterZone", 0);
    moveDuelCard(session.state, material!.uid, "overlay", 0);
    sargas!.faceUp = true;
    sargas!.position = "faceUpAttack";
    sargas!.overlayUids.push(material!.uid);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${sargasCode}),0,LOCATION_MZONE,0,nil)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_SINGLE)
      e1:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e1:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e1:SetRange(LOCATION_MZONE)
      e1:SetCondition(function(e) return e:GetHandler():GetOverlayCount()>0 end)
      e1:SetValue(aux.tgoval)
      c:RegisterEffect(e1)
      local e2=Effect.CreateEffect(c)
      e2:SetType(EFFECT_TYPE_SINGLE)
      e2:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e2:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e2:SetRange(LOCATION_MZONE)
      e2:SetCondition(function(e) return e:GetHandler():GetOverlayCount()==0 end)
      e2:SetValue(aux.tgoval)
      c:RegisterEffect(e2)
      `,
      "sargas-official-overlay-count-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 71, luaConditionDescriptor: "condition:source-overlay-count-positive" }),
        expect.objectContaining({ code: 71, luaConditionDescriptor: "condition:source-overlay-count-zero" }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredSargas = restored.session.state.cards.find((card) => card.code === sargasCode);
    const positiveEffect = restored.session.state.effects.find((effect) => effect.sourceUid === sargas!.uid && effect.luaConditionDescriptor === "condition:source-overlay-count-positive");
    const zeroEffect = restored.session.state.effects.find((effect) => effect.sourceUid === sargas!.uid && effect.luaConditionDescriptor === "condition:source-overlay-count-zero");
    expect(restoredSargas).toBeDefined();
    expect(positiveEffect).toMatchObject({ luaConditionDescriptor: "condition:source-overlay-count-positive" });
    expect(zeroEffect).toMatchObject({ luaConditionDescriptor: "condition:source-overlay-count-zero" });
    const ctx = targetContext(restored.session.state, restoredSargas!);
    expect(positiveEffect?.canActivate?.(ctx)).toBe(true);
    expect(zeroEffect?.canActivate?.(ctx)).toBe(false);
    restoredSargas!.overlayUids = [];
    expect(positiveEffect?.canActivate?.(ctx)).toBe(false);
    expect(zeroEffect?.canActivate?.(ctx)).toBe(true);
  });

  it("restores local source overlay-count positive and zero checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sargasCode = "11132674";
    const materialCode = "11132676";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sargasCode),
      { code: materialCode, name: "Sargas Overlay Material Fixture 2", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1114, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode], extra: [sargasCode] }, 1: { main: [] } });
    startDuel(session);

    const sargas = session.state.cards.find((card) => card.code === sargasCode);
    const material = session.state.cards.find((card) => card.code === materialCode);
    expect(sargas).toBeDefined();
    expect(material).toBeDefined();
    moveDuelCard(session.state, sargas!.uid, "monsterZone", 0);
    moveDuelCard(session.state, material!.uid, "overlay", 0);
    sargas!.faceUp = true;
    sargas!.position = "faceUpAttack";
    sargas!.overlayUids.push(material!.uid);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${sargasCode}),0,LOCATION_MZONE,0,nil)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_SINGLE)
      e1:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e1:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e1:SetRange(LOCATION_MZONE)
      e1:SetCondition(function(e)
        local c=e:GetHandler()
        return c:GetOverlayCount()>0
      end)
      e1:SetValue(aux.tgoval)
      c:RegisterEffect(e1)
      local e2=Effect.CreateEffect(c)
      e2:SetType(EFFECT_TYPE_SINGLE)
      e2:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e2:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e2:SetRange(LOCATION_MZONE)
      e2:SetCondition(function(e)
        local c=e:GetHandler()
        return c:GetOverlayCount()==0
      end)
      e2:SetValue(aux.tgoval)
      c:RegisterEffect(e2)
      `,
      "sargas-official-local-overlay-count-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 71, luaConditionDescriptor: "condition:source-overlay-count-positive" }),
        expect.objectContaining({ code: 71, luaConditionDescriptor: "condition:source-overlay-count-zero" }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredSargas = restored.session.state.cards.find((card) => card.code === sargasCode);
    const positiveEffect = restored.session.state.effects.find((effect) => effect.sourceUid === sargas!.uid && effect.luaConditionDescriptor === "condition:source-overlay-count-positive");
    const zeroEffect = restored.session.state.effects.find((effect) => effect.sourceUid === sargas!.uid && effect.luaConditionDescriptor === "condition:source-overlay-count-zero");
    expect(restoredSargas).toBeDefined();
    expect(positiveEffect).toMatchObject({ luaConditionDescriptor: "condition:source-overlay-count-positive" });
    expect(zeroEffect).toMatchObject({ luaConditionDescriptor: "condition:source-overlay-count-zero" });
    const ctx = targetContext(restored.session.state, restoredSargas!);
    expect(positiveEffect?.canActivate?.(ctx)).toBe(true);
    expect(zeroEffect?.canActivate?.(ctx)).toBe(false);
    restoredSargas!.overlayUids = [];
    expect(positiveEffect?.canActivate?.(ctx)).toBe(false);
    expect(zeroEffect?.canActivate?.(ctx)).toBe(true);
  });
});
