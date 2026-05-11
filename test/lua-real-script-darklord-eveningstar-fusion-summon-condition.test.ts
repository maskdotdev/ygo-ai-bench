import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { luaSummonTypeFusion } from "#duel/summon-type-codes.js";
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Darklord Eveningstar Fusion Summon condition", () => {
  it("restores source Fusion Summoned checks on known continuous effects", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const eveningstarCode = "10136446";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === eveningstarCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1013, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [], extra: [eveningstarCode] }, 1: { main: [] } });
    startDuel(session);
    const eveningstar = session.state.cards.find((card) => card.code === eveningstarCode);
    expect(eveningstar).toBeDefined();
    moveDuelCard(session.state, eveningstar!.uid, "monsterZone", 0);
    eveningstar!.faceUp = true;
    eveningstar!.position = "faceUpAttack";
    eveningstar!.summonType = "fusion";
    eveningstar!.summonTypeCode = luaSummonTypeFusion;

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${eveningstarCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_MZONE)
      e:SetCondition(function(e) return e:GetHandler():IsFusionSummoned() end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "darklord-eveningstar-official-fusion-summon-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 71,
          luaConditionDescriptor: `condition:source-summon-type:${luaSummonTypeFusion}`,
          luaValueDescriptor: "cannot-be-effect-target:opponent",
          range: ["monsterZone"],
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredEveningstar = restored.session.state.cards.find((card) => card.code === eveningstarCode);
    const restoredEffect = restored.session.state.effects.find((effect) => effect.code === 71 && effect.sourceUid === eveningstar!.uid);
    expect(restoredEveningstar).toBeDefined();
    expect(restoredEffect).toMatchObject({
      event: "continuous",
      code: 71,
      luaConditionDescriptor: `condition:source-summon-type:${luaSummonTypeFusion}`,
      luaValueDescriptor: "cannot-be-effect-target:opponent",
      range: ["monsterZone"],
    });
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredEveningstar!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredEveningstar!.summonType = "special";
    restoredEveningstar!.summonTypeCode = 0x40000000;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    delete restoredEveningstar!.summonType;
    delete restoredEveningstar!.summonTypeCode;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });
});
