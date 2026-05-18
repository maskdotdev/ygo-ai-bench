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
const smokeMosquitoCode = "28427869";
const hasSmokeMosquitoScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${smokeMosquitoCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasSmokeMosquitoScript)("Lua real script Smoke Mosquito pre-damage battle damage halving", () => {
  it("restores pre-damage self Special Summon, temporary HALF_DAMAGE battle modifier, and battle skip", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const attackerCode = "28427870";
    const targetCode = "28427871";
    const script = workspace.readScript(`c${smokeMosquitoCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
    expect(script).toContain("Duel.GetBattleDamage(tp)>0");
    expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("e1:SetCode(EFFECT_CHANGE_BATTLE_DAMAGE)");
    expect(script).toContain("e1:SetValue(HALF_DAMAGE)");
    expect(script).toContain("e1:SetReset(RESET_PHASE|PHASE_DAMAGE)");
    expect(script).toContain("Duel.SkipPhase(Duel.GetTurnPlayer(),PHASE_BATTLE,RESET_PHASE|PHASE_BATTLE_STEP,1)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === smokeMosquitoCode),
      { code: attackerCode, name: "Smoke Mosquito Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2500, defense: 1000 },
      { code: targetCode, name: "Smoke Mosquito Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 28427869, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [smokeMosquitoCode, targetCode] }, 1: { main: [attackerCode] } });
    startDuel(session);

    const smokeMosquito = requireCard(session, smokeMosquitoCode);
    const attacker = requireCard(session, attackerCode);
    const target = requireCard(session, targetCode);
    moveDuelCard(session.state, smokeMosquito.uid, "hand", 0);
    moveFaceUpAttack(session, target, 0);
    moveFaceUpAttack(session, attacker, 1);
    session.state.turnPlayer = 1;
    session.state.phase = "battle";
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(smokeMosquitoCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 1).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === target.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    passUntilBattleWindow(session, "beforeDamageCalculation");
    expect(session.state.waitingFor).toBe(0);
    expect(session.state.eventHistory.filter((event) => event.eventName === "beforeDamageCalculation")).toEqual([
      {
        eventName: "beforeDamageCalculation",
        eventCode: 1134,
        eventCardUid: attacker.uid,
        eventPreviousState: {
          controller: 1,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventReason: 0,
        eventReasonPlayer: 1,
        eventUids: [attacker.uid, target.uid],
      },
    ]);

    const restoredPreDamage = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredPreDamage);
    expectRestoredLegalActions(restoredPreDamage, 0);
    const activation = getLuaRestoreLegalActions(restoredPreDamage, 0).find((action) => action.type === "activateEffect" && action.uid === smokeMosquito.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredPreDamage, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredPreDamage, activation!);
    expect(restoredPreDamage.session.state.battleWindow?.kind).not.toBe("replayDecision");
    expect(restoredPreDamage.session.state.cards.find((card) => card.uid === smokeMosquito.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
    });
    expect(restoredPreDamage.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === smokeMosquito.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: smokeMosquito.uid,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 1,
        },
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: smokeMosquito.uid,
        eventReasonEffectId: 1,
        eventUids: [smokeMosquito.uid],
      },
    ]);

    const restoredHalfDamage = restoreDuelWithLuaScripts(serializeDuel(restoredPreDamage.session), workspace, reader);
    expectCleanRestore(restoredHalfDamage);
    expectRestoredLegalActions(restoredHalfDamage, 1);
    expect(restoredHalfDamage.session.state.effects.find((effect) => effect.code === 208 && effect.sourceUid === smokeMosquito.uid)).toMatchObject({
      event: "continuous",
      code: 208,
      sourceUid: smokeMosquito.uid,
      property: 2048,
      targetRange: [1, 0],
      value: 2147483649,
    });
    passRestoredBattle(restoredHalfDamage, target.uid);
    expect(restoredHalfDamage.session.state.players[0].lifePoints).toBe(7250);
    expect(restoredHalfDamage.session.state.players[1].lifePoints).toBe(8000);
    expect(restoredHalfDamage.session.state.battleDamage).toEqual({ 0: 750, 1: 0 });
    expect(restoredHalfDamage.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.battle | duelReason.destroy,
      reasonCardUid: attacker.uid,
      reasonPlayer: 1,
    });
    expect(restoredHalfDamage.session.state.cards.find((card) => card.uid === smokeMosquito.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredHalfDamage.session.state.skippedPhases).toEqual([{ player: 1, phase: "battle", remaining: 1 }]);
    expect(restoredHalfDamage.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: attacker.uid,
        eventPreviousState: {
          controller: 1,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventPlayer: 0,
        eventValue: 750,
        eventReason: duelReason.battle,
        eventReasonPlayer: 1,
      },
    ]);
  });
});

function passUntilBattleWindow(session: DuelSession, kind: NonNullable<DuelSession["state"]["battleWindow"]>["kind"]): void {
  let guard = 0;
  while (session.state.battleWindow?.kind !== kind) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function passRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>, replayTargetUid?: string): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    if (restored.session.state.chain.length > 0) {
      const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
      expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
      applyLuaRestoreAndAssert(restored, pass!);
      continue;
    }
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    if (pass !== undefined) {
      applyLuaRestoreAndAssert(restored, pass);
      continue;
    }
    const replay = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "replayAttack" && action.targetUid === replayTargetUid);
    expect(replay, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, replay!);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const result = applyResponse(session, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLegalActions(session, waitingFor));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
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
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function moveFaceUpAttack(session: DuelSession, card: DuelSession["state"]["cards"][number], player: 0 | 1): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
