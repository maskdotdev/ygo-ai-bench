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
const joanCode = "68007326";
const hasJoanScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${joanCode}.lua`));
const defenderCode = "680073260";
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasJoanScript)("Lua real script Guardian Angel Joan battle recover", () => {
  it("restores battle-destroying recovery from the destroyed target's base ATK through CHAININFO", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${joanCode}.lua`);
    expect(script).toBeDefined();
    const scriptText = script!;
    expect(scriptText).toContain("e1:SetCategory(CATEGORY_RECOVER)");
    expect(scriptText).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
    expect(scriptText).toContain("e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)");
    expect(scriptText).toContain("e1:SetCode(EVENT_BATTLE_DESTROYING)");
    expect(scriptText).toContain("return c:IsRelateToBattle() and bc:IsLocation(LOCATION_GRAVE)");
    expect(scriptText).toContain("local rec=bc:GetBaseAttack()");
    expect(scriptText).toContain("Duel.SetTargetPlayer(tp)");
    expect(scriptText).toContain("Duel.SetTargetParam(rec)");
    expect(scriptText).toContain("Duel.SetOperationInfo(0,CATEGORY_RECOVER,nil,0,tp,rec)");
    expect(scriptText).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)");
    expect(scriptText).toContain("Duel.Recover(p,d,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      { code: joanCode, name: "Guardian Angel Joan", kind: "monster", typeFlags: typeMonster | typeEffect, level: 7, attack: 2800, defense: 2000 },
      { code: defenderCode, name: "Guardian Angel Joan Battle Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1700, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 68007326, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [joanCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const joan = requireCard(session, joanCode);
    const defender = requireCard(session, defenderCode);
    moveDuelCard(session.state, joan.uid, "monsterZone", 0);
    joan.position = "faceUpAttack";
    joan.faceUp = true;
    moveDuelCard(session.state, defender.uid, "monsterZone", 1);
    defender.position = "faceUpAttack";
    defender.faceUp = true;
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(joanCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === joan.uid && action.targetUid === defender.uid,
    );
    expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    passBattleUntilTrigger(session);

    expect(session.state.players[1].lifePoints).toBe(6900);
    expect(session.state.cards.find((card) => card.uid === defender.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reasonCardUid: joan.uid,
    });
    expect(session.state.pendingTriggers).toMatchInlineSnapshot(`
      [
        {
          "effectId": "lua-1-1139",
          "eventCardUid": "p0-deck-68007326-0",
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
          "eventReasonCardUid": "p0-deck-68007326-0",
          "eventReasonPlayer": 0,
          "eventTriggerTiming": "when",
          "id": "trigger-6-1",
          "player": 0,
          "sourceUid": "p0-deck-68007326-0",
          "triggerBucket": "turnMandatory",
        },
      ]
    `);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === joan.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([]);
    expect(restoredTrigger.session.state.pendingBattle).toBeUndefined();
    expect(restoredTrigger.session.state.currentAttack).toBeUndefined();
    expect(restoredTrigger.session.state.players[0].lifePoints).toBe(9700);
    expect(restoredTrigger.session.state.players[1].lifePoints).toBe(6900);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === joan.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === defender.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "battleDestroyed")).toEqual([
      {
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: defender.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: joan.uid,
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
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "recoveredLifePoints")).toEqual([
      {
        eventName: "recoveredLifePoints",
        eventCode: 1112,
        eventPlayer: 0,
        eventValue: 1700,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: joan.uid,
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
