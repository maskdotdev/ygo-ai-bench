import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { currentAttack } from "#duel/card-stats.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import { createLuaScriptHost } from "#lua/host.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const lilyCode = "79575620";
const hasLilyScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${lilyCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasLilyScript)("Lua real script Injection Fairy Lily pre-damage LP boost", () => {
  it("restores its LP cost, damage-calculation flag, temporary ATK boost, and battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const defenderCode = "79575621";
    const script = workspace.readScript(`c${lilyCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
    expect(script).toContain("Duel.PayLPCost(tp,2000)");
    expect(script).toContain("RegisterFlagEffect(id,RESET_PHASE|PHASE_DAMAGE_CAL,0,1)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(3000)");

    const cards: DuelCardData[] = [
      { code: lilyCode, name: "Injection Fairy Lily", kind: "monster", typeFlags: typeMonster | typeEffect, level: 3, attack: 400, defense: 1500 },
      { code: defenderCode, name: "Injection Fairy Lily Defender", kind: "monster", typeFlags: typeMonster, level: 4, attack: 2000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7957, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [lilyCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const lily = requireCard(session, lilyCode);
    const defender = requireCard(session, defenderCode);
    moveFaceUpAttack(session, lily, 0);
    moveFaceUpAttack(session, defender, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(lilyCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredSetup = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredSetup);
    expectRestoredLegalActions(restoredSetup, 0);
    const attack = getLuaRestoreLegalActions(restoredSetup, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === lily.uid && action.targetUid === defender.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredSetup, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSetup, attack!);
    passRestoredBattleAction(restoredSetup, 1, "passAttack");
    passRestoredBattleAction(restoredSetup, 0, "passAttack");

    const restoredDamageStep = restoreDuelWithLuaScripts(serializeDuel(restoredSetup.session), workspace, reader);
    expectCleanRestore(restoredDamageStep);
    expectRestoredLegalActions(restoredDamageStep, 1);
    passRestoredBattleAction(restoredDamageStep, 1, "passDamage");
    expect(restoredDamageStep.session.state.battleWindow?.kind).toBe("startDamageStep");
    passRestoredBattleAction(restoredDamageStep, 0, "passDamage");
    expect(restoredDamageStep.session.state.battleWindow?.kind).toBe("beforeDamageCalculation");
    expect(restoredDamageStep.session.state.waitingFor).toBe(1);
    expect(restoredDamageStep.session.state.eventHistory.filter((event) => event.eventName === "beforeDamageCalculation")).toEqual([
      {
        eventName: "beforeDamageCalculation",
        eventCode: 1134,
        eventCardUid: lily.uid,
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
        eventReason: 0,
        eventReasonPlayer: 0,
        eventUids: [lily.uid, defender.uid],
      },
    ]);
    passRestoredBattleAction(restoredDamageStep, 1, "passDamage");
    expect(restoredDamageStep.session.state.waitingFor).toBe(0);

    const activation = getLuaRestoreLegalActions(restoredDamageStep, 0).find((action) => action.type === "activateEffect" && action.uid === lily.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredDamageStep, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDamageStep, activation!);
    expect(restoredDamageStep.session.state.players[0].lifePoints).toBe(6000);
    expect(restoredDamageStep.session.state.eventHistory.filter((event) => event.eventName === "lifePointCostPaid")).toEqual([
      {
        eventName: "lifePointCostPaid",
        eventCode: 1201,
        eventPlayer: 0,
        eventValue: 2000,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: lily.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(restoredDamageStep.session.state.flagEffects).toEqual([
      {
        ownerType: "card",
        ownerId: lily.uid,
        code: Number(lilyCode),
        reset: 1073741888,
        resetCount: 1,
        property: 0,
        value: 0,
        turn: 1,
      },
    ]);
    expect(restoredDamageStep.session.state.chain).toHaveLength(0);
    const boostedLily = restoredDamageStep.session.state.cards.find((card) => card.uid === lily.uid);
    expect(currentAttack(boostedLily, restoredDamageStep.session.state)).toBe(3400);
    expect(
      getLuaRestoreLegalActions(restoredDamageStep, 0).filter((action) => action.type === "activateEffect" && action.uid === lily.uid),
    ).toHaveLength(0);

    const restoredBoost = restoreDuelWithLuaScripts(serializeDuel(restoredDamageStep.session), workspace, reader);
    expectCleanRestore(restoredBoost);
    expect(currentAttack(restoredBoost.session.state.cards.find((card) => card.uid === lily.uid), restoredBoost.session.state)).toBe(3400);
    passBattleResponses(restoredBoost);
    expect(restoredBoost.session.state.battleDamage).toEqual({ 0: 0, 1: 1400 });
    expect(restoredBoost.session.state.players[0].lifePoints).toBe(6000);
    expect(restoredBoost.session.state.players[1].lifePoints).toBe(6600);
    expect(restoredBoost.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: lily.uid,
        eventPlayer: 1,
        eventValue: 1400,
        eventReason: duelReason.battle,
        eventReasonCardUid: lily.uid,
        eventReasonPlayer: 0,
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
    expect(restoredBoost.session.state.cards.find((card) => card.uid === lily.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(currentAttack(restoredBoost.session.state.cards.find((card) => card.uid === lily.uid), restoredBoost.session.state)).toBe(400);
    expect(restoredBoost.session.state.flagEffects).toEqual([]);
  });
});

function moveFaceUpAttack(session: DuelSession, card: DuelSession["state"]["cards"][number], player: 0 | 1): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function passRestoredBattleAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1, type: "passAttack" | "passDamage"): void {
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === type);
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
}

function passBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    if (restored.session.state.chain.length > 0) {
      passRestoredChain(restored, player);
      continue;
    }
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    passRestoredBattleAction(restored, player, passType);
  }
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

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
