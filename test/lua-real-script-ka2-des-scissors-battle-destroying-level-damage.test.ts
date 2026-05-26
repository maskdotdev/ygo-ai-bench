import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script KA-2 Des Scissors battle-destroying level damage", () => {
  it("restores KA-2 Des Scissors' battle-destroying Level-scaled damage without player-target property", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const ka2Code = "52768103";
    const defenderCode = "52768104";
    const script = workspace.readScript(`c${ka2Code}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_DAMAGE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
    expect(script).not.toContain("e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)");
    expect(script).toContain("e1:SetCode(EVENT_BATTLE_DESTROYING)");
    expect(script).toContain("bc:IsReason(REASON_BATTLE)");
    expect(script).toContain("local dam=bc:GetLevel()*500");
    expect(script).toContain("Duel.SetTargetPlayer(1-tp)");
    expect(script).toContain("Duel.SetTargetParam(dam)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,dam)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)");
    expect(script).toContain("Duel.Damage(p,d,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === ka2Code),
      { code: defenderCode, name: "KA-2 Level Damage Target", kind: "monster", typeFlags: typeMonster, level: 6, attack: 800, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 52768103, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ka2Code] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const ka2 = requireCard(session, ka2Code);
    const defender = requireCard(session, defenderCode);
    moveDuelCard(session.state, ka2.uid, "monsterZone", 0);
    ka2.position = "faceUpAttack";
    ka2.faceUp = true;
    moveDuelCard(session.state, defender.uid, "monsterZone", 1);
    defender.position = "faceUpAttack";
    defender.faceUp = true;
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(ka2Code), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === ka2.uid && action.targetUid === defender.uid,
    );
    expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    passBattleUntilTrigger(session);

    expect(session.state.players[1].lifePoints).toBe(7800);
    expect(session.state.cards.find((card) => card.uid === defender.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reasonCardUid: ka2.uid,
    });
    expect(session.state.pendingTriggers).toMatchInlineSnapshot(`
      [
        {
          "effectId": "lua-1-1139",
          "eventCardUid": "p0-deck-52768103-0",
          "eventCode": 1139,
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
            "location": "deck",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 33,
          "eventReasonCardUid": "p0-deck-52768103-0",
          "eventReasonPlayer": 0,
          "eventTriggerTiming": "when",
          "id": "trigger-6-1",
          "player": 0,
          "sourceUid": "p0-deck-52768103-0",
          "triggerBucket": "turnMandatory",
        },
      ]
    `);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === ka2.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([]);
    expect(restoredTrigger.session.state.pendingBattle).toBeUndefined();
    expect(restoredTrigger.session.state.currentAttack).toBeUndefined();
    expect(restoredTrigger.session.state.players[1].lifePoints).toBe(4800);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === ka2.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === defender.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "battleDestroyed")).toEqual([
      {
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: defender.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: ka2.uid,
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
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 3000,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: ka2.uid,
        eventReasonEffectId: 1,
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function passBattleUntilTrigger(session: DuelSession): void {
  let guard = 0;
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}
