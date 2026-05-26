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
const cyberOgreCode = "64268668";
const defenderCode = "642686680";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCyberOgreScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${cyberOgreCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceMachine = 0x20;
const raceWarrior = 0x1;
const effectUpdateAttack = 100;
const eventDamageStepEnd = 1141;
const eventAttackDisabled = 1142;

describe.skipIf(!hasUpstreamScripts || !hasCyberOgreScript)("Lua real script Cyber Ogre hand battle negate stat reset", () => {
  it("restores hand Quick Effect discard into attack negation, +2000 ATK, and Damage Step End cleanup watcher", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${cyberOgreCode}.lua`);
    expect(script).toContain("--Cyber Ogre");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e1:SetHintTiming(TIMING_BATTLE_PHASE)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("e1:SetRange(LOCATION_HAND)");
    expect(script).toContain("local a=Duel.GetAttacker()");
    expect(script).toContain("local d=Duel.GetAttackTarget()");
    expect(script).toContain("return Duel.IsBattlePhase()");
    expect(script).toContain("Duel.SendtoGrave(e:GetHandler(),REASON_COST|REASON_DISCARD)");
    expect(script).toContain("Duel.SetTargetCard(a)");
    expect(script).toContain("Duel.NegateAttack()");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(2000)");
    expect(script).toContain("e2:SetCode(EVENT_DAMAGE_STEP_END)");
    expect(script).toContain("e2:SetLabelObject(e1)");
    expect(script).toContain("e:GetLabelObject():Reset()");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 64268668, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [cyberOgreCode, cyberOgreCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.code === cyberOgreCode && card.owner === 0 && card.location === "deck");
    const handOgre = session.state.cards.find((card) => card.code === cyberOgreCode && card.owner === 0 && card.location === "deck" && card.uid !== attacker?.uid);
    const defender = requireCard(session, defenderCode);
    expect(attacker).toBeDefined();
    expect(handOgre).toBeDefined();
    moveFaceUpAttack(session, attacker!, 0, 0);
    moveDuelCard(session.state, handOgre!.uid, "hand", 0);
    moveFaceUpAttack(session, defender, 1, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    const loaded = host.loadCardScript(Number(cyberOgreCode), workspace);
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const attack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, attack!);

    const restoredResponse = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResponse);
    expectRestoredLegalActions(restoredResponse, 1);
    const opponentPass = getLuaRestoreLegalActions(restoredResponse, 1).find((action) => action.type === "passAttack");
    expect(opponentPass, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredResponse, opponentPass!);
    expectRestoredLegalActions(restoredResponse, 0);
    const activate = getLuaRestoreLegalActions(restoredResponse, 0).find((action) => action.type === "activateEffect" && action.uid === handOgre!.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredResponse, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredResponse, activate!);
    resolveRestoredChain(restoredResponse);

    expect(restoredResponse.session.state.cards.find((card) => card.uid === handOgre!.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: handOgre!.uid,
      reasonEffectId: 2,
    });
    expect(restoredResponse.session.state.eventHistory.filter((event) => event.eventName === "attackDisabled").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: attacker!.uid, eventCode: eventAttackDisabled, eventName: "attackDisabled", eventReason: duelReason.effect, eventReasonCardUid: handOgre!.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
    ]);
    expect(currentAttack(restoredResponse.session.state.cards.find((card) => card.uid === attacker!.uid), restoredResponse.session.state)).toBe(3900);
    expect(restoredResponse.session.state.effects.filter((effect) => effect.sourceUid === attacker!.uid && [effectUpdateAttack, eventDamageStepEnd].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      labelObjectId: effect.labelObjectId,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", labelObjectId: undefined, reset: { flags: 33427456 }, sourceUid: attacker!.uid, value: 2000 },
      { code: eventDamageStepEnd, event: "continuous", labelObjectId: 3, reset: { flags: 33427456 }, sourceUid: attacker!.uid, value: undefined },
    ]);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredResponse.session), workspace, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === attacker!.uid), restoredStat.session.state)).toBe(3900);
    passBattleWindow(restoredStat);
    expect(restoredStat.session.state.eventHistory.filter((event) => event.eventName === "damageStepEnded")).toEqual([]);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === attacker!.uid), restoredStat.session.state)).toBe(3900);
    expect(restoredStat.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: cyberOgreCode, name: "Cyber Ogre", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, level: 5, attack: 1900, defense: 1200 },
    { code: defenderCode, name: "Cyber Ogre Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1600, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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

function passBattleWindow(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle !== undefined || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.chain.length > 0 ? "passChain" : restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify({ passType, battleStep: restored.session.state.battleStep, actions: getLuaRestoreLegalActions(restored, player) }, null, 2)).toBeDefined();
    const response = applyResponse(restored.session, pass!);
    expect(response.ok, response.error).toBe(true);
    expect(response.legalActions).toEqual(getLegalActions(restored.session, response.state.waitingFor!));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}
