import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const scorpionCode = "14261867";
const defenderCode = "142618670";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasScorpionScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${scorpionCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceInsect = 0x800;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasScorpionScript)("Lua real script 8-Claws Scorpion turn-set pre-damage stat", () => {
  it("restores ignition turn-set and mandatory face-down-defense pre-damage final ATK", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${scorpionCode}.lua`));
    const reader = createCardReader(cards());

    const setSession = createDuel({ seed: 14261867, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(setSession, { 0: { main: [scorpionCode] }, 1: { main: [] } });
    startDuel(setSession);
    const setScorpion = requireCard(setSession, scorpionCode);
    moveFaceUpAttack(setSession, setScorpion, 0, 0);
    setSession.state.phase = "main1";
    setSession.state.turnPlayer = 0;
    setSession.state.waitingFor = 0;

    const setHost = createLuaScriptHost(setSession, workspace);
    expect(setHost.loadCardScript(Number(scorpionCode), workspace).ok).toBe(true);
    expect(setHost.registerInitialEffects()).toBe(1);

    const restoredSetOpen = restoreDuelWithLuaScripts(serializeDuel(setSession), workspace, reader);
    expectCleanRestore(restoredSetOpen);
    expectRestoredLegalActions(restoredSetOpen, 0);
    const turnSet = getLuaRestoreLegalActions(restoredSetOpen, 0).find((action) => action.type === "activateEffect" && action.uid === setScorpion.uid && action.effectId === "lua-1");
    expect(turnSet, JSON.stringify(getLuaRestoreLegalActions(restoredSetOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSetOpen, turnSet!);
    expect(restoredSetOpen.session.state.cards.find((card) => card.uid === setScorpion.uid)).toMatchObject({ location: "monsterZone", position: "faceDownDefense", faceUp: false });
    expect(restoredSetOpen.session.state.eventHistory.filter((event) => event.eventName === "positionChanged")).toEqual([
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: setScorpion.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: setScorpion.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "monsterZone", position: "faceDownDefense", sequence: 0 },
      },
    ]);

    const restoredSetAfterResolution = restoreDuelWithLuaScripts(serializeDuel(restoredSetOpen.session), workspace, reader);
    expectCleanRestore(restoredSetAfterResolution);
    expectRestoredLegalActions(restoredSetAfterResolution, 0);

    const battleSession = createDuel({ seed: 14261868, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(battleSession, { 0: { main: [scorpionCode] }, 1: { main: [defenderCode] } });
    startDuel(battleSession);
    const battleScorpion = requireCard(battleSession, scorpionCode);
    const defender = requireCard(battleSession, defenderCode);
    moveFaceUpAttack(battleSession, battleScorpion, 0, 0);
    moveFaceDownDefense(battleSession, defender, 1, 0);
    battleSession.state.phase = "battle";
    battleSession.state.turnPlayer = 0;
    battleSession.state.waitingFor = 0;

    const battleHost = createLuaScriptHost(battleSession, workspace);
    expect(battleHost.loadCardScript(Number(scorpionCode), workspace).ok).toBe(true);
    expect(battleHost.registerInitialEffects()).toBe(1);

    const restoredBattleOpen = restoreDuelWithLuaScripts(serializeDuel(battleSession), workspace, reader);
    expectCleanRestore(restoredBattleOpen);
    expectRestoredLegalActions(restoredBattleOpen, 0);
    const attack = getLuaRestoreLegalActions(restoredBattleOpen, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === battleScorpion.uid && action.targetUid === defender.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattleOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattleOpen, attack!);
    passRestoredUntilPendingTrigger(restoredBattleOpen);
    expect(restoredBattleOpen.session.state.battleWindow?.kind).toBe("beforeDamageCalculation");
    expect(restoredBattleOpen.session.state.pendingBattle).toMatchObject({ attackerUid: battleScorpion.uid, targetUid: defender.uid });

    const restoredPreDamage = restoreDuelWithLuaScripts(serializeDuel(restoredBattleOpen.session), workspace, reader);
    expectCleanRestore(restoredPreDamage);
    expectRestoredLegalActions(restoredPreDamage, 0);
    expect(restoredPreDamage.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-2-1134",
        sourceUid: battleScorpion.uid,
        player: 0,
        triggerBucket: "turnMandatory",
        eventName: "beforeDamageCalculation",
        eventCode: 1134,
        eventPlayer: 0,
        eventCardUid: battleScorpion.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventUids: [battleScorpion.uid, defender.uid],
      },
    ]);
    const preDamage = getLuaRestoreLegalActions(restoredPreDamage, 0).find((action) => action.type === "activateTrigger" && action.uid === battleScorpion.uid && action.effectId === "lua-2-1134");
    expect(preDamage, JSON.stringify(getLuaRestoreLegalActions(restoredPreDamage, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPreDamage, preDamage!);
    expect(restoredPreDamage.session.state.effects.filter((effect) => effect.event === "continuous" && effect.code === 102 && effect.sourceUid === battleScorpion.uid).map((effect) => ({
      code: effect.code,
      range: effect.range,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 102, range: ["monsterZone"], reset: { flags: 1073741888 }, value: 2400 },
    ]);
    expect(currentAttack(restoredPreDamage.session.state.cards.find((card) => card.uid === battleScorpion.uid), restoredPreDamage.session.state)).toBe(2400);
    expect(restoredPreDamage.session.state.eventHistory.filter((event) => event.eventName === "beforeDamageCalculation")).toEqual([
      {
        eventName: "beforeDamageCalculation",
        eventCode: 1134,
        eventCardUid: battleScorpion.uid,
        eventUids: [battleScorpion.uid, defender.uid],
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredPreDamage.session), workspace, reader);
    expectCleanRestore(restoredStat);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === battleScorpion.uid), restoredStat.session.state)).toBe(2400);
    finishRestoredBattle(restoredStat);
    expect(restoredStat.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_POSITION+CATEGORY_SET)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("c:IsCanTurnSet() and c:GetFlagEffect(id)==0");
  expect(script).toContain("c:RegisterFlagEffect(id,RESET_EVENT|(RESETS_STANDARD_PHASE_END&~RESET_TURN_SET),0,1)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_POSITION,c,1,tp,POS_FACEDOWN_DEFENSE)");
  expect(script).toContain("Duel.ChangePosition(c,POS_FACEDOWN_DEFENSE)");
  expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e2:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("bc:GetBattlePosition()==POS_FACEDOWN_DEFENSE");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetReset(RESET_PHASE|PHASE_DAMAGE_CAL)");
  expect(script).toContain("e1:SetValue(2400)");
}

function cards(): DuelCardData[] {
  return [
    { code: scorpionCode, name: "8-Claws Scorpion", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceInsect, attribute: attributeEarth, level: 2, attack: 300, defense: 200 },
    { code: defenderCode, name: "8-Claws Scorpion Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceInsect, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
}

function moveFaceDownDefense(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = false;
  moved.position = "faceDownDefense";
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

function passRestoredUntilPendingTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    passRestoredBattleStep(restored);
  }
}

function finishRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.currentAttack || restored.session.state.battleWindow || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(30);
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
