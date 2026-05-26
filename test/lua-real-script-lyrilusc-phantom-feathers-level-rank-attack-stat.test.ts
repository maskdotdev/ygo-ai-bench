import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentLevel, currentRank } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const feathersCode = "8243121";
const lyriluscTargetCode = "82431210";
const opponentLevelCode = "82431211";
const opponentXyzCode = "82431212";
const graveFeathersCode = "8243121";
const graveDefenderCode = "82431213";
const graveAttackerCode = "82431214";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasFeathersScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${feathersCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceWingedBeast = 0x80;
const raceWarrior = 0x1;
const attributeWind = 0x10;
const attributeDark = 0x20;
const setLyrilusc = 0xf7;
const effectSetAttackFinal = 102;
const effectChangeLevel = 131;
const effectChangeRank = 133;

describe.skipIf(!hasUpstreamScripts || !hasFeathersScript)("Lua real script Lyrilusc Phantom Feathers level rank attack stat", () => {
  it("restores activation Level/Rank final ATK changes and grave attack-announcement ATK copy", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${feathersCode}.lua`));
    const reader = createCardReader(cards());

    const restoredActivation = createRestoredActivationWindow({ reader, workspace });
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    const feathers = requireCard(restoredActivation.session, feathersCode);
    const lyriluscTarget = requireCard(restoredActivation.session, lyriluscTargetCode);
    const opponentLevel = requireCard(restoredActivation.session, opponentLevelCode);
    const opponentXyz = requireCard(restoredActivation.session, opponentXyzCode);
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === feathers.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredActivation, activation!);
    passRestoredChain(restoredActivation);

    expect(restoredActivation.session.state.cards.find((card) => card.uid === feathers.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(currentAttack(restoredActivation.session.state.cards.find((card) => card.uid === opponentLevel.uid), restoredActivation.session.state)).toBe(900);
    expect(currentLevel(restoredActivation.session.state.cards.find((card) => card.uid === opponentLevel.uid), restoredActivation.session.state)).toBe(1);
    expect(currentAttack(restoredActivation.session.state.cards.find((card) => card.uid === opponentXyz.uid), restoredActivation.session.state)).toBe(900);
    expect(currentRank(restoredActivation.session.state.cards.find((card) => card.uid === opponentXyz.uid), restoredActivation.session.state)).toBe(1);
    expect(restoredActivation.session.state.effects.filter((effect) => [opponentLevel.uid, opponentXyz.uid].includes(effect.sourceUid ?? "") && [effectSetAttackFinal, effectChangeLevel, effectChangeRank].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, event: "continuous", reset: { flags: 33427456 }, sourceUid: opponentLevel.uid, value: 900 },
      { code: effectChangeLevel, event: "continuous", reset: { flags: 33427456 }, sourceUid: opponentLevel.uid, value: 1 },
      { code: effectSetAttackFinal, event: "continuous", reset: { flags: 33427456 }, sourceUid: opponentXyz.uid, value: 900 },
      { code: effectChangeRank, event: "continuous", reset: { flags: 33427456 }, sourceUid: opponentXyz.uid, value: 1 },
    ]);
    expect(restoredActivation.session.state.eventHistory.filter((event) => event.eventName === "becameTarget")).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: lyriluscTarget.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredBattle = createRestoredBattleWindow({ reader, workspace });
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 1);
    const graveFeathers = requireCard(restoredBattle.session, graveFeathersCode);
    const graveDefender = requireCard(restoredBattle.session, graveDefenderCode);
    const graveAttacker = requireCard(restoredBattle.session, graveAttackerCode);
    const attack = getLuaRestoreLegalActions(restoredBattle, 1).find((action) => action.type === "declareAttack" && action.attackerUid === graveAttacker.uid && action.targetUid === graveDefender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredTriggerWindow);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    expect(restoredTriggerWindow.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-2-1130",
        sourceUid: graveFeathers.uid,
        player: 0,
        triggerBucket: "opponentOptional",
        eventName: "attackDeclared",
        eventCode: 1130,
        eventCardUid: graveAttacker.uid,
        eventReason: 0,
        eventReasonPlayer: 1,
        eventPlayer: 1,
        eventTriggerTiming: "when",
        eventUids: [graveAttacker.uid, graveDefender.uid],
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === graveFeathers.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);
    passRestoredChain(restoredTriggerWindow);

    expect(restoredTriggerWindow.session.state.cards.find((card) => card.uid === graveFeathers.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: graveFeathers.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredTriggerWindow.session.state.cards.find((card) => card.uid === graveDefender.uid), restoredTriggerWindow.session.state)).toBe(2400);
    expect(restoredTriggerWindow.session.state.effects.filter((effect) => effect.sourceUid === graveDefender.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, event: "continuous", reset: { flags: 1107169792 }, sourceUid: graveDefender.uid, value: 2400 },
    ]);
    expect(restoredTriggerWindow.session.state.eventHistory.filter((event) => ["attackDeclared", "banished"].includes(event.eventName))).toEqual([
      {
        eventName: "attackDeclared",
        eventCode: 1130,
        eventCardUid: graveAttacker.uid,
        eventReason: 0,
        eventReasonPlayer: 1,
        eventUids: [graveAttacker.uid, graveDefender.uid],
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: graveFeathers.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: graveFeathers.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
      },
    ]);
    expect(restoredTriggerWindow.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredActivationWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 8243121, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [feathersCode, lyriluscTargetCode] }, 1: { main: [opponentLevelCode], extra: [opponentXyzCode] } });
  startDuel(session);
  const setFeathers = moveDuelCard(session.state, requireCard(session, feathersCode).uid, "spellTrapZone", 0);
  setFeathers.faceUp = false;
  setFeathers.position = "faceDown";
  setFeathers.turnId = 0;
  moveFaceUpAttack(session, requireCard(session, lyriluscTargetCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, opponentLevelCode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, opponentXyzCode), 1, 1);
  session.state.phase = "main1";
  session.state.turn = 1;
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(feathersCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);

  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredBattleWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 8243122, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [graveFeathersCode, graveDefenderCode] }, 1: { main: [graveAttackerCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, graveFeathersCode).uid, "graveyard", 0).faceUp = true;
  moveFaceUpAttack(session, requireCard(session, graveDefenderCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, graveAttackerCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(feathersCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);

  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_LVCHANGE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsFaceup,tp,0,LOCATION_MZONE,1,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,s.atkfilter1,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(tc:GetAttack())");
  expect(script).toContain("e2:SetCode(EFFECT_CHANGE_LEVEL)");
  expect(script).toContain("e3:SetCode(EFFECT_CHANGE_RANK)");
  expect(script).toContain("e2:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("local a=Duel.GetAttacker()");
  expect(script).toContain("local d=Duel.GetAttackTarget()");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("Duel.GetAttacker():CreateEffectRelation(e)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(a:GetAttack())");
}

function cards(): DuelCardData[] {
  return [
    { code: feathersCode, name: "Lyrilusc - Phantom Feathers", kind: "trap", typeFlags: typeTrap },
    { code: lyriluscTargetCode, name: "Phantom Feathers Lyrilusc Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWingedBeast, attribute: attributeWind, level: 1, attack: 900, defense: 100, setcodes: [setLyrilusc] },
    { code: opponentLevelCode, name: "Phantom Feathers Level Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 2000, defense: 1000 },
    { code: opponentXyzCode, name: "Phantom Feathers Rank Target", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceWarrior, attribute: attributeDark, level: 4, attack: 2200, defense: 1000 },
    { code: graveDefenderCode, name: "Phantom Feathers Lyrilusc Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWingedBeast, attribute: attributeWind, level: 1, attack: 500, defense: 100, setcodes: [setLyrilusc] },
    { code: graveAttackerCode, name: "Phantom Feathers Opponent Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 2400, defense: 1000 },
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
