import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasYamataScript = fs.existsSync(path.join(upstreamRoot, "script", "official", "c76862289.lua"));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasYamataScript)("Lua real script Yamata Dragon battle-damage draw", () => {
  it("restores its battle-damage trigger and draws until 5 from CHAININFO_TARGET_PLAYER", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const yamataCode = "76862289";
    const defenderCode = "76862290";
    const handACode = "76862291";
    const handBCode = "76862292";
    const drawACode = "76862293";
    const drawBCode = "76862294";
    const drawCCode = "76862295";
    const script = workspace.readScript(`c${yamataCode}.lua`);
    expect(script).toContain("Spirit.AddProcedure(c,EVENT_SUMMON_SUCCESS,EVENT_FLIP)");
    expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_CONDITION)");
    expect(script).toContain("e2:SetCode(EVENT_BATTLE_DAMAGE)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_PLAYER_TARGET)");
    expect(script).toContain("Duel.SetTargetPlayer(tp)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER)");
    expect(script).toContain("Duel.Draw(p,5-ht,REASON_EFFECT)");
    const cards: DuelCardData[] = [
      { code: yamataCode, name: "Yamata Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, level: 7, attack: 2600, defense: 3100 },
      { code: defenderCode, name: "Yamata Battle Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: handACode, name: "Yamata Existing Hand A", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: handBCode, name: "Yamata Existing Hand B", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: drawACode, name: "Yamata Draw A", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: drawBCode, name: "Yamata Draw B", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: drawCCode, name: "Yamata Draw C", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 768, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [yamataCode, handACode, handBCode, drawACode, drawBCode, drawCCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const yamata = session.state.cards.find((card) => card.code === yamataCode);
    const defender = session.state.cards.find((card) => card.code === defenderCode);
    const handA = session.state.cards.find((card) => card.code === handACode);
    const handB = session.state.cards.find((card) => card.code === handBCode);
    const drawA = session.state.cards.find((card) => card.code === drawACode);
    const drawB = session.state.cards.find((card) => card.code === drawBCode);
    const drawC = session.state.cards.find((card) => card.code === drawCCode);
    expect(yamata).toBeDefined();
    expect(defender).toBeDefined();
    expect(handA).toBeDefined();
    expect(handB).toBeDefined();
    expect(drawA).toBeDefined();
    expect(drawB).toBeDefined();
    expect(drawC).toBeDefined();
    moveDuelCard(session.state, yamata!.uid, "monsterZone", 0);
    yamata!.position = "faceUpAttack";
    yamata!.faceUp = true;
    moveDuelCard(session.state, defender!.uid, "monsterZone", 1);
    defender!.position = "faceUpAttack";
    defender!.faceUp = true;
    moveDuelCard(session.state, handA!.uid, "hand", 0);
    moveDuelCard(session.state, handB!.uid, "hand", 0);
    drawA!.sequence = 0;
    drawB!.sequence = 1;
    drawC!.sequence = 2;
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(yamataCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredSetup = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredSetup.restoreComplete, restoredSetup.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSetup.missingRegistryKeys).toEqual([]);
    expect(restoredSetup.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredSetup, 0);
    const attack = getLuaRestoreLegalActions(restoredSetup, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === yamata!.uid && action.targetUid === defender!.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredSetup, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSetup, attack!);
    passBattleUntilTrigger(restoredSetup);
    expect(restoredSetup.session.state.pendingTriggers).toMatchInlineSnapshot(`
      [
        {
          "effectId": "lua-7-1143",
          "eventCardUid": "p0-deck-76862289-0",
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
          "eventReasonCardUid": "p0-deck-76862289-0",
          "eventReasonPlayer": 0,
          "eventTriggerTiming": "when",
          "eventValue": 1600,
          "id": "trigger-5-1",
          "player": 0,
          "sourceUid": "p0-deck-76862289-0",
          "triggerBucket": "turnMandatory",
        },
      ]
    `);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSetup.session), workspace, reader);
    expect(restoredTrigger.restoreComplete, restoredTrigger.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTrigger.missingRegistryKeys).toEqual([]);
    expect(restoredTrigger.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === yamata!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);

    for (const card of [handA, handB, drawA, drawB, drawC]) {
      expect(restoredTrigger.session.state.cards.find((candidate) => candidate.uid === card!.uid)).toMatchObject({ location: "hand", controller: 0 });
    }
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "cardsDrawn")).toMatchInlineSnapshot(`
      [
        {
          "eventCardUid": "p0-deck-76862293-3",
          "eventCode": 1110,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": false,
            "location": "hand",
            "position": "faceDown",
            "sequence": 2,
          },
          "eventName": "cardsDrawn",
          "eventPlayer": 0,
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "deck",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 64,
          "eventReasonCardUid": "p0-deck-76862289-0",
          "eventReasonEffectId": 7,
          "eventReasonPlayer": 0,
          "eventUids": [
            "p0-deck-76862293-3",
            "p0-deck-76862294-4",
            "p0-deck-76862295-5",
          ],
          "eventValue": 3,
        },
      ]
    `);
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
