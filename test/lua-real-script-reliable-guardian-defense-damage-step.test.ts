import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelResponse, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const reliableGuardianCode = "16430187";
const hasReliableGuardianScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${reliableGuardianCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeQuickplay = 0x10000;

describe.skipIf(!hasUpstreamScripts || !hasReliableGuardianScript)("Lua real script The Reliable Guardian Damage Step defense update", () => {
  it("restores targeted Damage Step DEF update activation and preserves the boosted defense through battle", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const attackerCode = "164301870";
    const defenderCode = "164301871";
    const script = workspace.readScript(`c${reliableGuardianCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_DEFCHANGE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("local tc=Duel.GetFirstTarget()");
    expect(script).toContain("tc:IsRelateToEffect(e) and tc:IsFaceup()");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e1:SetValue(700)");

    const cards: DuelCardData[] = [
      { code: reliableGuardianCode, name: "The Reliable Guardian", kind: "spell", typeFlags: typeSpell | typeQuickplay },
      { code: attackerCode, name: "Reliable Guardian Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1600, defense: 0 },
      { code: defenderCode, name: "Reliable Guardian Defender", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 16430187, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [reliableGuardianCode, defenderCode] }, 1: { main: [attackerCode] } });
    startDuel(session);

    const reliableGuardian = requireCard(session, reliableGuardianCode);
    const defender = requireCard(session, defenderCode);
    const attacker = requireCard(session, attackerCode);
    moveDuelCard(session.state, reliableGuardian.uid, "hand", 0);
    moveDuelCard(session.state, defender.uid, "monsterZone", 0).position = "faceUpDefense";
    defender.faceUp = true;
    moveDuelCard(session.state, attacker.uid, "monsterZone", 1).position = "faceUpAttack";
    attacker.faceUp = true;
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(reliableGuardianCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === reliableGuardian.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      {
        category: 0x400000,
        code: 1002,
        event: "quick",
        id: "lua-1-1002",
        property: 0x4010,
        range: ["hand", "spellTrapZone"],
        sourceUid: reliableGuardian.uid,
      },
    ]);

    const attack = getLegalActions(session, 1).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    passBattleAction(session, 0, "passAttack");
    passBattleAction(session, 1, "passAttack");
    expect(session.state.battleWindow).toMatchObject({ kind: "startDamageStep", step: "damage", responsePlayer: 0 });
    expect(currentDefense(defender, session.state)).toBe(1000);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    const reliableGuardianAction = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === reliableGuardian.uid);
    expect(reliableGuardianAction, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, reliableGuardianAction!);
    expect(restoredActivation.session.state.cards.find((card) => card.uid === reliableGuardian.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredActivation.session.state.chain).toHaveLength(0);
    expect(restoredActivation.session.state.effects.filter((effect) => effect.event === "continuous" && effect.code === 104 && effect.sourceUid === defender.uid)).toMatchObject([
      {
        code: 104,
        controller: 0,
        event: "continuous",
        id: "lua-2-104",
        range: ["monsterZone"],
        reset: { flags: 1107169792 },
        sourceUid: defender.uid,
        value: 700,
      },
    ]);
    expect(currentDefense(restoredActivation.session.state.cards.find((card) => card.uid === defender.uid), restoredActivation.session.state)).toBe(1700);

    const restoredBoost = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), workspace, reader);
    expectCleanRestore(restoredBoost);
    expectRestoredLegalActions(restoredBoost, 1);
    const restoredDefender = restoredBoost.session.state.cards.find((card) => card.uid === defender.uid)!;
    expect(currentDefense(restoredDefender, restoredBoost.session.state)).toBe(1700);
    passRestoredBattleResponses(restoredBoost);
    expect(restoredBoost.session.state.battleDamage).toEqual({ 0: 0, 1: 100 });
    expect(restoredBoost.session.state.players[0].lifePoints).toBe(8000);
    expect(restoredBoost.session.state.players[1].lifePoints).toBe(7900);
    expect(restoredBoost.session.state.cards.find((card) => card.uid === attacker.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restoredBoost.session.state.cards.find((card) => card.uid === defender.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredBoost.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventCardUid: defender.uid,
        eventCode: 1143,
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpDefense",
          sequence: 0,
        },
        eventName: "battleDamageDealt",
        eventPlayer: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventReason: 32,
        eventReasonCardUid: defender.uid,
        eventReasonPlayer: 0,
        eventValue: 100,
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const result = applyResponse(session, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = result.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLegalActions(session, waitingFor));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function passBattleAction(session: DuelSession, player: 0 | 1, type: "passAttack" | "passDamage"): void {
  const pass = getLegalActions(session, player).find((action) => action.type === type);
  expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
  applyAndAssert(session, pass!);
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
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

function passRestoredBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
