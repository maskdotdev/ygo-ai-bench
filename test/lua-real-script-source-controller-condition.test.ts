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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script source controller condition", () => {
  it("restores direct and local source IsControler checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sourceCode = "39210885";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sourceCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 3921, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sourceCode] }, 1: { main: [] } });
    startDuel(session);

    const source = session.state.cards.find((card) => card.code === sourceCode);
    expect(source).toBeDefined();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0);
    source!.faceUp = true;
    source!.position = "faceUpAttack";

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${sourceCode}),0,LOCATION_MZONE,0,nil)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_SINGLE)
      e1:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e1:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e1:SetRange(LOCATION_MZONE)
      e1:SetCondition(function(e,tp) return e:GetHandler():IsControler(tp) end)
      e1:SetValue(aux.tgoval)
      c:RegisterEffect(e1)
      local e2=Effect.CreateEffect(c)
      e2:SetType(EFFECT_TYPE_SINGLE)
      e2:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e2:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e2:SetRange(LOCATION_MZONE)
      e2:SetCondition(function(e,tp)
        local c=e:GetHandler()
        return c:IsControler(tp)
      end)
      e2:SetValue(aux.tgoval)
      c:RegisterEffect(e2)
      local e3=Effect.CreateEffect(c)
      e3:SetType(EFFECT_TYPE_SINGLE)
      e3:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e3:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e3:SetRange(LOCATION_MZONE)
      e3:SetCondition(function(e,tp) return e:GetHandler():GetControler()==tp end)
      e3:SetValue(aux.tgoval)
      c:RegisterEffect(e3)
      `,
      "source-controller-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects.filter((effect) => effect.code === 71)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ luaConditionDescriptor: "condition:source-controller" }),
        expect.objectContaining({ luaConditionDescriptor: "condition:source-controller" }),
        expect.objectContaining({ luaConditionDescriptor: "condition:source-controller" }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredSource = restored.session.state.cards.find((card) => card.code === sourceCode);
    const effects = restored.session.state.effects.filter((effect) => effect.sourceUid === source!.uid && effect.code === 71 && effect.luaConditionDescriptor === "condition:source-controller");
    expect(effects).toHaveLength(3);
    const ctx = targetContext(restored.session.state, restoredSource!);
    expect(effects.every((effect) => effect.canActivate?.(ctx) === true)).toBe(true);
    restoredSource!.controller = 1;
    expect(effects.every((effect) => effect.canActivate?.(ctx) === false)).toBe(true);
    expect(effects.some((effect) => effect.canActivate?.(ctx) === true)).toBe(false);
  });
});
