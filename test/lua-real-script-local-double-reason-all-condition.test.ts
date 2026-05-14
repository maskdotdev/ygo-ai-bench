import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelCardInstance, DuelEffectContext } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const synchroMaterialReason = duelReason.synchro | duelReason.material;

function conditionContext(duel: DuelEffectContext["duel"], source: DuelCardInstance): DuelEffectContext {
  return {
    duel,
    source,
    player: source.controller,
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script local double reason all condition", () => {
  it("restores comma-local dual IsReason checks as all-bit requirements", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const ladyCode = "10736540";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === ladyCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 10732, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ladyCode] }, 1: { main: [] } });
    startDuel(session);

    const lady = session.state.cards.find((card) => card.code === ladyCode);
    expect(lady).toBeDefined();
    moveDuelCard(session.state, lady!.uid, "monsterZone", 0);
    lady!.reason = synchroMaterialReason;

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${ladyCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_MZONE)
      e:SetCondition(function(e)
        local c,tp=e:GetHandler(),e:GetHandlerPlayer()
        return c:IsReason(REASON_MATERIAL) and c:IsReason(REASON_SYNCHRO)
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "lady-comma-local-double-reason-all-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const descriptor = `condition:source-reason-all:${synchroMaterialReason}`;
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 71,
          luaConditionDescriptor: descriptor,
          luaValueDescriptor: "cannot-be-effect-target:opponent",
          range: ["monsterZone"],
          sourceUid: lady!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredLady = restored.session.state.cards.find((card) => card.code === ladyCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === lady!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = conditionContext(restored.session.state, restoredLady!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredLady!.reason = duelReason.synchro;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredLady!.reason = duelReason.material;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredLady!.reason = synchroMaterialReason | duelReason.effect;
    expect(effect!.canActivate!(ctx)).toBe(true);
  });

  it("restores direct-handler dual IsReason checks as all-bit requirements", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const ladyCode = "10736540";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === ladyCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 10731, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ladyCode] }, 1: { main: [] } });
    startDuel(session);

    const lady = session.state.cards.find((card) => card.code === ladyCode);
    expect(lady).toBeDefined();
    moveDuelCard(session.state, lady!.uid, "monsterZone", 0);
    lady!.reason = synchroMaterialReason;

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${ladyCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_MZONE)
      e:SetCondition(function(e) return e:GetHandler():IsReason(REASON_MATERIAL) and e:GetHandler():IsReason(REASON_SYNCHRO) end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "lady-direct-double-reason-all-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const descriptor = `condition:source-reason-all:${synchroMaterialReason}`;
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 71,
          luaConditionDescriptor: descriptor,
          luaValueDescriptor: "cannot-be-effect-target:opponent",
          range: ["monsterZone"],
          sourceUid: lady!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredLady = restored.session.state.cards.find((card) => card.code === ladyCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === lady!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = conditionContext(restored.session.state, restoredLady!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredLady!.reason = duelReason.synchro;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredLady!.reason = duelReason.material;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredLady!.reason = synchroMaterialReason | duelReason.effect;
    expect(effect!.canActivate!(ctx)).toBe(true);
  });

  it("restores local-handler dual IsReason checks as all-bit requirements", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const ladyCode = "10736540";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === ladyCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1073, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ladyCode] }, 1: { main: [] } });
    startDuel(session);

    const lady = session.state.cards.find((card) => card.code === ladyCode);
    expect(lady).toBeDefined();
    moveDuelCard(session.state, lady!.uid, "monsterZone", 0);
    lady!.reason = synchroMaterialReason;

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(ladyCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const descriptor = `condition:source-reason-all:${synchroMaterialReason}`;
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: descriptor,
          sourceUid: lady!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredLady = restored.session.state.cards.find((card) => card.code === ladyCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === lady!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = conditionContext(restored.session.state, restoredLady!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredLady!.reason = duelReason.synchro;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredLady!.reason = duelReason.material;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredLady!.reason = synchroMaterialReason | duelReason.effect;
    expect(effect!.canActivate!(ctx)).toBe(true);
  });
});
