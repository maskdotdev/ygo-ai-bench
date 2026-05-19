import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const rushCode = "70046172";
const hasRushScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${rushCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeQuickplay = 0x10000;

describe.skipIf(!hasUpstreamScripts || !hasRushScript)("Lua real script Rush Recklessly StatChangeDamageStepCondition", () => {
  it("restores targeted Damage Step ATK update activation and battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const attackerCode = "70046173";
    const defenderCode = "70046174";
    const script = workspace.readScript(`official/c${rushCode}.lua`);
    expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
    expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("local tc=Duel.GetFirstTarget()");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(700)");

    const cards: DuelCardData[] = [
      { code: rushCode, name: "Rush Recklessly", kind: "spell", typeFlags: typeSpell | typeQuickplay },
      { code: attackerCode, name: "Rush Recklessly Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1000 },
      { code: defenderCode, name: "Rush Recklessly Defender", kind: "monster", typeFlags: typeMonster, level: 4, attack: 2000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7004, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [rushCode, attackerCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const rush = session.state.cards.find((card) => card.code === rushCode)!;
    const attacker = session.state.cards.find((card) => card.code === attackerCode)!;
    const defender = session.state.cards.find((card) => card.code === defenderCode)!;
    moveDuelCard(session.state, rush.uid, "hand", 0);
    moveDuelCard(session.state, attacker.uid, "monsterZone", 0).position = "faceUpAttack";
    attacker.faceUp = true;
    moveDuelCard(session.state, defender.uid, "monsterZone", 1).position = "faceUpAttack";
    defender.faceUp = true;
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(rushCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === rush.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      {
        category: 0x200000,
        code: 1002,
        event: "quick",
        id: "lua-1-1002",
        property: 0x4010,
        range: ["hand", "spellTrapZone"],
        sourceUid: rush.uid,
      },
    ]);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    const opponentPass = getLegalActions(session, 1).find((action) => action.type === "passAttack");
    expect(opponentPass, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, opponentPass!);
    expect(session.state.battleWindow?.kind).toBe("attackNegationResponse");
    expect(currentAttack(attacker, session.state)).toBe(1500);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredActivation);
    expect(restoredActivation.session.state.battleWindow?.kind).toBe("attackNegationResponse");
    const rushAction = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === rush.uid);
    expect(rushAction, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    const activated = applyLuaRestoreResponse(restoredActivation, rushAction!);
    expect(activated.ok, activated.error).toBe(true);

    expect(restoredActivation.session.state.cards.find((card) => card.uid === rush.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredActivation.session.state.chain).toHaveLength(0);
    expect(restoredActivation.session.state.effects.filter((effect) => effect.event === "continuous" && effect.code === 100 && effect.sourceUid === attacker.uid)).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "code": 100,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-2-100",
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:70046172:lua-2-100",
          "reset": {
            "flags": 1107169792,
          },
          "sourceUid": "p0-deck-70046173-1",
          "target": [Function],
          "value": 700,
        },
      ]
    `);
    expect(currentAttack(restoredActivation.session.state.cards.find((card) => card.uid === attacker.uid)!, restoredActivation.session.state)).toBe(2200);

    const restoredBoost = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), workspace, reader);
    expectCleanRestore(restoredBoost);
    expect(restoredBoost.session.state.battleWindow?.kind).toBe("attackNegationResponse");
    const restoredAttacker = restoredBoost.session.state.cards.find((card) => card.uid === attacker.uid)!;
    expect(currentAttack(restoredAttacker, restoredBoost.session.state)).toBe(2200);

    passRestoredBattleResponses(restoredBoost);
    expect(restoredBoost.session.state.battleDamage).toEqual({ 0: 0, 1: 200 });
    expect(restoredBoost.session.state.players[1].lifePoints).toBe(7800);
    expect(restoredBoost.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: attacker.uid,
        eventPlayer: 1,
        eventReason: 32,
        eventReasonCardUid: attacker.uid,
        eventReasonPlayer: 0,
        eventValue: 200,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
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
    expect(restoredBoost.session.state.cards.find((card) => card.uid === defender.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredBoost.session.state.cards.find((card) => card.uid === attacker.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
  });
});

function passRestoredBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    const result = applyLuaRestoreResponse(restored, pass!);
    expect(result.ok, result.error).toBe(true);
  }
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>) {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
