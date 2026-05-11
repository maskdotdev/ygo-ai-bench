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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script source GetPreviousPosition condition", () => {
  it("restores source previous-position bitmask checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const vylonSegmentCode = "1644289";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === vylonSegmentCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1644, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [vylonSegmentCode] }, 1: { main: [] } });
    startDuel(session);

    const vylonSegment = session.state.cards.find((card) => card.code === vylonSegmentCode);
    expect(vylonSegment).toBeDefined();
    moveDuelCard(session.state, vylonSegment!.uid, "monsterZone", 0);
    vylonSegment!.faceUp = true;
    vylonSegment!.position = "faceUpAttack";
    vylonSegment!.previousPosition = "faceUpDefense";

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${vylonSegmentCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_MZONE)
      e:SetCondition(function(e) return (e:GetHandler():GetPreviousPosition()&POS_FACEUP)~=0 end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "vylon-segment-official-get-previous-position-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 71,
          luaConditionDescriptor: "condition:source-previous-position:5",
          luaValueDescriptor: "cannot-be-effect-target:opponent",
          range: ["monsterZone"],
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredSegment = restored.session.state.cards.find((card) => card.code === vylonSegmentCode);
    const restoredEffect = restored.session.state.effects.find((effect) => effect.sourceUid === vylonSegment!.uid && effect.code === 71);
    expect(restoredSegment).toBeDefined();
    expect(restoredEffect).toMatchObject({
      code: 71,
      luaConditionDescriptor: "condition:source-previous-position:5",
      luaValueDescriptor: "cannot-be-effect-target:opponent",
      range: ["monsterZone"],
    });
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredSegment!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredSegment!.previousPosition = "faceUpAttack";
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredSegment!.previousPosition = "faceDownDefense";
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    delete restoredSegment!.previousPosition;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });
});
