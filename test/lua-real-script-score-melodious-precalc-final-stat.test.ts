import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const scoreCode = "41767843";
const melodiousCode = "417678430";
const defenderCode = "417678431";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasScoreScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${scoreCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const setMelodious = 0x9b;

describe.skipIf(!hasUpstreamScripts || !hasScoreScript)("Lua real script Score the Melodious Diva pre-calculation final stat", () => {
  it("restores hand SelfToGrave pre-damage Melodious battle opponent ATK/DEF final zeroing", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${scoreCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
    expect(script).toContain("e1:SetRange(LOCATION_HAND)");
    expect(script).toContain("e1:SetCost(Cost.SelfToGrave)");
    expect(script).toContain("local a=Duel.GetAttacker()");
    expect(script).toContain("local d=Duel.GetAttackTarget()");
    expect(script).toContain("if a:IsControler(1-tp) then a,d=d,a end");
    expect(script).toContain("a:IsSetCard(SET_MELODIOUS) and a:IsRelateToBattle()");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(0)");
    expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE_FINAL)");

    const cards: DuelCardData[] = [
      { code: scoreCode, name: "Score the Melodious Diva", kind: "monster", typeFlags: typeMonster | typeEffect, level: 2, attack: 200, defense: 200 },
      { code: melodiousCode, name: "Score Melodious Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setMelodious], level: 4, attack: 1200, defense: 1000 },
      { code: defenderCode, name: "Score Battle Defender", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1600 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 41767843, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [scoreCode, melodiousCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const score = requireCard(session, scoreCode);
    const attacker = requireCard(session, melodiousCode);
    const defender = requireCard(session, defenderCode);
    moveDuelCard(session.state, score.uid, "hand", 0);
    moveFaceUpAttack(session, attacker, 0);
    moveFaceUpAttack(session, defender, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(scoreCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const attack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, attack!);
    advanceToScoreActivation(restoredOpen, score.uid);
    expect(restoredOpen.session.state.battleWindow?.kind).toBe("beforeDamageCalculation");

    const scoreAction = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === score.uid);
    expect(scoreAction, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, scoreAction!);
    resolveRestoredChain(restoredOpen);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === score.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: score.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === defender.uid), restoredOpen.session.state)).toBe(0);
    expect(currentDefense(restoredOpen.session.state.cards.find((card) => card.uid === defender.uid), restoredOpen.session.state)).toBe(0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === defender.uid && [102, 106].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 102, reset: { flags: 1107169792 }, value: 0 },
      { code: 106, reset: { flags: 1107169792 }, value: 0 },
    ]);

    const restoredZeroed = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredZeroed);
    expect(currentAttack(restoredZeroed.session.state.cards.find((card) => card.uid === defender.uid), restoredZeroed.session.state)).toBe(0);
    expect(currentDefense(restoredZeroed.session.state.cards.find((card) => card.uid === defender.uid), restoredZeroed.session.state)).toBe(0);
    passRestoredBattleResponses(restoredZeroed);
    expect(restoredZeroed.session.state.battleDamage).toEqual({ 0: 0, 1: 1200 });
    expect(restoredZeroed.session.state.players[1].lifePoints).toBe(6800);
    expect(restoredZeroed.session.state.cards.find((card) => card.uid === attacker.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredZeroed.session.state.cards.find((card) => card.uid === defender.uid)).toMatchObject({ location: "graveyard", controller: 1 });
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
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

function advanceToScoreActivation(restored: ReturnType<typeof restoreDuelWithLuaScripts>, scoreUid: string): void {
  let guard = 0;
  while (!getLuaRestoreLegalActions(restored, 0).some((action) => action.type === "activateEffect" && action.uid === scoreUid)) {
    expect(++guard).toBeLessThan(20);
    passRestoredBattleStep(restored);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function passRestoredBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    passRestoredBattleStep(restored);
  }
}

function passRestoredBattleStep(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
}
