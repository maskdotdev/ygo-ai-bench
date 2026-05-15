import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpirit = 0x200;
const typeSpell = 0x2;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Yamato-no-Kami battle destroy backrow", () => {
  it("restores its banish-cost Special Summon and battle-destroying Spell/Trap destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const yamatoCode = "82841979";
    const costSpiritCode = "82841980";
    const defenderCode = "82841981";
    const backrowCode = "82841982";
    const responderCode = "82841983";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === yamatoCode),
      { code: costSpiritCode, name: "Yamato Cost Spirit", kind: "monster", typeFlags: typeMonster | typeEffect | typeSpirit, level: 4, attack: 1000, defense: 1000 },
      { code: defenderCode, name: "Yamato Battle Victim", kind: "monster", typeFlags: typeMonster, level: 4, attack: 500, defense: 500 },
      { code: backrowCode, name: "Yamato Backrow Target", kind: "spell", typeFlags: typeSpell },
      { code: responderCode, name: "Yamato Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 828, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [yamatoCode, costSpiritCode] }, 1: { main: [defenderCode, backrowCode, responderCode] } });
    startDuel(session);

    const yamato = session.state.cards.find((card) => card.code === yamatoCode);
    const costSpirit = session.state.cards.find((card) => card.code === costSpiritCode);
    const defender = session.state.cards.find((card) => card.code === defenderCode);
    const backrow = session.state.cards.find((card) => card.code === backrowCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(yamato).toBeDefined();
    expect(costSpirit).toBeDefined();
    expect(defender).toBeDefined();
    expect(backrow).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, yamato!.uid, "hand", 0);
    moveDuelCard(session.state, costSpirit!.uid, "graveyard", 0);
    moveDuelCard(session.state, defender!.uid, "monsterZone", 1);
    defender!.faceUp = true;
    defender!.position = "faceUpAttack";
    moveDuelCard(session.state, backrow!.uid, "spellTrapZone", 1);
    backrow!.faceUp = false;
    backrow!.sequence = 0;
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
    expect(host.loadCardScript(Number(yamatoCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredProcedureWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredProcedureWindow.restoreComplete, restoredProcedureWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredProcedureWindow.missingRegistryKeys).toEqual([]);
    expect(restoredProcedureWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredProcedureWindow, 0);
    const procedure = getLuaRestoreLegalActions(restoredProcedureWindow, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === yamato!.uid);
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restoredProcedureWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredProcedureWindow, procedure!);
    expect(restoredProcedureWindow.session.state.cards.find((card) => card.uid === yamato!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "special",
      faceUp: true,
    });
    expect(restoredProcedureWindow.session.state.cards.find((card) => card.uid === costSpirit!.uid)).toMatchObject({ location: "banished", faceUp: true });

    moveToBattle(restoredProcedureWindow.session, 0);
    const restoredBattleWindow = restoreDuelWithLuaScripts(serializeDuel(restoredProcedureWindow.session), source, reader);
    expect(restoredBattleWindow.restoreComplete, restoredBattleWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredBattleWindow.missingRegistryKeys).toEqual([]);
    expect(restoredBattleWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredBattleWindow, 0);
    const attack = getLuaRestoreLegalActions(restoredBattleWindow, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === yamato!.uid && action.targetUid === defender!.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattleWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattleWindow, attack!);
    passBattleUntilTrigger(restoredBattleWindow);

    expect(restoredBattleWindow.session.state.cards.find((card) => card.uid === defender!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredBattleWindow.session.state.pendingTriggers).toMatchInlineSnapshot(`
      [
        {
          "effectId": "lua-8-1139",
          "eventCardUid": "p0-deck-82841979-0",
          "eventCode": 1140,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "battleDestroyed",
          "eventPlayer": 1,
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "hand",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 33,
          "eventReasonCardUid": "p0-deck-82841979-0",
          "eventReasonPlayer": 0,
          "eventTriggerTiming": "if",
          "id": "trigger-11-1",
          "player": 0,
          "sourceUid": "p0-deck-82841979-0",
          "triggerBucket": "turnOptional",
        },
      ]
    `);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredBattleWindow.session), source, reader);
    expect(restoredTriggerWindow.restoreComplete, restoredTriggerWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTriggerWindow.missingRegistryKeys).toEqual([]);
    expect(restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === yamato!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);
    expect(restoredTriggerWindow.session.state.chain).toHaveLength(1);
    expect(restoredTriggerWindow.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "monsterZone",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-8-1139",
        "eventCardUid": "p0-deck-82841979-0",
        "eventCode": 1140,
        "eventCurrentState": {
          "controller": 0,
          "faceUp": true,
          "location": "monsterZone",
          "position": "faceUpAttack",
          "sequence": 0,
        },
        "eventName": "battleDestroyed",
        "eventPlayer": 1,
        "eventPreviousState": {
          "controller": 0,
          "faceUp": false,
          "location": "hand",
          "position": "faceDown",
          "sequence": 0,
        },
        "eventReason": 33,
        "eventReasonCardUid": "p0-deck-82841979-0",
        "eventReasonPlayer": 0,
        "eventTriggerTiming": "if",
        "id": "chain-11",
        "operationInfos": [
          {
            "category": 1,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p1-deck-82841982-1",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-82841979-0",
        "targetUids": [
          "p1-deck-82841982-1",
        ],
      }
    `);

    const restoredChainWindow = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expect(restoredChainWindow.restoreComplete, restoredChainWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChainWindow.missingRegistryKeys).toEqual([]);
    expect(restoredChainWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredChainWindow, 1);
    expect(restoredChainWindow.session.state.effects.find((effect) => effect.sourceUid === responder!.uid && effect.event === "quick")).toMatchObject({
      hintTiming: [0x1000000],
      property: 0xc000,
      range: ["hand"],
    });
    const pass = getLuaRestoreLegalActions(restoredChainWindow, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredChainWindow, 1), null, 2)).toBeDefined();
    const resolved = applyLuaRestoreResponse(restoredChainWindow, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === backrow!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredChainWindow.session.state.cards.find((card) => card.uid === yamato!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredChainWindow.session.state.eventHistory.filter((event) => event.eventName === "battleDestroyed")).toEqual([
      {
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: defender!.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: yamato!.uid,
        eventPreviousState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
    expect(restoredChainWindow.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === backrow!.uid)).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: backrow!.uid,
        eventPreviousState: {
          location: "spellTrapZone",
          controller: 1,
          sequence: 0,
          position: "faceDown",
          faceUp: false,
        },
        eventCurrentState: {
          location: "graveyard",
          controller: 1,
          sequence: 1,
          position: "faceDown",
          faceUp: true,
        },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: yamato!.uid,
        eventReasonEffectId: 8,
      },
    ]);
    expect(restoredChainWindow.host.messages).not.toContain("yamato responder resolved");
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetProperty(EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DAMAGE_CAL)
      e:SetHintTiming(TIMING_BATTLE_PHASE)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("yamato responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function moveToBattle(session: DuelSession, player: 0 | 1): void {
  const battle = getDuelLegalActions(session, player).find((action) => action.type === "changePhase" && action.phase === "battle");
  expect(battle, JSON.stringify(getDuelLegalActions(session, player), null, 2)).toBeDefined();
  const result = applyResponse(session, battle!);
  expect(result.ok, result.error).toBe(true);
}

function passBattleUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}
