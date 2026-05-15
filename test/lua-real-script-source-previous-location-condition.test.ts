import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelCardInstance, DuelEffectContext } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const locationOnField = 0x0c;

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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script source previous location condition", () => {
  it("restores comma-local source previous-location checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const gatchiriCode = "82257671";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === gatchiriCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8226, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [gatchiriCode] }, 1: { main: [] } });
    startDuel(session);

    const gatchiri = session.state.cards.find((card) => card.code === gatchiriCode);
    expect(gatchiri).toBeDefined();
    moveDuelCard(session.state, gatchiri!.uid, "monsterZone", 0);
    gatchiri!.faceUp = true;
    gatchiri!.position = "faceUpAttack";
    gatchiri!.previousLocation = "monsterZone";

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${gatchiriCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_MZONE)
      e:SetCondition(function(e)
        local c,tp=e:GetHandler(),e:GetHandlerPlayer()
        return c:IsPreviousLocation(LOCATION_ONFIELD)
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "gatchiri-comma-local-previous-location-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const descriptor = `condition:source-previous-location:${locationOnField}`;
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
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const restoredGatchiri = restored.session.state.cards.find((card) => card.code === gatchiriCode);
    const restoredEffect = restored.session.state.effects.find((effect) => effect.sourceUid === gatchiri!.uid && effect.code === 71);
    expect(restoredEffect).toMatchObject({
      luaConditionDescriptor: descriptor,
      luaValueDescriptor: "cannot-be-effect-target:opponent",
      range: ["monsterZone"],
    });
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredGatchiri!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredGatchiri!.previousLocation = "spellTrapZone";
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredGatchiri!.previousLocation = "hand";
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    delete restoredGatchiri!.previousLocation;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });

  it("restores source previous-location checks from composite masks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const felineCode = "11024707";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === felineCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1102, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [felineCode] }, 1: { main: [] } });
    startDuel(session);

    const feline = session.state.cards.find((card) => card.code === felineCode);
    expect(feline).toBeDefined();
    moveDuelCard(session.state, feline!.uid, "monsterZone", 0);
    feline!.faceUp = true;
    feline!.position = "faceUpAttack";
    feline!.previousLocation = "hand";

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${felineCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_MZONE)
      e:SetCondition(function(e) return e:GetHandler():IsPreviousLocation(LOCATION_HAND|LOCATION_DECK) end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "flipping-feline-official-previous-location-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 71,
          luaConditionDescriptor: "condition:source-previous-location:3",
          luaValueDescriptor: "cannot-be-effect-target:opponent",
          range: ["monsterZone"],
        }),
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
    const restoredFeline = restored.session.state.cards.find((card) => card.code === felineCode);
    const restoredEffect = restored.session.state.effects.find((effect) => effect.sourceUid === feline!.uid && effect.code === 71);
    expect(restoredFeline).toBeDefined();
    expect(restoredEffect).toMatchObject({
      code: 71,
      luaConditionDescriptor: "condition:source-previous-location:3",
      luaValueDescriptor: "cannot-be-effect-target:opponent",
      range: ["monsterZone"],
    });
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredFeline!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredFeline!.previousLocation = "deck";
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredFeline!.previousLocation = "graveyard";
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    delete restoredFeline!.previousLocation;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });

  it("restores local source previous-location checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const gatchiriCode = "82257671";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === gatchiriCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8225, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [gatchiriCode] }, 1: { main: [] } });
    startDuel(session);

    const gatchiri = session.state.cards.find((card) => card.code === gatchiriCode);
    expect(gatchiri).toBeDefined();
    moveDuelCard(session.state, gatchiri!.uid, "monsterZone", 0);
    gatchiri!.faceUp = true;
    gatchiri!.position = "faceUpAttack";
    gatchiri!.previousLocation = "monsterZone";

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${gatchiriCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_MZONE)
      e:SetCondition(function(e)
        local c=e:GetHandler()
        return c:IsPreviousLocation(LOCATION_ONFIELD)
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "gatchiri-official-local-previous-location-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const descriptor = `condition:source-previous-location:${locationOnField}`;
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
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const restoredGatchiri = restored.session.state.cards.find((card) => card.code === gatchiriCode);
    const restoredEffect = restored.session.state.effects.find((effect) => effect.sourceUid === gatchiri!.uid && effect.code === 71);
    expect(restoredEffect).toMatchObject({ luaConditionDescriptor: descriptor });
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredGatchiri!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredGatchiri!.previousLocation = "hand";
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });
});
