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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script source previous position condition", () => {
  it("restores source previous-position checks from official face-up masks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const shoreKnightCode = "14771222";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === shoreKnightCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1477, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [shoreKnightCode] }, 1: { main: [] } });
    startDuel(session);

    const shoreKnight = session.state.cards.find((card) => card.code === shoreKnightCode);
    expect(shoreKnight).toBeDefined();
    moveDuelCard(session.state, shoreKnight!.uid, "monsterZone", 0);
    shoreKnight!.faceUp = true;
    shoreKnight!.position = "faceUpAttack";
    shoreKnight!.previousPosition = "faceUpDefense";

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${shoreKnightCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_MZONE)
      e:SetCondition(function(e) return e:GetHandler():IsPreviousPosition(POS_FACEUP) end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "shore-knight-official-previous-position-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(
      session.state.effects.filter(
        (effect) => effect.code === 71 && effect.luaConditionDescriptor === "condition:source-previous-position:5",
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "battleDamageValue": [Function],
          "canActivate": [Function],
          "code": 71,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-1-71",
          "lifePointValue": [Function],
          "luaConditionDescriptor": "condition:source-previous-position:5",
          "luaTypeFlags": 1,
          "luaValueDescriptor": "cannot-be-effect-target:opponent",
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "property": 131072,
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:14771222:lua-1-71",
          "sourceUid": "p0-deck-14771222-0",
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
    const restoredShoreKnight = restored.session.state.cards.find((card) => card.code === shoreKnightCode);
    const restoredEffect = restored.session.state.effects.find((effect) => effect.sourceUid === shoreKnight!.uid && effect.code === 71);
    expect(restoredShoreKnight).toBeDefined();
    expect(restoredEffect).toMatchObject({
      code: 71,
      luaConditionDescriptor: "condition:source-previous-position:5",
      luaValueDescriptor: "cannot-be-effect-target:opponent",
      range: ["monsterZone"],
    });
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredShoreKnight!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredShoreKnight!.previousPosition = "faceUpAttack";
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredShoreKnight!.previousPosition = "faceDownDefense";
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    delete restoredShoreKnight!.previousPosition;
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });

  it("restores local source previous-position checks from official face-up masks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const ranvierCode = "10698416";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === ranvierCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1069, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ranvierCode] }, 1: { main: [] } });
    startDuel(session);

    const ranvier = session.state.cards.find((card) => card.code === ranvierCode);
    expect(ranvier).toBeDefined();
    moveDuelCard(session.state, ranvier!.uid, "monsterZone", 0);
    ranvier!.faceUp = true;
    ranvier!.position = "faceUpAttack";
    ranvier!.previousPosition = "faceUpDefense";

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${ranvierCode}),0,LOCATION_MZONE,0,nil)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e:SetRange(LOCATION_MZONE)
      e:SetCondition(function(e)
        local c=e:GetHandler()
        return c:IsPreviousPosition(POS_FACEUP)
      end)
      e:SetValue(aux.tgoval)
      c:RegisterEffect(e)
      `,
      "ranvier-official-local-previous-position-condition.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(
      session.state.effects.filter(
        (effect) => effect.code === 71 && effect.luaConditionDescriptor === "condition:source-previous-position:5",
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "battleDamageValue": [Function],
          "canActivate": [Function],
          "code": 71,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-1-71",
          "lifePointValue": [Function],
          "luaConditionDescriptor": "condition:source-previous-position:5",
          "luaTypeFlags": 1,
          "luaValueDescriptor": "cannot-be-effect-target:opponent",
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "property": 131072,
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:10698416:lua-1-71",
          "sourceUid": "p0-deck-10698416-0",
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
    const restoredRanvier = restored.session.state.cards.find((card) => card.code === ranvierCode);
    const restoredEffect = restored.session.state.effects.find((effect) => effect.sourceUid === ranvier!.uid && effect.code === 71);
    expect(restoredEffect).toMatchObject({ luaConditionDescriptor: "condition:source-previous-position:5" });
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredRanvier!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);
    restoredRanvier!.previousPosition = "faceDownDefense";
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
  });
});
