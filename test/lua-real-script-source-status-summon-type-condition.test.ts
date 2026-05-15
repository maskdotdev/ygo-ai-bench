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
const statusSpecialSummonTurn = 0x40000000;
const summonTypeLink = 0x4c000000;

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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script source status and summon type condition", () => {
  it("restores comma-local handler IsStatus plus summon type checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sprindCode = "72329844";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sprindCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7542, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { extra: [sprindCode], main: [] }, 1: { main: [] } });
    startDuel(session);

    const sprind = session.state.cards.find((card) => card.code === sprindCode);
    expect(sprind).toBeDefined();
    moveDuelCard(session.state, sprind!.uid, "monsterZone", 0);
    sprind!.summonType = "link";
    sprind!.customStatusMask = statusSpecialSummonTurn;

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${sprindCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_UPDATE_ATTACK)
      e:SetRange(LOCATION_MZONE)
      e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
        local c,tp=e:GetHandler(),e:GetHandlerPlayer()
        return c:IsStatus(STATUS_SPSUMMON_TURN) and c:IsLinkSummoned()
      end)
      e:SetValue(300)
      c:RegisterEffect(e)
      `,
      "sprind-comma-local-status-link-summon-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: `condition:source-status-summon-type:${statusSpecialSummonTurn}:${summonTypeLink}`,
          sourceUid: sprind!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const restoredSprind = restored.session.state.cards.find((card) => card.code === sprindCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === sprind!.uid && candidate.luaConditionDescriptor === `condition:source-status-summon-type:${statusSpecialSummonTurn}:${summonTypeLink}`);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredSprind!);
    restoredSprind!.summonType = "link";
    restoredSprind!.customStatusMask = statusSpecialSummonTurn;
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredSprind!.summonType = "xyz";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredSprind!.summonType = "link";
    restoredSprind!.customStatusMask = 0;
    expect(effect!.canActivate!(ctx)).toBe(true);
    delete restoredSprind!.summonType;
    restoredSprind!.customStatusMask = statusSpecialSummonTurn;
    expect(effect!.canActivate!(ctx)).toBe(false);
  });

  it("restores local handler IsStatus plus summon type checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sprindCode = "72329844";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sprindCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7541, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { extra: [sprindCode], main: [] }, 1: { main: [] } });
    startDuel(session);

    const sprind = session.state.cards.find((card) => card.code === sprindCode);
    expect(sprind).toBeDefined();
    moveDuelCard(session.state, sprind!.uid, "monsterZone", 0);
    sprind!.summonType = "link";

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(sprindCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: `condition:source-status-summon-type:${statusSpecialSummonTurn}:${summonTypeLink}`,
          sourceUid: sprind!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const restoredSprind = restored.session.state.cards.find((card) => card.code === sprindCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === sprind!.uid && candidate.luaConditionDescriptor === `condition:source-status-summon-type:${statusSpecialSummonTurn}:${summonTypeLink}`);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredSprind!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredSprind!.summonType = "xyz";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredSprind!.summonType = "link";
    delete restoredSprind!.customStatusMask;
    expect(effect!.canActivate!(ctx)).toBe(true);
    delete restoredSprind!.summonType;
    restoredSprind!.customStatusMask = statusSpecialSummonTurn;
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});
