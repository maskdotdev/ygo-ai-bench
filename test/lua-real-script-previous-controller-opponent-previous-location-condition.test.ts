import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelCardInstance, DuelEffectContext, PlayerId } from "#duel/types.js";
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script previous controller opponent previous location condition", () => {
  it("restores comma-local opponent previous-controller previous-location checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const veidosCode = "78783557";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === veidosCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7879, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [veidosCode] }, 1: { main: [] } });
    startDuel(session);

    const veidos = session.state.cards.find((card) => card.code === veidosCode);
    expect(veidos).toBeDefined();
    moveDuelCard(session.state, veidos!.uid, "monsterZone", 1);
    moveDuelCard(session.state, veidos!.uid, "graveyard", 0);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${veidosCode}),0,LOCATION_GRAVE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetCondition(function(e)
        local c,tp=e:GetHandler(),e:GetHandlerPlayer()
        return c:IsPreviousLocation(LOCATION_ONFIELD) and c:IsPreviousControler(1-tp)
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "veidos-comma-local-opponent-previous-controller-location-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    const descriptor = `condition:source-previous-controller-side-previous-location:${locationOnField}:opponent`;
    expect(session.state.effects.find((effect) => effect.luaConditionDescriptor === descriptor && effect.sourceUid === veidos!.uid)).toMatchInlineSnapshot(`
      {
        "battleDamageValue": [Function],
        "canActivate": [Function],
        "code": 71,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-1-71",
        "lifePointValue": [Function],
        "luaConditionDescriptor": "condition:source-previous-controller-side-previous-location:12:opponent",
        "luaTypeFlags": 1,
        "luaValueDescriptor": "cannot-be-effect-target:opponent",
        "oncePerTurn": false,
        "operation": [Function],
        "promptOperation": [Function],
        "range": [
          "graveyard",
        ],
        "registryKey": "lua:78783557:lua-1-71",
        "sourceUid": "p0-deck-78783557-0",
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
    expectRestoredLegalActions(restored, 0);
    const restoredVeidos = restored.session.state.cards.find((card) => card.code === veidosCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === veidos!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect).toMatchObject({ luaValueDescriptor: "cannot-be-effect-target:opponent" });
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredVeidos!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredVeidos!.previousLocation = "spellTrapZone";
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredVeidos!.previousLocation = "deck";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredVeidos!.previousLocation = "monsterZone";
    restoredVeidos!.previousController = 0;
    expect(effect!.canActivate!(ctx)).toBe(false);
  });

  it("restores opponent previous-controller previous-location checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const veidosCode = "78783557";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === veidosCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7878, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [veidosCode] }, 1: { main: [] } });
    startDuel(session);

    const veidos = session.state.cards.find((card) => card.code === veidosCode);
    expect(veidos).toBeDefined();
    moveDuelCard(session.state, veidos!.uid, "monsterZone", 1);
    moveDuelCard(session.state, veidos!.uid, "graveyard", 0);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(veidosCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const descriptor = `condition:source-previous-controller-side-previous-location:${locationOnField}:opponent`;
    expect(session.state.effects.find((effect) => effect.luaConditionDescriptor === descriptor && effect.sourceUid === veidos!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "category": 1,
        "code": 1014,
        "controller": 0,
        "cost": [Function],
        "countLimit": 1,
        "countLimitCode": 322697449488,
        "description": 1260536913,
        "event": "trigger",
        "id": "lua-2-1014",
        "luaConditionDescriptor": "condition:source-previous-controller-side-previous-location:12:opponent",
        "luaTypeFlags": 129,
        "oncePerTurn": true,
        "operation": [Function],
        "optional": true,
        "promptOperation": [Function],
        "property": 65536,
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
        "registryKey": "lua:78783557:lua-2-1014",
        "sourceUid": "p0-deck-78783557-0",
        "target": [Function],
        "targetCardPredicate": [Function],
        "triggerCode": 1014,
        "triggerEvent": "sentToGraveyard",
        "triggerSourceOnly": true,
        "triggerTiming": "if",
      }
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 0);
    const restoredVeidos = restored.session.state.cards.find((card) => card.code === veidosCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === veidos!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredVeidos!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredVeidos!.previousController = 0;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredVeidos!.previousController = 1;
    restoredVeidos!.previousLocation = "deck";
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(
    getLuaRestoreLegalActions(restored, player),
  );
}
