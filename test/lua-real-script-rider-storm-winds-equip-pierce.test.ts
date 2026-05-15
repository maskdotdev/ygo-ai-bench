import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelResponse, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Rider of the Storm Winds equip pierce", () => {
  it("restores self-equip limit and equip-sourced piercing damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const riderCode = "14235211";
    const normalDragonCode = "14235";
    const effectDragonCode = "14236";
    const defenderCode = "14237";
    const responderCode = "14238";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === riderCode),
      { code: normalDragonCode, name: "Rider Normal Dragon Target", kind: "monster", typeFlags: 0x11, race: 0x2000, attribute: 0x10, level: 4, attack: 1800, defense: 1000 },
      { code: effectDragonCode, name: "Rider Effect Dragon Decoy", kind: "monster", typeFlags: 0x21, race: 0x2000, attribute: 0x10, level: 4, attack: 1700, defense: 1000 },
      { code: defenderCode, name: "Rider Defense Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 500, defense: 1000 },
      { code: responderCode, name: "Rider Chain Responder", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 142, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [riderCode, normalDragonCode, effectDragonCode] }, 1: { main: [defenderCode, responderCode] } });
    startDuel(session);

    const rider = session.state.cards.find((card) => card.code === riderCode);
    const normalDragon = session.state.cards.find((card) => card.code === normalDragonCode);
    const effectDragon = session.state.cards.find((card) => card.code === effectDragonCode);
    const defender = session.state.cards.find((card) => card.code === defenderCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(rider).toBeDefined();
    expect(normalDragon).toBeDefined();
    expect(effectDragon).toBeDefined();
    expect(defender).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, rider!.uid, "hand", 0);
    moveDuelCard(session.state, normalDragon!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, effectDragon!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, defender!.uid, "monsterZone", 1).position = "faceUpDefense";
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(riderCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredEquipWindow.restoreComplete, restoredEquipWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredEquipWindow.missingRegistryKeys).toEqual([]);
    expect(restoredEquipWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredEquipWindow, 0);
    expect(getLuaRestoreLegalActions(restoredEquipWindow, 0)).toEqual(getDuelLegalActions(restoredEquipWindow.session, 0));
    const equipAction = getLuaRestoreLegalActions(restoredEquipWindow, 0).find((action) => action.type === "activateEffect" && action.uid === rider!.uid);
    expect(equipAction, JSON.stringify(getLuaRestoreLegalActions(restoredEquipWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEquipWindow, equipAction!);

    expect(restoredEquipWindow.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1",
        "id": "chain-2",
        "player": 0,
        "sourceUid": "p0-deck-14235211-0",
        "targetUids": [
          "p0-deck-14235-1",
        ],
      }
    `);
    expect(restoredEquipWindow.session.state.chain[0]?.targetUids).not.toContain(effectDragon!.uid);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(restoredChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("rider responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === rider!.uid)).toMatchObject({
      location: "spellTrapZone",
      equippedToUid: normalDragon!.uid,
      faceUp: true,
    });

    const restoredEquipState = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expect(restoredEquipState.restoreComplete, restoredEquipState.incompleteReasons.join("; ")).toBe(true);
    expect(restoredEquipState.missingRegistryKeys).toEqual([]);
    expect(restoredEquipState.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredEquipState, 0);
    expect(restoredEquipState.session.state.effects.filter((effect) => effect.event === "continuous" && effect.sourceUid === rider!.uid && [76, 203].includes(effect.code ?? -1))).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "code": 203,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-2-203",
          "luaTypeFlags": 4,
          "oncePerTurn": false,
          "operation": [Function],
          "range": [
            "spellTrapZone",
          ],
          "registryKey": "lua:14235211:lua-2-203",
          "sourceUid": "p0-deck-14235211-0",
          "target": [Function],
        },
        {
          "battleDamageValue": [Function],
          "canActivate": [Function],
          "code": 76,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-5-76",
          "lifePointValue": [Function],
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "property": 1024,
          "range": [
            "spellTrapZone",
          ],
          "registryKey": "lua:14235211:lua-5-76",
          "reset": {
            "flags": 33427456,
          },
          "sourceUid": "p0-deck-14235211-0",
          "statValue": [Function],
          "target": [Function],
          "valueCardPredicate": [Function],
          "valuePredicate": [Function],
        },
      ]
    `);
    expectLuaEquipProbe(restoredEquipState, riderCode, normalDragonCode, "rider equip probe true/14235");
    const battlePhase = getLuaRestoreLegalActions(restoredEquipState, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battlePhase, JSON.stringify(getLuaRestoreLegalActions(restoredEquipState, 0), null, 2)).toBeDefined();
    const enteredBattle = applyLuaRestoreResponse(restoredEquipState, battlePhase!);
    expect(enteredBattle.ok, enteredBattle.error).toBe(true);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredEquipState.session), source, reader);
    expect(restoredBattle.restoreComplete, restoredBattle.incompleteReasons.join("; ")).toBe(true);
    expect(restoredBattle.missingRegistryKeys).toEqual([]);
    expect(restoredBattle.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredBattle, 0)).toEqual(getGroupedDuelLegalActions(restoredBattle.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredBattle, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredBattle, 0));
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === normalDragon!.uid && action.targetUid === defender!.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    const attacked = applyLuaRestoreResponse(restoredBattle, attack!);
    expect(attacked.ok, attacked.error).toBe(true);

    const restoredDamageWindow = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), source, reader);
    expect(restoredDamageWindow.restoreComplete, restoredDamageWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredDamageWindow.missingRegistryKeys).toEqual([]);
    expect(restoredDamageWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredDamageWindow, 1);
    passBattleResponses(restoredDamageWindow.session);

    expect(restoredDamageWindow.session.state.battleDamage).toEqual({ 0: 0, 1: 800 });
    expect(restoredDamageWindow.session.state.players[1].lifePoints).toBe(7200);
    expect(restoredDamageWindow.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: normalDragon!.uid,
        eventPlayer: 1,
        eventValue: 800,
        eventReason: duelReason.battle,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 2,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
    expect(restoredDamageWindow.session.state.cards.find((card) => card.uid === defender!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredDamageWindow.session.state.cards.find((card) => card.uid === rider!.uid)).toMatchObject({ location: "spellTrapZone", equippedToUid: normalDragon!.uid });
  });

  it("restores its self-equip destroy substitute for the equipped monster", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const riderCode = "14235211";
    const normalDragonCode = "14239";
    const responderCode = "14240";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === riderCode),
      { code: normalDragonCode, name: "Rider Substitute Normal Dragon", kind: "monster", typeFlags: 0x11, race: 0x2000, attribute: 0x10, level: 4, attack: 1800, defense: 1000 },
      { code: responderCode, name: "Rider Substitute Chain Responder", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 143, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [riderCode, normalDragonCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const rider = session.state.cards.find((card) => card.code === riderCode);
    const normalDragon = session.state.cards.find((card) => card.code === normalDragonCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(rider).toBeDefined();
    expect(normalDragon).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, rider!.uid, "hand", 0);
    moveDuelCard(session.state, normalDragon!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(riderCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredEquipWindow.restoreComplete, restoredEquipWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredEquipWindow.missingRegistryKeys).toEqual([]);
    expect(restoredEquipWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredEquipWindow, 0);
    const equipAction = getLuaRestoreLegalActions(restoredEquipWindow, 0).find((action) => action.type === "activateEffect" && action.uid === rider!.uid);
    expect(equipAction, JSON.stringify(getLuaRestoreLegalActions(restoredEquipWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEquipWindow, equipAction!);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(restoredChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
    resolveRestoredChain(restoredChain);

    const restoredEquippedState = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expect(restoredEquippedState.restoreComplete, restoredEquippedState.incompleteReasons.join("; ")).toBe(true);
    expect(restoredEquippedState.missingRegistryKeys).toEqual([]);
    expect(restoredEquippedState.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredEquippedState, 0);
    expect(restoredEquippedState.session.state.effects.filter((effect) => effect.event === "continuous" && effect.sourceUid === rider!.uid && [45, 76].includes(effect.code ?? -1))).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "code": 45,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-3-45",
          "luaTypeFlags": 4,
          "oncePerTurn": false,
          "operation": [Function],
          "property": 128,
          "range": [
            "spellTrapZone",
          ],
          "registryKey": "lua:14235211:lua-3-45",
          "sourceUid": "p0-deck-14235211-0",
          "target": [Function],
          "value": 1,
        },
        {
          "battleDamageValue": [Function],
          "canActivate": [Function],
          "code": 76,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-5-76",
          "lifePointValue": [Function],
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "property": 1024,
          "range": [
            "spellTrapZone",
          ],
          "registryKey": "lua:14235211:lua-5-76",
          "reset": {
            "flags": 33427456,
          },
          "sourceUid": "p0-deck-14235211-0",
          "statValue": [Function],
          "target": [Function],
          "valueCardPredicate": [Function],
          "valuePredicate": [Function],
        },
      ]
    `);
    expectLuaEquipProbe(restoredEquippedState, riderCode, normalDragonCode, "rider equip probe true/14239");

    destroyDuelCard(restoredEquippedState.session.state, normalDragon!.uid, 0, duelReason.effect | duelReason.destroy, 1);

    expect(restoredEquippedState.session.state.cards.find((card) => card.uid === normalDragon!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restoredEquippedState.session.state.cards.find((card) => card.uid === rider!.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy | duelReason.replace,
      reasonPlayer: 0,
    });
    expect(restoredEquippedState.session.state.log).toContainEqual(expect.objectContaining({ action: "destroySubstitute", card: normalDragon!.name }));
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("rider responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function expectLuaEquipProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, riderCode: string, targetCode: string, expected: string): void {
  const probe = restored.host.loadScript(
    `
      local rider=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${riderCode}),0,LOCATION_SZONE,0,1,1,nil):GetFirst()
      local target=rider and rider:GetEquipTarget()
      Debug.Message("rider equip probe " .. tostring(rider and rider:IsHasEffect(EFFECT_EQUIP_LIMIT)~=nil) .. "/" .. tostring(target and target:GetCode()))
    `,
    "rider-storm-winds-equip-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(expected);
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getDuelLegalActions(session, player).find((action) => action.type === passType);
    expect(pass).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
