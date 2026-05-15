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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script source previous controller condition", () => {
  it("restores comma-local source previous-controller checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const steelswarmStingCode = "35618486";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === steelswarmStingCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 3562, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [steelswarmStingCode] }, 1: { main: [] } });
    startDuel(session);

    const sting = session.state.cards.find((card) => card.code === steelswarmStingCode);
    expect(sting).toBeDefined();
    moveDuelCard(session.state, sting!.uid, "monsterZone", 0);
    sting!.faceUp = true;
    sting!.position = "faceUpAttack";
    sting!.previousController = 0;

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${steelswarmStingCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_MZONE)
      e:SetCondition(function(e,tp)
        local c,p=e:GetHandler(),e:GetHandlerPlayer()
        return c:IsPreviousControler(tp)
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "steelswarm-sting-comma-local-previous-controller-condition.lua",
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
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const restoredSting = restored.session.state.cards.find((card) => card.code === steelswarmStingCode);
    const restoredEffect = restored.session.state.effects.find((effect) => effect.sourceUid === sting!.uid && effect.code === 71);
    expect(restoredEffect).toMatchObject({
      luaConditionDescriptor: "condition:source-previous-controller",
      luaValueDescriptor: "cannot-be-effect-target:opponent",
      range: ["monsterZone"],
    });
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredSting!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredSting!.previousController = 1;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    delete restoredSting!.previousController;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });

  it("restores source previous-controller checks against the effect controller", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const steelswarmStingCode = "35618486";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === steelswarmStingCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 3561, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [steelswarmStingCode] }, 1: { main: [] } });
    startDuel(session);

    const sting = session.state.cards.find((card) => card.code === steelswarmStingCode);
    expect(sting).toBeDefined();
    moveDuelCard(session.state, sting!.uid, "monsterZone", 0);
    sting!.faceUp = true;
    sting!.position = "faceUpAttack";
    sting!.previousController = 0;

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${steelswarmStingCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_MZONE)
      e:SetCondition(function(e,tp) return e:GetHandler():IsPreviousControler(tp) end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "steelswarm-sting-official-previous-controller-condition.lua",
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
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const restoredSting = restored.session.state.cards.find((card) => card.code === steelswarmStingCode);
    const restoredEffect = restored.session.state.effects.find((effect) => effect.sourceUid === sting!.uid && effect.code === 71);
    expect(restoredSting).toBeDefined();
    expect(restoredEffect).toMatchObject({
      code: 71,
      controller: 0,
      luaConditionDescriptor: "condition:source-previous-controller",
      luaValueDescriptor: "cannot-be-effect-target:opponent",
      range: ["monsterZone"],
    });
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredSting!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredSting!.previousController = 1;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    delete restoredSting!.previousController;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });
});
