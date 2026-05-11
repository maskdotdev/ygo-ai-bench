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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script source current turn condition", () => {
  it("restores source GetTurnID current turn checks from serialized card turn id", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const panzerDragonCode = "72959823";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === panzerDragonCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7307, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { extra: [panzerDragonCode], main: [] }, 1: { main: [] } });
    startDuel(session);

    const panzer = session.state.cards.find((card) => card.code === panzerDragonCode);
    expect(panzer).toBeDefined();
    moveDuelCard(session.state, panzer!.uid, "graveyard", 0);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${panzerDragonCode}),0,LOCATION_GRAVE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_GRAVE)
      e:SetCondition(function(e) return e:GetHandler():GetTurnID()==Duel.GetTurnCount() end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "panzer-dragon-official-source-turn-current-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 71,
          luaConditionDescriptor: "condition:source-turn-current",
          luaValueDescriptor: "cannot-be-effect-target:opponent",
          range: ["graveyard"],
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredPanzer = restored.session.state.cards.find((card) => card.code === panzerDragonCode);
    const restoredEffect = restored.session.state.effects.find((effect) => effect.sourceUid === panzer!.uid && effect.code === 71);
    expect(restoredPanzer).toMatchObject({ turnId: restored.session.state.turn });
    expect(restoredEffect).toMatchObject({
      luaConditionDescriptor: "condition:source-turn-current",
      luaValueDescriptor: "cannot-be-effect-target:opponent",
      range: ["graveyard"],
    });
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredPanzer!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredPanzer!.turnId = restored.session.state.turn - 1;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    restoredPanzer!.turnId = restored.session.state.turn + 1;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    restoredPanzer!.turnId = restored.session.state.turn;
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
  });
});
