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
const ragingCode = "95507060";
const plantOneCode = "955070600";
const plantTwoCode = "955070601";
const gravePlantOneCode = "955070602";
const gravePlantTwoCode = "955070603";
const warriorCode = "955070604";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const racePlant = 0x400;
const attributeEarth = 0x1;
const effectUpdateAttack = 100;
const eventPhaseEnd = 0x1200;
const effectDestroyReason = duelReason.effect | duelReason.destroy;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Raging Mad Plants grave count stat End Phase destroy", () => {
  it("restores grave Plant count ATK gain and End Phase destruction of remaining face-up Plants", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${ragingCode}.lua`));
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === ragingCode),
      { code: plantOneCode, name: "Raging Plant One", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
      { code: plantTwoCode, name: "Raging Plant Two", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, attribute: attributeEarth, level: 4, attack: 1500, defense: 1000 },
      { code: gravePlantOneCode, name: "Grave Plant One", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, attribute: attributeEarth, level: 4, attack: 800, defense: 800 },
      { code: gravePlantTwoCode, name: "Grave Plant Two", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, attribute: attributeEarth, level: 4, attack: 900, defense: 900 },
      { code: warriorCode, name: "Raging Warrior Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 95507060, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ragingCode, plantOneCode, plantTwoCode, gravePlantOneCode, gravePlantTwoCode, warriorCode] }, 1: { main: [] } });
    startDuel(session);
    const raging = requireCard(session, ragingCode);
    const plantOne = requireCard(session, plantOneCode);
    const plantTwo = requireCard(session, plantTwoCode);
    const gravePlantOne = requireCard(session, gravePlantOneCode);
    const gravePlantTwo = requireCard(session, gravePlantTwoCode);
    const warrior = requireCard(session, warriorCode);
    moveDuelCard(session.state, raging.uid, "hand", 0);
    moveFaceUpAttack(session, plantOne, 0, 0);
    moveFaceUpAttack(session, plantTwo, 0, 1);
    moveFaceUpAttack(session, warrior, 0, 2);
    moveDuelCard(session.state, gravePlantOne.uid, "graveyard", 0);
    moveDuelCard(session.state, gravePlantTwo.uid, "graveyard", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(ragingCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === raging.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === raging.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === plantOne.uid), restoredOpen.session.state)).toBe(1600);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === plantTwo.uid), restoredOpen.session.state)).toBe(2100);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === warrior.uid), restoredOpen.session.state)).toBe(1800);
    expect(restoredOpen.session.state.effects.filter((effect) => [plantOne.uid, plantTwo.uid].includes(effect.sourceUid ?? "") && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", reset: { flags: 0x41fe1200 }, sourceUid: plantOne.uid, value: 600 },
      { code: effectUpdateAttack, event: "continuous", reset: { flags: 0x41fe1200 }, sourceUid: plantTwo.uid, value: 600 },
    ]);
    const delayedDestroyEffects = restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === raging.uid && effect.code === eventPhaseEnd);
    expect(delayedDestroyEffects.map((effect) => ({
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: eventPhaseEnd, countLimit: 1, event: "continuous", reset: { flags: 0x40000200 }, sourceUid: raging.uid },
    ]);

    const restoredBoost = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredBoost);
    expectRestoredLegalActions(restoredBoost, 0);
    expect(currentAttack(restoredBoost.session.state.cards.find((card) => card.uid === plantOne.uid), restoredBoost.session.state)).toBe(1600);
    expect(currentAttack(restoredBoost.session.state.cards.find((card) => card.uid === plantTwo.uid), restoredBoost.session.state)).toBe(2100);
    restoredBoost.session.state.phase = "main2";
    restoredBoost.session.state.waitingFor = 0;
    const endPhase = getLuaRestoreLegalActions(restoredBoost, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(endPhase, JSON.stringify(getLuaRestoreLegalActions(restoredBoost, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBoost, endPhase!);
    expect(restoredBoost.session.state.eventHistory.filter((event) => event.eventName === "phaseEnd")).toEqual([{ eventName: "phaseEnd", eventCode: eventPhaseEnd }]);
    expect(restoredBoost.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredBoost.session.state.cards.find((card) => card.uid === plantOne.uid)).toMatchObject({ location: "graveyard", controller: 0, reason: effectDestroyReason });
    expect(restoredBoost.session.state.cards.find((card) => card.uid === plantTwo.uid)).toMatchObject({ location: "graveyard", controller: 0, reason: effectDestroyReason });
    expect(restoredBoost.session.state.cards.find((card) => card.uid === warrior.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    const destroyedPlantUids = new Set([plantOne.uid, plantTwo.uid]);
    expect(restoredBoost.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid !== undefined && destroyedPlantUids.has(event.eventCardUid))).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: plantOne.uid,
        eventPreviousState: { location: "monsterZone", controller: 0, sequence: 0, position: "faceUpAttack", faceUp: true },
        eventCurrentState: { location: "graveyard", controller: 0, sequence: 3, position: "faceUpAttack", faceUp: true },
        eventReason: effectDestroyReason,
        eventReasonPlayer: 0,
        eventReasonCardUid: raging.uid,
        eventReasonEffectId: 4,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: plantTwo.uid,
        eventPreviousState: { location: "monsterZone", controller: 0, sequence: 1, position: "faceUpAttack", faceUp: true },
        eventCurrentState: { location: "graveyard", controller: 0, sequence: 4, position: "faceUpAttack", faceUp: true },
        eventReason: effectDestroyReason,
        eventReasonPlayer: 0,
        eventReasonCardUid: raging.uid,
        eventReasonEffectId: 4,
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Raging Mad Plants");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("aux.StatChangeDamageStepCondition");
  expect(script).toContain("Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsRace,RACE_PLANT),tp,LOCATION_MZONE,0,1,nil)");
  expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsRace,tp,LOCATION_GRAVE,0,1,nil,RACE_PLANT)");
  expect(script).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsRace,RACE_PLANT),tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("Duel.GetMatchingGroupCount(Card.IsRace,tp,LOCATION_GRAVE,0,nil,RACE_PLANT)*300");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("Duel.RegisterEffect(e2,tp)");
  expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
