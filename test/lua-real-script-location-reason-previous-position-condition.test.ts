import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelCardInstance, DuelEffectContext } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const positionFaceUp = 0x5;
const locationGraveyard = 0x10;

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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script location reason previous position condition", () => {
  it("restores comma-local current-location battle-reason previous-position checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const poisonCloudCode = "83982270";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === poisonCloudCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8246, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [poisonCloudCode] }, 1: { main: [] } });
    startDuel(session);

    const poisonCloud = session.state.cards.find((card) => card.code === poisonCloudCode);
    expect(poisonCloud).toBeDefined();
    moveDuelCard(session.state, poisonCloud!.uid, "monsterZone", 0);
    poisonCloud!.position = "faceUpDefense";
    moveDuelCard(session.state, poisonCloud!.uid, "graveyard", 0, duelReason.battle, 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${poisonCloudCode}),0,LOCATION_GRAVE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_GRAVE)
      e:SetCondition(function(e)
        local c,tp=e:GetHandler(),e:GetHandlerPlayer()
        return c:IsLocation(LOCATION_GRAVE) and c:IsReason(REASON_BATTLE) and c:IsPreviousPosition(POS_FACEUP)
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "poison-cloud-comma-local-location-reason-previous-position-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const descriptor = `condition:source-previous-position-location-reason:${positionFaceUp}:${locationGraveyard}:${duelReason.battle}`;
    expect(session.state.effects.find((effect) => effect.luaConditionDescriptor === descriptor && effect.sourceUid === poisonCloud!.uid)).toMatchInlineSnapshot(`
      {
        "battleDamageValue": [Function],
        "canActivate": [Function],
        "code": 71,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-1-71",
        "lifePointValue": [Function],
        "luaConditionDescriptor": "condition:source-previous-position-location-reason:5:16:32",
        "luaTypeFlags": 1,
        "luaValueDescriptor": "cannot-be-effect-target:opponent",
        "oncePerTurn": false,
        "operation": [Function],
        "promptOperation": [Function],
        "property": 131072,
        "range": [
          "graveyard",
        ],
        "registryKey": "lua:83982270:lua-1-71",
        "sourceUid": "p0-deck-83982270-0",
        "statValue": [Function],
        "target": [Function],
        "valueCardPredicate": [Function],
        "valuePredicate": [Function],
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
    const restoredPoisonCloud = restored.session.state.cards.find((card) => card.code === poisonCloudCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === poisonCloud!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredPoisonCloud!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredPoisonCloud!.previousPosition = "faceDownDefense";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredPoisonCloud!.previousPosition = "faceUpAttack";
    restoredPoisonCloud!.reason = duelReason.effect;
    expect(effect!.canActivate!(ctx)).toBe(false);
  });

  it("restores current-location battle-reason previous-position checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const poisonCloudCode = "83982270";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === poisonCloudCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8248, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [poisonCloudCode] }, 1: { main: [] } });
    startDuel(session);

    const poisonCloud = session.state.cards.find((card) => card.code === poisonCloudCode);
    expect(poisonCloud).toBeDefined();
    moveDuelCard(session.state, poisonCloud!.uid, "monsterZone", 0);
    poisonCloud!.position = "faceUpDefense";
    moveDuelCard(session.state, poisonCloud!.uid, "graveyard", 0, duelReason.battle, 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(poisonCloudCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.luaConditionDescriptor === `condition:source-previous-position-location-reason:${positionFaceUp}:${locationGraveyard}:${duelReason.battle}` && effect.sourceUid === poisonCloud!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "category": 524289,
        "code": 1140,
        "controller": 0,
        "cost": [Function],
        "description": 1343716320,
        "event": "trigger",
        "id": "lua-1-1140",
        "luaConditionDescriptor": "condition:source-previous-position-location-reason:5:16:32",
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
        "registryKey": "lua:83982270:lua-1-1140",
        "sourceUid": "p0-deck-83982270-0",
        "target": [Function],
        "targetCardPredicate": [Function],
        "triggerCode": 1140,
        "triggerEvent": "battleDestroyed",
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
    const restoredPoisonCloud = restored.session.state.cards.find((card) => card.code === poisonCloudCode);
    const descriptor = `condition:source-previous-position-location-reason:${positionFaceUp}:${locationGraveyard}:${duelReason.battle}`;
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === poisonCloud!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredPoisonCloud!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredPoisonCloud!.previousPosition = "faceDownDefense";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredPoisonCloud!.previousPosition = "faceUpAttack";
    restoredPoisonCloud!.reason = duelReason.effect;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredPoisonCloud!.reason = duelReason.battle;
    restoredPoisonCloud!.location = "monsterZone";
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});
