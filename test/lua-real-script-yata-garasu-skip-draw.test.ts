import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasYataScript = fs.existsSync(path.join(upstreamRoot, "script", "official", "c3078576.lua"));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasYataScript)("Lua real script Yata-Garasu skip draw", () => {
  it("restores its battle-damage trigger into the opponent's next Draw Phase skip", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const yataCode = "3078576";
    const defenderCode = "3078577";
    const drawCode = "3078578";
    const script = workspace.readScript(`c${yataCode}.lua`);
    expect(script).toContain("Spirit.AddProcedure(c,EVENT_SUMMON_SUCCESS,EVENT_FLIP)");
    expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_CONDITION)");
    expect(script).toContain("e2:SetCode(EVENT_BATTLE_DAMAGE)");
    expect(script).toContain("e2:SetCondition(function(_,tp,_,ep) return ep==1-tp end)");
    expect(script).toContain("e1:SetCode(EFFECT_SKIP_DP)");
    expect(script).toContain("e1:SetReset(RESET_PHASE|PHASE_END|RESET_OPPO_TURN)");
    const cards: DuelCardData[] = [
      { code: yataCode, name: "Yata-Garasu", kind: "monster", typeFlags: typeMonster | typeEffect, level: 2, attack: 200, defense: 100 },
      { code: defenderCode, name: "Yata-Garasu Battle Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 0, defense: 0 },
      { code: drawCode, name: "Yata-Garasu Skipped Draw Card", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 307, startingHandSize: 0, drawPerTurn: 1, cardReader: reader });
    loadDecks(session, { 0: { main: [yataCode] }, 1: { main: [defenderCode, drawCode] } });
    startDuel(session);

    const yata = session.state.cards.find((card) => card.code === yataCode);
    const defender = session.state.cards.find((card) => card.code === defenderCode);
    const drawCard = session.state.cards.find((card) => card.code === drawCode);
    expect(yata).toBeDefined();
    expect(defender).toBeDefined();
    expect(drawCard).toBeDefined();
    moveDuelCard(session.state, yata!.uid, "monsterZone", 0);
    yata!.position = "faceUpAttack";
    yata!.faceUp = true;
    moveDuelCard(session.state, defender!.uid, "monsterZone", 1);
    defender!.position = "faceUpAttack";
    defender!.faceUp = true;
    drawCard!.sequence = 0;
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(yataCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredSetup = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredSetup.restoreComplete, restoredSetup.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSetup.missingRegistryKeys).toEqual([]);
    expect(restoredSetup.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredSetup, 0);
    const attack = getLuaRestoreLegalActions(restoredSetup, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === yata!.uid && action.targetUid === defender!.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredSetup, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSetup, attack!);
    passBattleUntilTrigger(restoredSetup);
    expect(restoredSetup.session.state.pendingTriggers).toMatchInlineSnapshot(`
      [
        {
          "effectId": "lua-7-1143",
          "eventCardUid": "p0-deck-3078576-0",
          "eventCode": 1143,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "battleDamageDealt",
          "eventPlayer": 1,
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "deck",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 32,
          "eventReasonCardUid": "p0-deck-3078576-0",
          "eventReasonPlayer": 0,
          "eventTriggerTiming": "when",
          "eventValue": 200,
          "id": "trigger-5-1",
          "player": 0,
          "sourceUid": "p0-deck-3078576-0",
          "triggerBucket": "turnMandatory",
        },
      ]
    `);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSetup.session), workspace, reader);
    expect(restoredTrigger.restoreComplete, restoredTrigger.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTrigger.missingRegistryKeys).toEqual([]);
    expect(restoredTrigger.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === yata!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.skippedPhases).toEqual([{ player: 1, phase: "draw", remaining: 1 }]);

    const restoredSkip = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expect(restoredSkip.restoreComplete, restoredSkip.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSkip.missingRegistryKeys).toEqual([]);
    expect(restoredSkip.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredSkip, 0);
    expect(restoredSkip.session.state.skippedPhases).toEqual([{ player: 1, phase: "draw", remaining: 1 }]);
    moveToMain2AndEndTurn(restoredSkip.session, 0);

    expect(restoredSkip.session.state).toMatchObject({ turnPlayer: 1, phase: "main1", waitingFor: 1, skippedPhases: [] });
    expect(restoredSkip.session.state.cards.find((card) => card.uid === drawCard!.uid)).toMatchObject({ location: "deck", controller: 1 });
    expect(restoredSkip.session.state.eventHistory.filter((event) => event.eventName === "preDraw" && event.eventPlayer === 1)).toEqual([]);
  });
});

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

function moveToMain2AndEndTurn(session: DuelSession, player: 0 | 1): void {
  const main2 = getDuelLegalActions(session, player).find((action) => action.type === "changePhase" && action.phase === "main2");
  expect(main2, JSON.stringify(getDuelLegalActions(session, player), null, 2)).toBeDefined();
  let result = applyResponse(session, main2!);
  expect(result.ok, result.error).toBe(true);
  const endTurn = getDuelLegalActions(session, player).find((action) => action.type === "endTurn");
  expect(endTurn, JSON.stringify(getDuelLegalActions(session, player), null, 2)).toBeDefined();
  result = applyResponse(session, endTurn!);
  expect(result.ok, result.error).toBe(true);
}
