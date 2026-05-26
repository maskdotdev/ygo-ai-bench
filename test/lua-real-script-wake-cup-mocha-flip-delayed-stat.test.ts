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
const mochaCode = "91818544";
const defenderCode = "918185440";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMochaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${mochaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFlip = 0x200000;
const racePsychic = 0x40;
const raceWarrior = 0x1;
const attributeWater = 0x8;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasMochaScript)("Lua real script WAKE CUP! Mocha flip delayed stat", () => {
  it("restores flip target ATK gain, delayed End Phase send, and battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${mochaCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 91818544, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [mochaCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const mocha = requireCard(session, mochaCode);
    const defender = requireCard(session, defenderCode);
    moveFaceDownDefense(session, mocha, 0, 0);
    moveFaceUpAttack(session, defender, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(mochaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredFlipOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredFlipOpen);
    expectRestoredLegalActions(restoredFlipOpen, 0);
    const flip = getLuaRestoreLegalActions(restoredFlipOpen, 0).find((action) => action.type === "flipSummon" && action.uid === mocha.uid);
    expect(flip, JSON.stringify(getLuaRestoreLegalActions(restoredFlipOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredFlipOpen, flip!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredFlipOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-1-1001",
        eventCardUid: mocha.uid,
        eventCode: 1001,
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventName: "flipSummoned",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        player: 0,
        sourceUid: mocha.uid,
        triggerBucket: "turnOptional",
      },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === mocha.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);

    const restoredBoost = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredBoost);
    expectRestoredLegalActions(restoredBoost, restoredBoost.session.state.waitingFor ?? restoredBoost.session.state.turnPlayer);
    resolveRestoredChain(restoredBoost);
    const boostedMocha = restoredBoost.session.state.cards.find((card) => card.uid === mocha.uid);
    expect(currentAttack(boostedMocha, restoredBoost.session.state)).toBe(2000);
    expect(restoredBoost.session.state.effects.filter((effect) => effect.sourceUid === mocha.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 100, event: "continuous", property: 0x400, reset: { flags: 33427456 }, sourceUid: mocha.uid, value: 1000 },
    ]);
    expect(restoredBoost.session.state.effects.some((effect) => effect.event === "continuous" && effect.code === 0x1200 && effect.sourceUid === mocha.uid)).toBe(true);
    expect(restoredBoost.session.state.eventHistory.filter((event) => event.eventName === "becameTarget")).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: mocha.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-3",
      },
    ]);

    restoredBoost.session.state.phase = "battle";
    restoredBoost.session.state.turnPlayer = 0;
    restoredBoost.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredBoost, 0);
    const attack = getLuaRestoreLegalActions(restoredBoost, 0).find((action) => action.type === "declareAttack" && action.attackerUid === mocha.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBoost, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBoost, attack!);
    finishRestoredBattle(restoredBoost);
    expect(restoredBoost.session.state.battleDamage).toEqual({ 0: 0, 1: 1000 });

    const restoredEnd = restoreDuelWithLuaScripts(serializeDuel(restoredBoost.session), workspace, reader);
    expectCleanRestore(restoredEnd);
    advanceRestoredToEndTurn(restoredEnd, 0);
    expect(restoredEnd.session.state.cards.find((card) => card.uid === mocha.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: mocha.uid,
      reasonEffectId: 5,
    });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_TOGRAVE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DELAY+EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e1:SetCode(EVENT_FLIP)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("aux.DelayedOperation(tc,PHASE_END,id,e,tp,");
  expect(script).toContain("function(dg) Duel.SendtoGrave(dg,REASON_EFFECT) end");
  expect(script).toContain("e2:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_POSITION)");
  expect(script).toContain("e2:SetRange(LOCATION_HAND)");
  expect(script).toContain("Duel.SelectTarget(tp,s.posfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)>0");
  expect(script).toContain("Duel.ChangePosition(tc,POS_FACEUP_ATTACK)");
  expect(script).toContain("e3:SetCategory(CATEGORY_POSITION+CATEGORY_SET)");
  expect(script).toContain("e3:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("e3:SetCondition(function(e,tp) return Duel.IsTurnPlayer(tp) end)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_POSITION,c,1,tp,POS_FACEDOWN_DEFENSE)");
  expect(script).toContain("Duel.ChangePosition(c,POS_FACEDOWN_DEFENSE)");
}

function cards(): DuelCardData[] {
  return [
    { code: mochaCode, name: "WAKE CUP! Mocha", kind: "monster", typeFlags: typeMonster | typeEffect | typeFlip, race: racePsychic, attribute: attributeWater, level: 3, attack: 1000, defense: 100 },
    { code: defenderCode, name: "WAKE CUP! Battle Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceDownDefense(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = false;
  moved.position = "faceDownDefense";
  moved.sequence = sequence;
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

function advanceRestoredToEndTurn(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  for (const phase of ["main2", "end"] as const) {
    if (restored.session.state.turnPlayer !== player) return;
    if (restored.session.state.phase === phase) continue;
    const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "changePhase" && candidate.phase === phase);
    if (!action) continue;
    applyRestoredActionAndAssert(restored, action);
  }
  if (restored.session.state.turnPlayer !== player) return;
  const endTurn = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "endTurn");
  expect(endTurn, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, endTurn!);
}
