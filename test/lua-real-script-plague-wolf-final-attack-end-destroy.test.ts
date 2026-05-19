import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelResponse, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const effectDestroyReason = duelReason.effect | duelReason.destroy;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Plague Wolf final attack End Phase destroy", () => {
  it("restores final ATK doubling through battle damage and the delayed self-destroy trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const plagueWolfCode = "55696885";
    const defenderCode = "556968850";
    const script = workspace.readScript(`c${plagueWolfCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e1:SetValue(c:GetBaseAttack()*2)");
    expect(script).toContain("e2:SetCode(EVENT_PHASE+PHASE_END)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,e:GetHandler(),1,0,0)");
    expect(script).toContain("Duel.Destroy(c,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === plagueWolfCode),
      { code: defenderCode, name: "Plague Wolf Battle Defender", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1500 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 5569, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [plagueWolfCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const plagueWolf = requireCard(session, plagueWolfCode);
    const defender = requireCard(session, defenderCode);
    moveDuelCard(session.state, plagueWolf.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, defender.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(plagueWolfCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(currentAttack(plagueWolf, session.state)).toBe(1000);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    expect(getLuaRestoreLegalActions(restoredActivation, 0)).toEqual(getDuelLegalActions(restoredActivation.session, 0));
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === plagueWolf.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activation!);
    resolveRestoredChain(restoredActivation);
    assertBoostedPlagueWolf(restoredActivation, plagueWolf.uid);
    expect(restoredActivation.session.state.effects.filter((effect) => effect.event === "continuous" && effect.code === 102 && effect.sourceUid === plagueWolf.uid)).toMatchObject([
      {
        code: 102,
        event: "continuous",
        sourceUid: plagueWolf.uid,
        value: 2000,
      },
    ]);
    expect(restoredActivation.session.state.effects.filter((effect) => effect.event === "trigger" && effect.triggerEvent === "phaseEnd" && effect.sourceUid === plagueWolf.uid)).toEqual([
      expect.objectContaining({
        code: 0x1200,
        countLimit: 1,
        registryKey: `lua:${plagueWolfCode}:lua-3-4608`,
        reset: { flags: 0x41fe1200 },
        triggerCode: 0x1200,
        triggerEvent: "phaseEnd",
      }),
    ]);

    const restoredBoost = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), workspace, reader);
    expectCleanRestore(restoredBoost);
    expectRestoredLegalActions(restoredBoost, 0);
    assertBoostedPlagueWolf(restoredBoost, plagueWolf.uid);
    restoredBoost.session.state.phase = "battle";
    restoredBoost.session.state.waitingFor = 0;
    const attack = getLuaRestoreLegalActions(restoredBoost, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === plagueWolf.uid && action.targetUid === defender.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBoost, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredBoost, attack!);
    passRestoredBattleResponses(restoredBoost);
    expect(restoredBoost.session.state.battleDamage).toEqual({ 0: 0, 1: 500 });
    expect(restoredBoost.session.state.players[1].lifePoints).toBe(7500);
    expect(restoredBoost.session.state.cards.find((card) => card.uid === defender.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredBoost.session.state.cards.find((card) => card.uid === plagueWolf.uid)).toMatchObject({ location: "monsterZone", controller: 0 });

    const restoredEnd = restoreDuelWithLuaScripts(serializeDuel(restoredBoost.session), workspace, reader);
    expectCleanRestore(restoredEnd);
    expectRestoredLegalActions(restoredEnd, 0);
    assertBoostedPlagueWolf(restoredEnd, plagueWolf.uid);
    restoredEnd.session.state.phase = "main2";
    restoredEnd.session.state.waitingFor = 0;
    const endPhase = getLuaRestoreLegalActions(restoredEnd, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(endPhase, JSON.stringify(getLuaRestoreLegalActions(restoredEnd, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEnd, endPhase!);
    expect(restoredEnd.session.state.eventHistory.filter((event) => event.eventName === "phaseEnd")).toEqual([{ eventName: "phaseEnd", eventCode: 0x1200 }]);
    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredEnd.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === plagueWolf.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    expect(trigger).toMatchObject({ type: "activateTrigger", triggerBucket: "turnMandatory", uid: plagueWolf.uid });
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === plagueWolf.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: effectDestroyReason,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === plagueWolf.uid)).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: plagueWolf.uid,
        eventPreviousState: {
          location: "monsterZone",
          controller: 0,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventCurrentState: {
          location: "graveyard",
          controller: 0,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventReason: effectDestroyReason,
        eventReasonPlayer: 0,
        eventReasonCardUid: plagueWolf.uid,
        eventReasonEffectId: 3,
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function assertBoostedPlagueWolf(restored: ReturnType<typeof restoreDuelWithLuaScripts>, plagueWolfUid: string): void {
  const plagueWolf = restored.session.state.cards.find((card) => card.uid === plagueWolfUid);
  expect(currentAttack(plagueWolf, restored.session.state)).toBe(2000);
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

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
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
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
