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
const primalCode = "64025981";
const dragonCostCode = "640259810";
const defenderCode = "640259811";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasPrimalScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${primalCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceDragon = 0x2000;
const raceWarrior = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasPrimalScript)("Lua real script Primal Dragon banish stat no damage", () => {
  it("restores Dragon banish cost into two-turn stat gain and no battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${primalCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_NO_BATTLE_DAMAGE)");
    expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DEFCHANGE)");
    expect(script).toContain("return c:IsRace(RACE_DRAGON) and c:GetBaseAttack()>0 and c:IsAbleToRemoveAsCost() and aux.SpElimFilter(c,true)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,1,e:GetHandler())");
    expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
    expect(script).toContain("e:SetLabel(g:GetFirst():GetBaseAttack())");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(e:GetLabel())");
    expect(script).toContain("e1:SetReset(RESET_PHASE|PHASE_END,2)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e3:SetCode(EVENT_RELEASE)");
    expect(script).toContain("Duel.IsAbleToEnterBP() or Duel.IsBattlePhase()");
    expect(script).toContain("e1:SetCode(EFFECT_EXTRA_ATTACK)");

    const cards: DuelCardData[] = [
      { code: primalCode, name: "Primal Dragon, the Primordial", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, level: 4, attack: 2000, defense: 2000 },
      { code: dragonCostCode, name: "Primal Dragon Grave Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, level: 4, attack: 1200, defense: 700 },
      { code: defenderCode, name: "Primal Dragon Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 2500, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 64025981, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [primalCode, dragonCostCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const primal = requireCard(session, primalCode);
    const dragonCost = requireCard(session, dragonCostCode);
    const defender = requireCard(session, defenderCode);
    moveFaceUpAttack(session, primal, 0);
    moveDuelCard(session.state, dragonCost.uid, "graveyard", 0);
    moveFaceUpAttack(session, defender, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(primalCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.find((effect) => effect.sourceUid === primal.uid && effect.code === 200)).toMatchObject({
      code: 200,
      event: "continuous",
      sourceUid: primal.uid,
    });
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === primal.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    passRestoredChain(restoredOpen);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(restoredResolved.session.state.cards.find((card) => card.uid === dragonCost.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: primal.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === primal.uid), restoredResolved.session.state)).toBe(3200);
    expect(currentDefense(restoredResolved.session.state.cards.find((card) => card.uid === primal.uid), restoredResolved.session.state)).toBe(3200);
    expect(restoredResolved.session.state.effects.filter((effect) => effect.sourceUid === primal.uid && [100, 104, 200].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 200, reset: undefined, value: undefined },
      { code: 100, reset: { count: 2, flags: 1073742336 }, value: 1200 },
      { code: 104, reset: { count: 2, flags: 1073742336 }, value: 1200 },
    ]);
    expect(restoredResolved.session.state.eventHistory.filter((event) => event.eventName === "banished" && event.eventCardUid === dragonCost.uid).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      {
        eventName: "banished",
        eventCardUid: dragonCost.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: primal.uid,
        eventReasonEffectId: 2,
      },
    ]);
    expect(restoredResolved.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredResolved.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.waitingFor = 0;
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === primal.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    finishBattle(restoredBattle);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredBattle.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([]);
    expect(restoredBattle.session.state.players[0].lifePoints).toBe(8000);
    expect(restoredBattle.session.state.players[1].lifePoints).toBe(8000);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === defender.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.battle | duelReason.destroy,
    });
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function finishBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    if (restored.session.state.chain.length > 0) {
      passRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
