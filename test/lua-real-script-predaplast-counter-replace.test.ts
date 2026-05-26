import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentLevel } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const predaplastCode = "72129804";
const handPredapACode = "721298040";
const handPredapBCode = "721298041";
const opponentTargetACode = "721298042";
const opponentTargetBCode = "721298043";
const ownPredaplantCode = "721298044";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasPredaplastScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${predaplastCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const racePlant = 0x400;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x10;
const setPredap = 0xf3;
const setPredaplant = 0x10f3;
const counterPredator = 0x1041;
const effectChangeLevel = 131;

describe.skipIf(!hasUpstreamScripts || !hasPredaplastScript)("Lua real script Predaplast counter replace", () => {
  it("restores hand reveal target counters, Level 1 locks, and grave Predaplant battle destroy replacement", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${predaplastCode}.lua`));
    const reader = createCardReader(cards());

    const restoredActivation = createRestoredActivationState(reader, workspace);
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    const predaplast = requireCard(restoredActivation.session, predaplastCode);
    const targetA = requireCard(restoredActivation.session, opponentTargetACode);
    const targetB = requireCard(restoredActivation.session, opponentTargetBCode);
    const activate = getLuaRestoreLegalActions(restoredActivation, 0).find((action) =>
      action.type === "activateEffect" && action.uid === predaplast.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredActivation, activate!);
    resolveRestoredChain(restoredActivation);

    expect(findCard(restoredActivation.session, predaplast.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(getDuelCardCounter(findCard(restoredActivation.session, targetA.uid), counterPredator)).toBe(1);
    expect(getDuelCardCounter(findCard(restoredActivation.session, targetB.uid), counterPredator)).toBe(1);
    expect(currentLevel(findCard(restoredActivation.session, targetA.uid), restoredActivation.session.state)).toBe(1);
    expect(currentLevel(findCard(restoredActivation.session, targetB.uid), restoredActivation.session.state)).toBe(1);
    expect(restoredActivation.session.state.effects.filter((effect) => [targetA.uid, targetB.uid].includes(effect.sourceUid)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectChangeLevel, event: "continuous", reset: { flags: 33427456 }, sourceUid: targetA.uid, value: 1 },
      { code: effectChangeLevel, event: "continuous", reset: { flags: 33427456 }, sourceUid: targetB.uid, value: 1 },
    ]);
    expect(restoredActivation.session.state.eventHistory.filter((event) => ["counterAdded", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "counterAdded", eventCardUid: targetA.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: predaplast.uid, eventReasonEffectId: 1 },
      { eventName: "counterAdded", eventCardUid: targetB.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: predaplast.uid, eventReasonEffectId: 1 },
      { eventName: "sentToGraveyard", eventCardUid: predaplast.uid, eventReason: duelReason.rule, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
    ]);

    const restoredReplacement = createRestoredReplacementState(reader, workspace);
    expectCleanRestore(restoredReplacement);
    const gravePredaplast = requireCard(restoredReplacement.session, predaplastCode);
    const ownPredaplant = requireCard(restoredReplacement.session, ownPredaplantCode);
    destroyDuelCard(restoredReplacement.session.state, ownPredaplant.uid, 0, duelReason.battle | duelReason.destroy, 0);
    expect(findCard(restoredReplacement.session, ownPredaplant.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
    });
    expect(findCard(restoredReplacement.session, gravePredaplast.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: gravePredaplast.uid,
      reasonEffectId: 2,
    });
    expect(restoredReplacement.host.promptDecisions).toContainEqual({
      id: "lua-prompt-1",
      api: "SelectEffectYesNo",
      player: 0,
      description: 96,
      returned: true,
    });
    expect(restoredReplacement.session.state.eventHistory.filter((event) => ["banished", "destroyed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "banished", eventCardUid: gravePredaplast.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: gravePredaplast.uid, eventReasonEffectId: 2 },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: predaplastCode, name: "Predaplast", kind: "spell", typeFlags: typeSpell },
    { code: handPredapACode, name: "Predaplast Hand Predap A", kind: "spell", typeFlags: typeSpell, setcodes: [setPredap] },
    { code: handPredapBCode, name: "Predaplast Hand Predap B", kind: "spell", typeFlags: typeSpell, setcodes: [setPredap] },
    { code: opponentTargetACode, name: "Predaplast Opponent Counter Target A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000 },
    { code: opponentTargetBCode, name: "Predaplast Opponent Counter Target B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 6, attack: 2200, defense: 1600 },
    { code: ownPredaplantCode, name: "Predaplast Replacement Predaplant", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, attribute: attributeDark, setcodes: [setPredaplant], level: 4, attack: 1400, defense: 1200 },
  ];
}

function createRestoredActivationState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = setupDuel(reader);
  loadDecks(session, { 0: { main: [predaplastCode, handPredapACode, handPredapBCode] }, 1: { main: [opponentTargetACode, opponentTargetBCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, predaplastCode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, handPredapACode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, handPredapBCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, opponentTargetACode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, opponentTargetBCode), 1, 1);
  setOpenMainPhase(session);
  registerPredaplast(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredReplacementState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = setupDuel(reader);
  loadDecks(session, { 0: { main: [predaplastCode, ownPredaplantCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, predaplastCode).uid, "graveyard", 0);
  moveFaceUpAttack(session, requireCard(session, ownPredaplantCode), 0, 0);
  setOpenMainPhase(session);
  registerPredaplast(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, {
    promptOverrides: [{ api: "SelectEffectYesNo", player: 0, returned: true }],
  });
}

function setupDuel(reader: ReturnType<typeof createCardReader>): DuelSession {
  return createDuel({ seed: 72129804, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
}

function setOpenMainPhase(session: DuelSession): void {
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
}

function registerPredaplast(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(predaplastCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Predaplast");
  expect(script).toContain("s.counter_place_list={COUNTER_PREDATOR}");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("Duel.GetMatchingGroup(s.cfilter,tp,LOCATION_HAND,0,e:GetHandler())");
  expect(script).toContain("Duel.GetTargetCount(Card.IsCanAddCounter,tp,0,LOCATION_MZONE,nil,COUNTER_PREDATOR,1)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
  expect(script).toContain("Duel.ShuffleHand(tp)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsCanAddCounter,tp,0,LOCATION_MZONE,#g,#g,nil,COUNTER_PREDATOR,1)");
  expect(script).toContain("tc:AddCounter(COUNTER_PREDATOR,1)");
  expect(script).toContain("e1:SetCode(EFFECT_CHANGE_LEVEL)");
  expect(script).toContain("return e:GetHandler():GetCounter(COUNTER_PREDATOR)>0");
  expect(script).toContain("e2:SetCode(EFFECT_DESTROY_REPLACE)");
  expect(script).toContain("e2:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("return Duel.SelectEffectYesNo(tp,e:GetHandler(),96)");
  expect(script).toContain("Duel.Remove(e:GetHandler(),POS_FACEUP,REASON_EFFECT)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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
    applyRestoredActionAndAssert(restored, pass!);
  }
}
