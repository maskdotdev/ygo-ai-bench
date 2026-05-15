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
const locationOnField = 0x0c;

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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script local previous location reason condition", () => {
  it("restores comma-local previous-location reason checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const redDustonCode = "61019812";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === redDustonCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 6119, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [redDustonCode] }, 1: { main: [] } });
    startDuel(session);

    const redDuston = session.state.cards.find((card) => card.code === redDustonCode);
    expect(redDuston).toBeDefined();
    moveDuelCard(session.state, redDuston!.uid, "monsterZone", 0);
    moveDuelCard(session.state, redDuston!.uid, "graveyard", 0, duelReason.destroy, 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${redDustonCode}),0,LOCATION_GRAVE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_GRAVE)
      e:SetCondition(function(e)
        local c,tp=e:GetHandler(),e:GetHandlerPlayer()
        return c:IsPreviousLocation(LOCATION_ONFIELD) and c:IsReason(REASON_DESTROY)
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "red-duston-comma-local-previous-location-reason-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const descriptor = `condition:source-previous-location-reason:${locationOnField}:${duelReason.destroy}`;
    expect(session.state.effects.find((effect) => effect.code === 71 && effect.luaConditionDescriptor === descriptor && effect.sourceUid === redDuston!.uid)).toMatchInlineSnapshot(`
      {
        "battleDamageValue": [Function],
        "canActivate": [Function],
        "code": 71,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-1-71",
        "lifePointValue": [Function],
        "luaConditionDescriptor": "condition:source-previous-location-reason:12:1",
        "luaTypeFlags": 1,
        "luaValueDescriptor": "cannot-be-effect-target:opponent",
        "oncePerTurn": false,
        "operation": [Function],
        "promptOperation": [Function],
        "property": 131072,
        "range": [
          "graveyard",
        ],
        "registryKey": "lua:61019812:lua-1-71",
        "sourceUid": "p0-deck-61019812-0",
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
    const restoredRedDuston = restored.session.state.cards.find((card) => card.code === redDustonCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === redDuston!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredRedDuston!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredRedDuston!.reason = duelReason.effect;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredRedDuston!.reason = duelReason.destroy;
    restoredRedDuston!.previousLocation = "deck";
    expect(effect!.canActivate!(ctx)).toBe(false);
  });

  it("restores local-handler previous-location reason checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const redDustonCode = "61019812";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === redDustonCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 6101, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [redDustonCode] }, 1: { main: [] } });
    startDuel(session);

    const redDuston = session.state.cards.find((card) => card.code === redDustonCode);
    expect(redDuston).toBeDefined();
    moveDuelCard(session.state, redDuston!.uid, "monsterZone", 0);
    moveDuelCard(session.state, redDuston!.uid, "graveyard", 0, duelReason.destroy, 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(redDustonCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const descriptor = `condition:source-previous-location-reason:${locationOnField}:${duelReason.destroy}`;
    expect(session.state.effects.find((effect) => effect.luaConditionDescriptor === descriptor && effect.sourceUid === redDuston!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "category": 524288,
        "code": 1029,
        "controller": 0,
        "cost": [Function],
        "description": 976316992,
        "event": "trigger",
        "id": "lua-4-1029",
        "luaConditionDescriptor": "condition:source-previous-location-reason:12:1",
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
        "registryKey": "lua:61019812:lua-4-1029",
        "sourceUid": "p0-deck-61019812-0",
        "target": [Function],
        "targetCardPredicate": [Function],
        "triggerCode": 1029,
        "triggerEvent": "destroyed",
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
    const restoredRedDuston = restored.session.state.cards.find((card) => card.code === redDustonCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === redDuston!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredRedDuston!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredRedDuston!.reason = duelReason.effect;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredRedDuston!.reason = duelReason.destroy;
    restoredRedDuston!.previousLocation = "deck";
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});
