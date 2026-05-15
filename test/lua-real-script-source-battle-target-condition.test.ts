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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script source battle target condition", () => {
  it("restores comma-local source GetBattleTarget existence checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const basiliskCode = "56921677";
    const targetCode = "72329844";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => [basiliskCode, targetCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8221, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [basiliskCode], extra: [targetCode] }, 1: { main: [] } });
    startDuel(session);

    const basilisk = session.state.cards.find((card) => card.code === basiliskCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(basilisk).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, basilisk!.uid, "monsterZone", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${basiliskCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetCode(EFFECT_UPDATE_ATTACK)
      e:SetCondition(function(e)
        local c,tp=e:GetHandler(),e:GetHandlerPlayer()
        return c:GetBattleTarget()~=nil
      end)
      e:SetValue(300)
      c:RegisterEffect(e)
      `,
      "basilisk-comma-local-battle-target-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const descriptor = "condition:source-battle-target";
    expect(session.state.effects.find((effect) => effect.luaConditionDescriptor === descriptor && effect.sourceUid === basilisk!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 100,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-1-100",
        "luaConditionDescriptor": "condition:source-battle-target",
        "luaTypeFlags": 1,
        "oncePerTurn": false,
        "operation": [Function],
        "promptOperation": [Function],
        "range": [
          "monsterZone",
        ],
        "registryKey": "lua:56921677:lua-1-100",
        "sourceUid": "p0-deck-56921677-0",
        "target": [Function],
        "value": 300,
      }
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const restoredBasilisk = restored.session.state.cards.find((card) => card.code === basiliskCode);
    const restoredTarget = restored.session.state.cards.find((card) => card.code === targetCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === basilisk!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect).toMatchObject({ value: 300 });
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredBasilisk!);
    expect(effect!.canActivate!(ctx)).toBe(false);
    restored.session.state.currentAttack = { attackerUid: restoredBasilisk!.uid, targetUid: restoredTarget!.uid };
    expect(effect!.canActivate!(ctx)).toBe(true);
    restored.session.state.currentAttack = { attackerUid: restoredBasilisk!.uid };
    expect(effect!.canActivate!(ctx)).toBe(false);
  });

  it("restores source GetBattleTarget existence checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const basiliskCode = "56921677";
    const targetCode = "72329844";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => [basiliskCode, targetCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8219, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [basiliskCode], extra: [targetCode] }, 1: { main: [] } });
    startDuel(session);

    const basilisk = session.state.cards.find((card) => card.code === basiliskCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(basilisk).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, basilisk!.uid, "monsterZone", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(basiliskCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.luaConditionDescriptor === "condition:source-battle-target" && effect.sourceUid === basilisk!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "category": 1,
        "code": 1138,
        "controller": 0,
        "cost": [Function],
        "description": 910746832,
        "event": "trigger",
        "id": "lua-1-1138",
        "luaConditionDescriptor": "condition:source-battle-target",
        "luaTypeFlags": 513,
        "oncePerTurn": false,
        "operation": [Function],
        "optional": false,
        "promptOperation": [Function],
        "range": [
          "deck",
          "hand",
          "monsterZone",
          "spellTrapZone",
          "graveyard",
          "banished",
          "extraDeck",
          "overlay",
        ],
        "registryKey": "lua:56921677:lua-1-1138",
        "sourceUid": "p0-deck-56921677-0",
        "target": [Function],
        "targetCardPredicate": [Function],
        "triggerCode": 1138,
        "triggerEvent": "afterDamageCalculation",
        "triggerSourceOnly": true,
        "triggerTiming": "when",
      }
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const restoredBasilisk = restored.session.state.cards.find((card) => card.code === basiliskCode);
    const restoredTarget = restored.session.state.cards.find((card) => card.code === targetCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === basilisk!.uid && candidate.luaConditionDescriptor === "condition:source-battle-target");
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredBasilisk!);
    expect(effect!.canActivate!(ctx)).toBe(false);
    restored.session.state.currentAttack = { attackerUid: restoredBasilisk!.uid, targetUid: restoredTarget!.uid };
    restored.session.state.pendingBattle = { attackerUid: restoredBasilisk!.uid, targetUid: restoredTarget!.uid };
    expect(effect!.canActivate!(ctx)).toBe(true);
    restored.session.state.currentAttack = { attackerUid: restoredBasilisk!.uid };
    restored.session.state.pendingBattle = { attackerUid: restoredBasilisk!.uid };
    expect(effect!.canActivate!(ctx)).toBe(false);
  });

  it("restores local source GetBattleTarget existence checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const basiliskCode = "56921677";
    const targetCode = "72329844";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => [basiliskCode, targetCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8220, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [basiliskCode], extra: [targetCode] }, 1: { main: [] } });
    startDuel(session);

    const basilisk = session.state.cards.find((card) => card.code === basiliskCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(basilisk).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, basilisk!.uid, "monsterZone", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${basiliskCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetCode(EFFECT_UPDATE_ATTACK)
      e:SetCondition(function(e)
        local c=e:GetHandler()
        return c:GetBattleTarget()
      end)
      e:SetValue(300)
      c:RegisterEffect(e)
      `,
      "basilisk-official-local-battle-target-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects.find((effect) => effect.luaConditionDescriptor === "condition:source-battle-target" && effect.sourceUid === basilisk!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 100,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-1-100",
        "luaConditionDescriptor": "condition:source-battle-target",
        "luaTypeFlags": 1,
        "oncePerTurn": false,
        "operation": [Function],
        "promptOperation": [Function],
        "range": [
          "monsterZone",
        ],
        "registryKey": "lua:56921677:lua-1-100",
        "sourceUid": "p0-deck-56921677-0",
        "target": [Function],
        "value": 300,
      }
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const restoredBasilisk = restored.session.state.cards.find((card) => card.code === basiliskCode);
    const restoredTarget = restored.session.state.cards.find((card) => card.code === targetCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === basilisk!.uid && candidate.luaConditionDescriptor === "condition:source-battle-target");
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredBasilisk!);
    expect(effect!.canActivate!(ctx)).toBe(false);
    restored.session.state.currentAttack = { attackerUid: restoredBasilisk!.uid, targetUid: restoredTarget!.uid };
    expect(effect!.canActivate!(ctx)).toBe(true);
    restored.session.state.currentAttack = { attackerUid: restoredBasilisk!.uid };
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});
