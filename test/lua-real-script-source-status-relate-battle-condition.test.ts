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
const statusOpposingBattle = 0x10000000;

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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script source status relate battle condition", () => {
  it("restores comma-local handler IsStatus plus IsRelateToBattle conditions", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const numeronCode = "42230449";
    const targetCode = "72329844";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => [numeronCode, targetCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8012, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { extra: [numeronCode, targetCode], main: [] }, 1: { main: [] } });
    startDuel(session);

    const numeron = session.state.cards.find((card) => card.code === numeronCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(numeron).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, numeron!.uid, "monsterZone", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${numeronCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetCode(EFFECT_UPDATE_ATTACK)
      e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
        local c,tp=e:GetHandler(),e:GetHandlerPlayer()
        return c:IsStatus(STATUS_OPPO_BATTLE) and c:IsRelateToBattle()
      end)
      e:SetValue(1000)
      c:RegisterEffect(e)
      `,
      "numeron-comma-local-status-relate-battle-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(
      session.state.effects.filter(
        (effect) =>
          effect.luaConditionDescriptor === `condition:source-status-relate-battle:${statusOpposingBattle}` &&
          effect.sourceUid === numeron!.uid,
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "code": 100,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-1-100",
          "luaConditionDescriptor": "condition:source-status-relate-battle:268435456",
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:42230449:lua-1-100",
          "sourceUid": "p0-extraDeck-42230449-0",
          "target": [Function],
          "value": 1000,
        },
      ]
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const restoredNumeron = restored.session.state.cards.find((card) => card.code === numeronCode);
    const restoredTarget = restored.session.state.cards.find((card) => card.code === targetCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === numeron!.uid && candidate.luaConditionDescriptor === `condition:source-status-relate-battle:${statusOpposingBattle}`);
    expect(effect).toMatchObject({ value: 1000 });
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredNumeron!);
    expect(effect!.canActivate!(ctx)).toBe(false);
    restored.session.state.currentAttack = { attackerUid: restoredTarget!.uid, targetUid: restoredNumeron!.uid };
    restored.session.state.pendingBattle = { attackerUid: restoredTarget!.uid, targetUid: restoredNumeron!.uid };
    expect(effect!.canActivate!(ctx)).toBe(true);
    restored.session.state.currentAttack = { attackerUid: restoredTarget!.uid };
    restored.session.state.pendingBattle = { attackerUid: restoredTarget!.uid };
    expect(effect!.canActivate!(ctx)).toBe(false);
  });

  it("restores local handler IsStatus plus IsRelateToBattle conditions", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const numeronCode = "42230449";
    const targetCode = "72329844";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => [numeronCode, targetCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8011, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { extra: [numeronCode, targetCode], main: [] }, 1: { main: [] } });
    startDuel(session);

    const numeron = session.state.cards.find((card) => card.code === numeronCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(numeron).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, numeron!.uid, "monsterZone", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(numeronCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(
      session.state.effects.filter(
        (effect) =>
          effect.luaConditionDescriptor === `condition:source-status-relate-battle:${statusOpposingBattle}` &&
          effect.sourceUid === numeron!.uid,
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "category": 2097152,
          "code": 1141,
          "controller": 0,
          "cost": [Function],
          "description": 675687184,
          "event": "trigger",
          "id": "lua-3-1141",
          "luaConditionDescriptor": "condition:source-status-relate-battle:268435456",
          "luaTypeFlags": 129,
          "oncePerTurn": false,
          "operation": [Function],
          "optional": true,
          "promptOperation": [Function],
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:42230449:lua-3-1141",
          "sourceUid": "p0-extraDeck-42230449-0",
          "target": [Function],
          "targetCardPredicate": [Function],
          "triggerCode": 1141,
          "triggerEvent": "damageStepEnded",
          "triggerSourceOnly": true,
          "triggerTiming": "when",
        },
      ]
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const restoredNumeron = restored.session.state.cards.find((card) => card.code === numeronCode);
    const restoredTarget = restored.session.state.cards.find((card) => card.code === targetCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === numeron!.uid && candidate.luaConditionDescriptor === `condition:source-status-relate-battle:${statusOpposingBattle}`);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredNumeron!);
    expect(effect!.canActivate!(ctx)).toBe(false);
    restored.session.state.currentAttack = { attackerUid: restoredTarget!.uid, targetUid: restoredNumeron!.uid };
    restored.session.state.pendingBattle = { attackerUid: restoredTarget!.uid, targetUid: restoredNumeron!.uid };
    expect(effect!.canActivate!(ctx)).toBe(true);
    restored.session.state.currentAttack = { attackerUid: restoredTarget!.uid };
    restored.session.state.pendingBattle = { attackerUid: restoredTarget!.uid };
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});
