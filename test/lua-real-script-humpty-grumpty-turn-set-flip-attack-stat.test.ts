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
const humptyCode = "71415349";
const defenderCode = "714153490";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasHumptyScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${humptyCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const attributeDark = 0x10;
const raceZombie = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasHumptyScript)("Lua real script Humpty Grumpty turn-set flip attack stat", () => {
  it("restores ignition turn-set, flip-summon ATK gain, and boosted battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${humptyCode}.lua`));
    const reader = createCardReader(cards());

    const setSession = createDuel({ seed: 71415349, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(setSession, { 0: { main: [humptyCode] }, 1: { main: [] } });
    startDuel(setSession);
    const setHumpty = requireCard(setSession, humptyCode);
    moveFaceUpAttack(setSession, setHumpty, 0, 0);
    setSession.state.phase = "main1";
    setSession.state.turnPlayer = 0;
    setSession.state.waitingFor = 0;

    const setHost = createLuaScriptHost(setSession, workspace);
    expect(setHost.loadCardScript(Number(humptyCode), workspace).ok).toBe(true);
    expect(setHost.registerInitialEffects()).toBe(1);

    const restoredSetOpen = restoreDuelWithLuaScripts(serializeDuel(setSession), workspace, reader);
    expectCleanRestore(restoredSetOpen);
    expectRestoredLegalActions(restoredSetOpen, 0);
    const turnSet = getLuaRestoreLegalActions(restoredSetOpen, 0).find((action) => action.type === "activateEffect" && action.uid === setHumpty.uid && action.effectId === "lua-1");
    expect(turnSet, JSON.stringify(getLuaRestoreLegalActions(restoredSetOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSetOpen, turnSet!);
    expect(restoredSetOpen.session.state.chain).toEqual([]);
    expect(restoredSetOpen.session.state.cards.find((card) => card.uid === setHumpty.uid)).toMatchObject({ location: "monsterZone", position: "faceDownDefense", faceUp: false });
    expect(restoredSetOpen.session.state.eventHistory.filter((event) => event.eventName === "positionChanged")).toEqual([
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: setHumpty.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: setHumpty.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "monsterZone", position: "faceDownDefense", sequence: 0 },
      },
    ]);
    const restoredSetAfterResolution = restoreDuelWithLuaScripts(serializeDuel(restoredSetOpen.session), workspace, reader);
    expectCleanRestore(restoredSetAfterResolution);
    expectRestoredLegalActions(restoredSetAfterResolution, 0);

    const flipSession = createDuel({ seed: 71415350, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(flipSession, { 0: { main: [humptyCode] }, 1: { main: [defenderCode] } });
    startDuel(flipSession);
    const flipHumpty = requireCard(flipSession, humptyCode);
    const defender = requireCard(flipSession, defenderCode);
    moveFaceDownDefense(flipSession, flipHumpty, 0, 0);
    moveFaceUpAttack(flipSession, defender, 1, 0);
    flipSession.state.phase = "main1";
    flipSession.state.turnPlayer = 0;
    flipSession.state.waitingFor = 0;

    const flipHost = createLuaScriptHost(flipSession, workspace);
    expect(flipHost.loadCardScript(Number(humptyCode), workspace).ok).toBe(true);
    expect(flipHost.registerInitialEffects()).toBe(1);

    const restoredFlipOpen = restoreDuelWithLuaScripts(serializeDuel(flipSession), workspace, reader);
    expectCleanRestore(restoredFlipOpen);
    expectRestoredLegalActions(restoredFlipOpen, 0);
    const flip = getLuaRestoreLegalActions(restoredFlipOpen, 0).find((action) => action.type === "flipSummon" && action.uid === flipHumpty.uid);
    expect(flip, JSON.stringify(getLuaRestoreLegalActions(restoredFlipOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredFlipOpen, flip!);
    expect(restoredFlipOpen.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-2-1101",
        sourceUid: flipHumpty.uid,
        player: 0,
        triggerBucket: "turnMandatory",
        eventName: "flipSummoned",
        eventCode: 1101,
        eventPlayer: 0,
        eventCardUid: flipHumpty.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredFlipTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredFlipOpen.session), workspace, reader);
    expectCleanRestore(restoredFlipTrigger);
    expectRestoredLegalActions(restoredFlipTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredFlipTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === flipHumpty.uid && action.effectId === "lua-2-1101");
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredFlipTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredFlipTrigger, trigger!);
    expect(restoredFlipTrigger.session.state.chain).toEqual([]);
    expect(restoredFlipTrigger.session.state.effects.filter((effect) => effect.event === "continuous" && effect.code === 100 && effect.sourceUid === flipHumpty.uid).map((effect) => ({
      code: effect.code,
      range: effect.range,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, range: ["monsterZone"], reset: { flags: 1107235328 }, value: 800 },
    ]);
    expect(currentAttack(restoredFlipTrigger.session.state.cards.find((card) => card.uid === flipHumpty.uid), restoredFlipTrigger.session.state)).toBe(1800);
    expect(restoredFlipTrigger.session.state.eventHistory.filter((event) => event.eventName === "flipSummoned")).toEqual([
      {
        eventName: "flipSummoned",
        eventCode: 1101,
        eventCardUid: flipHumpty.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredFlipTrigger.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.turnPlayer = 0;
    restoredBattle.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredBattle, 0);
    expect(currentAttack(restoredBattle.session.state.cards.find((card) => card.uid === flipHumpty.uid), restoredBattle.session.state)).toBe(1800);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "declareAttack" && action.attackerUid === flipHumpty.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    finishRestoredBattle(restoredBattle);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 800 });
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
  expect(script).toContain("e2:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e2:SetCode(EVENT_FLIP_SUMMON_SUCCESS)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(800)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END)");
}

function cards(): DuelCardData[] {
  return [
    { code: humptyCode, name: "Humpty Grumpty", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeDark, level: 3, attack: 1000, defense: 1000 },
    { code: defenderCode, name: "Humpty Grumpty Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceZombie, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
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

function finishRestoredBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.currentAttack || restored.session.state.battleWindow || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
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
