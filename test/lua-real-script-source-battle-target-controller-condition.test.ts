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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script source battle target controller condition", () => {
  it("restores source battle target opponent controller checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const puppyCode = "20003027";
    const targetCode = "72329844";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => [puppyCode, targetCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8220, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [puppyCode], extra: [targetCode] }, 1: { main: [] } });
    startDuel(session);

    const puppy = session.state.cards.find((card) => card.code === puppyCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(puppy).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, puppy!.uid, "monsterZone", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(puppyCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(
      session.state.effects.filter(
        (effect) =>
          effect.luaConditionDescriptor === "condition:source-battle-target-opponent" && effect.sourceUid === puppy!.uid,
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "category": 520,
          "code": 1131,
          "controller": 0,
          "cost": [Function],
          "countLimit": 1,
          "countLimitCode": 20003027,
          "description": 320048432,
          "event": "trigger",
          "id": "lua-3-1131",
          "luaConditionDescriptor": "condition:source-battle-target-opponent",
          "luaTypeFlags": 129,
          "oncePerTurn": true,
          "operation": [Function],
          "optional": true,
          "promptOperation": [Function],
          "property": 65536,
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:20003027:lua-3-1131",
          "sourceUid": "p0-deck-20003027-0",
          "target": [Function],
          "targetCardPredicate": [Function],
          "triggerCode": 1131,
          "triggerEvent": "battleTargeted",
          "triggerSourceOnly": true,
          "triggerTiming": "if",
        },
      ]
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const restoredPuppy = restored.session.state.cards.find((card) => card.code === puppyCode);
    const restoredTarget = restored.session.state.cards.find((card) => card.code === targetCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === puppy!.uid && candidate.luaConditionDescriptor === "condition:source-battle-target-opponent");
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredPuppy!);
    expect(effect!.canActivate!(ctx)).toBe(false);
    restored.session.state.currentAttack = { attackerUid: restoredTarget!.uid, targetUid: restoredPuppy!.uid };
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredTarget!.controller = restoredPuppy!.controller;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restored.session.state.currentAttack = { attackerUid: restoredTarget!.uid };
    expect(effect!.canActivate!(ctx)).toBe(false);
  });

  it("restores local battle target opponent controller checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sigmaCode = "42632209";
    const targetCode = "72329844";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => [sigmaCode, targetCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8242, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [targetCode], extra: [sigmaCode] }, 1: { main: [] } });
    startDuel(session);

    const sigma = session.state.cards.find((card) => card.code === sigmaCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(sigma).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, sigma!.uid, "monsterZone", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(sigmaCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(
      session.state.effects.filter(
        (effect) =>
          effect.luaConditionDescriptor === "condition:source-battle-target-opponent" && effect.sourceUid === sigma!.uid,
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "battleDamageValue": [Function],
          "canActivate": [Function],
          "code": 208,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-3-208",
          "lifePointValue": [Function],
          "luaConditionDescriptor": "condition:source-battle-target-opponent",
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "property": 131072,
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:42632209:lua-3-208",
          "sourceUid": "p0-extraDeck-42632209-0",
          "statValue": [Function],
          "target": [Function],
          "valueCardPredicate": [Function],
          "valuePredicate": [Function],
        },
      ]
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const restoredSigma = restored.session.state.cards.find((card) => card.code === sigmaCode);
    const restoredTarget = restored.session.state.cards.find((card) => card.code === targetCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === sigma!.uid && candidate.luaConditionDescriptor === "condition:source-battle-target-opponent");
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredSigma!);
    expect(effect!.canActivate!(ctx)).toBe(false);
    restored.session.state.currentAttack = { attackerUid: restoredSigma!.uid, targetUid: restoredTarget!.uid };
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredTarget!.controller = restoredSigma!.controller;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restored.session.state.currentAttack = { attackerUid: restoredSigma!.uid };
    expect(effect!.canActivate!(ctx)).toBe(false);
  });

  it("restores local source battle target opponent controller checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sigmaCode = "42632209";
    const targetCode = "72329844";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => [sigmaCode, targetCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8243, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [targetCode], extra: [sigmaCode] }, 1: { main: [] } });
    startDuel(session);

    const sigma = session.state.cards.find((card) => card.code === sigmaCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(sigma).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, sigma!.uid, "monsterZone", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${sigmaCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetCode(EFFECT_UPDATE_ATTACK)
      e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
        local c=e:GetHandler()
        return c:GetBattleTarget():IsControler(1-tp)
      end)
      e:SetValue(300)
      c:RegisterEffect(e)
      `,
      "sigma-official-local-source-battle-target-opponent-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(
      session.state.effects.filter(
        (effect) =>
          effect.luaConditionDescriptor === "condition:source-battle-target-opponent" && effect.sourceUid === sigma!.uid,
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
          "luaConditionDescriptor": "condition:source-battle-target-opponent",
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:42632209:lua-1-100",
          "sourceUid": "p0-extraDeck-42632209-0",
          "target": [Function],
          "value": 300,
        },
      ]
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const restoredSigma = restored.session.state.cards.find((card) => card.code === sigmaCode);
    const restoredTarget = restored.session.state.cards.find((card) => card.code === targetCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === sigma!.uid && candidate.luaConditionDescriptor === "condition:source-battle-target-opponent");
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredSigma!);
    expect(effect!.canActivate!(ctx)).toBe(false);
    restored.session.state.currentAttack = { attackerUid: restoredSigma!.uid, targetUid: restoredTarget!.uid };
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredTarget!.controller = restoredSigma!.controller;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restored.session.state.currentAttack = { attackerUid: restoredSigma!.uid };
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});
