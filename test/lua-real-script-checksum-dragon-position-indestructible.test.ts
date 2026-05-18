import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelCardInstance, DuelEffectContext } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasChecksumDragonScript = fs.existsSync(path.join(upstreamRoot, "script", "official", "c94136469.lua"));
const typeMonster = 0x1;
const typeEffect = 0x20;

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

describe.skipIf(!hasUpstreamScripts || !hasChecksumDragonScript)("Lua real script Checksum Dragon position indestructible", () => {
  it("restores comma-local Attack Position and Defense Position predicates", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const checksumDragonCode = "94136469";
    const cards = checksumDragonCards(checksumDragonCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 943, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [checksumDragonCode] }, 1: { main: [] } });
    startDuel(session);

    const checksumDragon = session.state.cards.find((card) => card.code === checksumDragonCode);
    expect(checksumDragon).toBeDefined();
    moveDuelCard(session.state, checksumDragon!.uid, "monsterZone", 0);
    checksumDragon!.faceUp = true;
    checksumDragon!.position = "faceUpAttack";

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${checksumDragonCode}),0,LOCATION_MZONE,0,nil)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_SINGLE)
      e1:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e1:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e1:SetRange(LOCATION_MZONE)
      e1:SetCondition(function(e)
        local c,tp=e:GetHandler(),e:GetHandlerPlayer()
        return c:IsAttackPos()
      end)
      e1:SetValue(aux.tgoval)
      c:RegisterEffect(e1)
      local e2=Effect.CreateEffect(c)
      e2:SetType(EFFECT_TYPE_SINGLE)
      e2:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e2:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e2:SetRange(LOCATION_MZONE)
      e2:SetCondition(function(e)
        local c,tp=e:GetHandler(),e:GetHandlerPlayer()
        return c:IsDefensePos()
      end)
      e2:SetValue(aux.tgoval)
      c:RegisterEffect(e2)
      `,
      "checksum-dragon-official-comma-local-position-indestructible.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects.filter((effect) => effect.event === "continuous" && effect.code === 71)).toMatchInlineSnapshot(`
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
          "luaConditionDescriptor": "condition:source-attack-position",
          "luaTypeFlags": 1,
          "luaValueDescriptor": "cannot-be-effect-target:opponent",
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "property": 131072,
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:94136469:lua-1-71",
          "sourceUid": "p0-deck-94136469-0",
          "statValue": [Function],
          "target": [Function],
          "valueCardPredicate": [Function],
          "valuePredicate": [Function],
        },
        {
          "battleDamageValue": [Function],
          "canActivate": [Function],
          "code": 71,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-2-71",
          "lifePointValue": [Function],
          "luaConditionDescriptor": "condition:source-defense-position",
          "luaTypeFlags": 1,
          "luaValueDescriptor": "cannot-be-effect-target:opponent",
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "property": 131072,
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:94136469:lua-2-71",
          "sourceUid": "p0-deck-94136469-0",
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
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const restoredDragon = restored.session.state.cards.find((card) => card.code === checksumDragonCode);
    const attackEffect = restored.session.state.effects.find((effect) => effect.sourceUid === checksumDragon!.uid && effect.code === 71 && effect.luaConditionDescriptor === "condition:source-attack-position");
    const defenseEffect = restored.session.state.effects.find((effect) => effect.sourceUid === checksumDragon!.uid && effect.code === 71 && effect.luaConditionDescriptor === "condition:source-defense-position");
    expect(attackEffect).toMatchObject({ property: 0x20000 });
    expect(defenseEffect).toMatchObject({ property: 0x20000 });
    expect(attackEffect?.canActivate).toBeDefined();
    expect(defenseEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredDragon!);
    expect(attackEffect!.canActivate!(ctx)).toBe(true);
    expect(defenseEffect!.canActivate!(ctx)).toBe(false);
    restoredDragon!.position = "faceUpDefense";
    expect(attackEffect!.canActivate!(ctx)).toBe(false);
    expect(defenseEffect!.canActivate!(ctx)).toBe(true);
    restoredDragon!.position = "faceDownDefense";
    expect(defenseEffect!.canActivate!(ctx)).toBe(true);
  });

  it("restores local-handler Attack Position and Defense Position predicates", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const checksumDragonCode = "94136469";
    const cards = checksumDragonCards(checksumDragonCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 942, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [checksumDragonCode] }, 1: { main: [] } });
    startDuel(session);

    const checksumDragon = session.state.cards.find((card) => card.code === checksumDragonCode);
    expect(checksumDragon).toBeDefined();
    moveDuelCard(session.state, checksumDragon!.uid, "monsterZone", 0);
    checksumDragon!.faceUp = true;
    checksumDragon!.position = "faceUpAttack";

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${checksumDragonCode}),0,LOCATION_MZONE,0,nil)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_SINGLE)
      e1:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e1:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e1:SetRange(LOCATION_MZONE)
      e1:SetCondition(function(e)
        local c=e:GetHandler()
        return c:IsAttackPos()
      end)
      e1:SetValue(aux.tgoval)
      c:RegisterEffect(e1)
      local e2=Effect.CreateEffect(c)
      e2:SetType(EFFECT_TYPE_SINGLE)
      e2:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e2:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
      e2:SetRange(LOCATION_MZONE)
      e2:SetCondition(function(e)
        local c=e:GetHandler()
        return c:IsDefensePos()
      end)
      e2:SetValue(aux.tgoval)
      c:RegisterEffect(e2)
      `,
      "checksum-dragon-official-local-position-indestructible.lua",
    );
    expect(register.ok, register.error).toBe(true);
    expect(session.state.effects.filter((effect) => effect.event === "continuous" && effect.code === 71)).toMatchInlineSnapshot(`
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
          "luaConditionDescriptor": "condition:source-attack-position",
          "luaTypeFlags": 1,
          "luaValueDescriptor": "cannot-be-effect-target:opponent",
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "property": 131072,
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:94136469:lua-1-71",
          "sourceUid": "p0-deck-94136469-0",
          "statValue": [Function],
          "target": [Function],
          "valueCardPredicate": [Function],
          "valuePredicate": [Function],
        },
        {
          "battleDamageValue": [Function],
          "canActivate": [Function],
          "code": 71,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-2-71",
          "lifePointValue": [Function],
          "luaConditionDescriptor": "condition:source-defense-position",
          "luaTypeFlags": 1,
          "luaValueDescriptor": "cannot-be-effect-target:opponent",
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "property": 131072,
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:94136469:lua-2-71",
          "sourceUid": "p0-deck-94136469-0",
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
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const restoredDragon = restored.session.state.cards.find((card) => card.code === checksumDragonCode);
    const attackEffect = restored.session.state.effects.find((effect) => effect.sourceUid === checksumDragon!.uid && effect.code === 71 && effect.luaConditionDescriptor === "condition:source-attack-position");
    const defenseEffect = restored.session.state.effects.find((effect) => effect.sourceUid === checksumDragon!.uid && effect.code === 71 && effect.luaConditionDescriptor === "condition:source-defense-position");
    expect(attackEffect).toMatchObject({ property: 0x20000 });
    expect(defenseEffect).toMatchObject({ property: 0x20000 });
    expect(attackEffect?.canActivate).toBeDefined();
    expect(defenseEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredDragon!);
    expect(attackEffect!.canActivate!(ctx)).toBe(true);
    expect(defenseEffect!.canActivate!(ctx)).toBe(false);
    restoredDragon!.position = "faceUpDefense";
    expect(attackEffect!.canActivate!(ctx)).toBe(false);
    expect(defenseEffect!.canActivate!(ctx)).toBe(true);
    restoredDragon!.position = "faceDownDefense";
    expect(defenseEffect!.canActivate!(ctx)).toBe(true);
  });

  it("restores its Attack Position-only battle indestructible effect", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const checksumDragonCode = "94136469";
    const script = workspace.readScript(`c${checksumDragonCode}.lua`);
    expect(script).toContain("e2:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
    expect(script).toContain("e2:SetRange(LOCATION_MZONE)");
    expect(script).toContain("e2:SetCondition(function(e) return e:GetHandler():IsAttackPos() end)");
    expect(script).toContain("e2:SetValue(1)");
    const cards = checksumDragonCards(checksumDragonCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 941, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [checksumDragonCode] }, 1: { main: [] } });
    startDuel(session);

    const checksumDragon = session.state.cards.find((card) => card.code === checksumDragonCode);
    expect(checksumDragon).toBeDefined();
    moveDuelCard(session.state, checksumDragon!.uid, "monsterZone", 0);
    checksumDragon!.faceUp = true;
    checksumDragon!.position = "faceUpAttack";

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(checksumDragonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 42 && effect.sourceUid === checksumDragon!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 42,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-2-42",
        "luaConditionDescriptor": "condition:source-attack-position",
        "luaTypeFlags": 1,
        "oncePerTurn": false,
        "operation": [Function],
        "promptOperation": [Function],
        "property": 131072,
        "range": [
          "monsterZone",
        ],
        "registryKey": "lua:94136469:lua-2-42",
        "sourceUid": "p0-deck-94136469-0",
        "target": [Function],
        "value": 1,
      }
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const restoredDragon = restored.session.state.cards.find((card) => card.code === checksumDragonCode);
    const restoredEffect = restored.session.state.effects.find((effect) => effect.sourceUid === checksumDragon!.uid && effect.code === 42);
    expect(restoredDragon).toBeDefined();
    expect(restoredEffect).toMatchObject({
      event: "continuous",
      code: 42,
      luaConditionDescriptor: "condition:source-attack-position",
      property: 0x20000,
      range: ["monsterZone"],
      value: 1,
    });
    expect(restoredEffect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredDragon!);
    expect(restoredEffect!.canActivate!(ctx)).toBe(true);

    const attackPositionDestroy = destroyDuelCard(restored.session.state, restoredDragon!.uid, 0, duelReason.battle | duelReason.destroy, 1);
    expect(attackPositionDestroy).toMatchObject({ uid: restoredDragon!.uid, location: "monsterZone" });

    restoredDragon!.position = "faceUpDefense";
    expect(restoredEffect!.canActivate!(ctx)).toBe(false);
    const defensePositionDestroy = destroyDuelCard(restored.session.state, restoredDragon!.uid, 0, duelReason.battle | duelReason.destroy, 1);
    expect(defensePositionDestroy).toMatchObject({ uid: restoredDragon!.uid, location: "graveyard", reason: duelReason.battle | duelReason.destroy });
  });
});

function checksumDragonCards(checksumDragonCode: string): DuelCardData[] {
  return [
    {
      code: checksumDragonCode,
      name: "Checksum Dragon",
      kind: "monster",
      typeFlags: typeMonster | typeEffect,
      level: 6,
      attack: 400,
      defense: 2400,
    },
  ];
}
