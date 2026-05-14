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
const statusSpecialSummonTurn = 0x40000000;

function targetContext(duel: DuelEffectContext["duel"], source: DuelCardInstance): DuelEffectContext {
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script source status condition", () => {
  it("restores comma-local source IsStatus checks from serialized summon status", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const houndCode = "54919528";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === houndCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7320, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { extra: [houndCode], main: [] }, 1: { main: [] } });
    startDuel(session);

    const hound = session.state.cards.find((card) => card.code === houndCode);
    expect(hound).toBeDefined();
    moveDuelCard(session.state, hound!.uid, "monsterZone", 0);
    hound!.summonType = "xyz";

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${houndCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_MZONE)
      e:SetCondition(function(e)
        local c,tp=e:GetHandler(),e:GetHandlerPlayer()
        return c:IsStatus(STATUS_SPSUMMON_TURN)
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "hound-comma-local-source-status-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const descriptor = `condition:source-status:${statusSpecialSummonTurn}`;
    expect(session.state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ luaConditionDescriptor: descriptor, sourceUid: hound!.uid })]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredHound = restored.session.state.cards.find((card) => card.code === houndCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === hound!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredHound!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredHound!.summonType = "normal";
    expect(effect!.canActivate!(ctx)).toBe(false);
    delete restoredHound!.summonType;
    restoredHound!.customStatusMask = statusSpecialSummonTurn;
    expect(effect!.canActivate!(ctx)).toBe(true);
  });

  it("restores local source IsStatus checks from serialized summon status", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const houndCode = "54919528";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === houndCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7319, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { extra: [houndCode], main: [] }, 1: { main: [] } });
    startDuel(session);

    const hound = session.state.cards.find((card) => card.code === houndCode);
    expect(hound).toBeDefined();
    moveDuelCard(session.state, hound!.uid, "monsterZone", 0);
    hound!.summonType = "xyz";

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${houndCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_MZONE)
      e:SetCondition(function(e)
        local c=e:GetHandler()
        return c:IsStatus(STATUS_SPSUMMON_TURN)
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "hound-official-local-source-status-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: `condition:source-status:${statusSpecialSummonTurn}`,
          sourceUid: hound!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredHound = restored.session.state.cards.find((card) => card.code === houndCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === hound!.uid && candidate.luaConditionDescriptor === `condition:source-status:${statusSpecialSummonTurn}`);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredHound!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredHound!.summonType = "normal";
    expect(effect!.canActivate!(ctx)).toBe(false);
  });

  it("restores source IsStatus checks from serialized summon status", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const houndCode = "54919528";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === houndCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7318, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { extra: [houndCode], main: [] }, 1: { main: [] } });
    startDuel(session);

    const hound = session.state.cards.find((card) => card.code === houndCode);
    expect(hound).toBeDefined();
    moveDuelCard(session.state, hound!.uid, "monsterZone", 0);
    hound!.summonType = "xyz";

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(houndCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: `condition:source-status:${statusSpecialSummonTurn}`,
          sourceUid: hound!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredHound = restored.session.state.cards.find((card) => card.code === houndCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === hound!.uid && candidate.luaConditionDescriptor === `condition:source-status:${statusSpecialSummonTurn}`);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredHound!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredHound!.summonType = "normal";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredHound!.summonType = "special";
    expect(effect!.canActivate!(ctx)).toBe(true);
    delete restoredHound!.summonType;
    restoredHound!.customStatusMask = statusSpecialSummonTurn;
    expect(effect!.canActivate!(ctx)).toBe(true);
  });
});
