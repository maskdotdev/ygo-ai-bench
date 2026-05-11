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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script source GetPreviousControler condition", () => {
  it("restores source previous-controller equality checks against the effect controller", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const wattfoxCode = "46897277";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === wattfoxCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 4689, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [wattfoxCode] }, 1: { main: [] } });
    startDuel(session);

    const wattfox = session.state.cards.find((card) => card.code === wattfoxCode);
    expect(wattfox).toBeDefined();
    moveDuelCard(session.state, wattfox!.uid, "monsterZone", 0);
    wattfox!.faceUp = true;
    wattfox!.position = "faceUpAttack";
    wattfox!.previousController = 0;

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${wattfoxCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_MZONE)
      e:SetCondition(function(e,tp) return rp==1-tp and e:GetHandler():GetPreviousControler()==tp end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "wattfox-official-get-previous-controller-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 71,
          controller: 0,
          luaConditionDescriptor: "condition:source-previous-controller",
          luaValueDescriptor: "cannot-be-effect-target:opponent",
          range: ["monsterZone"],
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredWattfox = restored.session.state.cards.find((card) => card.code === wattfoxCode);
    const restoredEffect = restored.session.state.effects.find((effect) => effect.sourceUid === wattfox!.uid && effect.code === 71);
    expect(restoredWattfox).toBeDefined();
    expect(restoredEffect).toMatchObject({
      code: 71,
      controller: 0,
      luaConditionDescriptor: "condition:source-previous-controller",
      luaValueDescriptor: "cannot-be-effect-target:opponent",
      range: ["monsterZone"],
    });
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredWattfox!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredWattfox!.previousController = 1;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    delete restoredWattfox!.previousController;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });
});
