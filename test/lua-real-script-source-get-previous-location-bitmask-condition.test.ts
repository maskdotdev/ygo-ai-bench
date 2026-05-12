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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script source GetPreviousLocation bitmask condition", () => {
  it("restores comma-local source previous-location bitmask checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const wormHopeCode = "11159464";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === wormHopeCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1116, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [wormHopeCode] }, 1: { main: [] } });
    startDuel(session);

    const wormHope = session.state.cards.find((card) => card.code === wormHopeCode);
    expect(wormHope).toBeDefined();
    moveDuelCard(session.state, wormHope!.uid, "monsterZone", 0);
    wormHope!.faceUp = true;
    wormHope!.position = "faceUpAttack";
    wormHope!.previousLocation = "monsterZone";

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${wormHopeCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_MZONE)
      e:SetCondition(function(e)
        local c,tp=e:GetHandler(),e:GetHandlerPlayer()
        return (c:GetPreviousLocation()&LOCATION_ONFIELD)~=0
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "worm-hope-comma-local-get-previous-location-bitmask-condition.lua",
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
    const restoredWormHope = restored.session.state.cards.find((card) => card.code === wormHopeCode);
    const restoredEffect = restored.session.state.effects.find((effect) => effect.sourceUid === wormHope!.uid && effect.code === 71);
    expect(restoredEffect).toMatchObject({
      luaConditionDescriptor: descriptor,
      luaValueDescriptor: "cannot-be-effect-target:opponent",
      range: ["monsterZone"],
    });
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredWormHope!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredWormHope!.previousLocation = "spellTrapZone";
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredWormHope!.previousLocation = "deck";
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    delete restoredWormHope!.previousLocation;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });

  it("restores source previous-location bitmask checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const wormHopeCode = "11159464";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === wormHopeCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1115, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [wormHopeCode] }, 1: { main: [] } });
    startDuel(session);

    const wormHope = session.state.cards.find((card) => card.code === wormHopeCode);
    expect(wormHope).toBeDefined();
    moveDuelCard(session.state, wormHope!.uid, "monsterZone", 0);
    wormHope!.faceUp = true;
    wormHope!.position = "faceUpAttack";
    wormHope!.previousLocation = "monsterZone";

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${wormHopeCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_MZONE)
      e:SetCondition(function(e) return (e:GetHandler():GetPreviousLocation()&LOCATION_ONFIELD)~=0 end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "worm-hope-official-get-previous-location-bitmask-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 71,
          luaConditionDescriptor: "condition:source-previous-location:12",
          luaValueDescriptor: "cannot-be-effect-target:opponent",
          range: ["monsterZone"],
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredWormHope = restored.session.state.cards.find((card) => card.code === wormHopeCode);
    const restoredEffect = restored.session.state.effects.find((effect) => effect.sourceUid === wormHope!.uid && effect.code === 71);
    expect(restoredWormHope).toBeDefined();
    expect(restoredEffect).toMatchObject({
      code: 71,
      luaConditionDescriptor: "condition:source-previous-location:12",
      luaValueDescriptor: "cannot-be-effect-target:opponent",
      range: ["monsterZone"],
    });
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredWormHope!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredWormHope!.previousLocation = "spellTrapZone";
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredWormHope!.previousLocation = "hand";
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    delete restoredWormHope!.previousLocation;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });
});
