import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const sinyouCode = "56574543";
const attackerCode = "565745430";
const defenderCode = "565745431";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSinyouScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${sinyouCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceBeastWarrior = 0x8000;
const attributeLight = 0x10;
const setBujin = 0x88;
const effectUpdateAttack = 100;
const effectChangeBattleDamage = 208;

describe.skipIf(!hasUpstreamScripts || !hasSinyouScript)("Lua real script Bujingi Sinyou grave battle stat", () => {
  it("restores Damage Step SelfBanish into Bujin ATK gain and half battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${sinyouCode}.lua`);
    expect(script).toContain("--Bujingi Sinyou");
    expect(script).toContain("e1:SetRange(LOCATION_GRAVE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("e1:SetCost(Cost.SelfBanish)");
    expect(script).toContain("local phase=Duel.GetCurrentPhase()");
    expect(script).toContain("if phase~=PHASE_DAMAGE or Duel.IsDamageCalculated() then return false end");
    expect(script).toContain("return c and c:IsSetCard(SET_BUJIN) and c:IsRace(RACE_BEASTWARRIOR) and c:IsRelateToBattle()");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(d:GetAttack())");
    expect(script).toContain("e2:SetCode(EFFECT_CHANGE_BATTLE_DAMAGE)");
    expect(script).toContain("e2:SetValue(HALF_DAMAGE)");

    const cards: DuelCardData[] = [
      { code: sinyouCode, name: "Bujingi Sinyou", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeLight, level: 4, attack: 1500, defense: 1000, setcodes: [setBujin] },
      { code: attackerCode, name: "Sinyou Bujin Beast-Warrior", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeLight, level: 4, attack: 1000, defense: 1000, setcodes: [setBujin] },
      { code: defenderCode, name: "Sinyou Battle Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeLight, level: 4, attack: 1800, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 56574543, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sinyouCode, attackerCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const sinyou = requireCard(session, sinyouCode);
    const attacker = requireCard(session, attackerCode);
    const defender = requireCard(session, defenderCode);
    moveDuelCard(session.state, sinyou.uid, "graveyard", 0).faceUp = true;
    moveFaceUpAttack(session, attacker, 0, 0);
    moveFaceUpAttack(session, defender, 1, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sinyouCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    const opponentPass = getLegalActions(session, 1).find((action) => action.type === "passAttack");
    expect(opponentPass, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, opponentPass!);
    const attackResponsePass = getLegalActions(session, 0).find((action) => action.type === "passAttack");
    expect(attackResponsePass, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, attackResponsePass!);
    const opponentDamagePass = getLegalActions(session, 1).find((action) => action.type === "passDamage");
    expect(opponentDamagePass, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, opponentDamagePass!);
    const restoredDamageStep = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredDamageStep);
    expectRestoredLegalActions(restoredDamageStep, 0);
    const activation = getLuaRestoreLegalActions(restoredDamageStep, 0).find((action) => action.type === "activateEffect" && action.uid === sinyou.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredDamageStep, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDamageStep, activation!);

    expect(restoredDamageStep.session.state.cards.find((card) => card.uid === sinyou.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: sinyou.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(findCard(restoredDamageStep.session, attacker.uid), restoredDamageStep.session.state)).toBe(2800);
    expect(restoredDamageStep.session.state.effects.filter((effect) => [effectUpdateAttack, effectChangeBattleDamage].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", property: undefined, reset: { flags: 1107169312 }, sourceUid: attacker.uid, targetRange: undefined, value: 1800 },
      { code: effectChangeBattleDamage, event: "continuous", property: 0x800, reset: { flags: 1073741856 }, sourceUid: sinyou.uid, targetRange: [0, 1], value: 2147483649 },
    ]);
    expect(restoredDamageStep.session.state.eventHistory.filter((event) => event.eventName === "banished")).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: sinyou.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: sinyou.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredBoost = restoreDuelWithLuaScripts(serializeDuel(restoredDamageStep.session), workspace, reader);
    expectCleanRestore(restoredBoost);
    expectRestoredLegalActions(restoredBoost, 0);
    passRestoredBattleResponses(restoredBoost);
    expect(restoredBoost.session.state.battleDamage).toEqual({ 0: 0, 1: 500 });
    expect(restoredBoost.session.state.players[1]!.lifePoints).toBe(7500);
    expect(restoredBoost.session.state.cards.find((card) => card.uid === defender.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredBoost.session.state.cards.find((card) => card.uid === attacker.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredBoost.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: attacker.uid,
        eventPlayer: 1,
        eventValue: 500,
        eventReason: duelReason.battle,
        eventReasonCardUid: attacker.uid,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const player = session.state.waitingFor ?? session.state.turnPlayer;
  expect(response.legalActions).toEqual(getLegalActions(session, player));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passRestoredBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
