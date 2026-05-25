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
const amplifierCode = "84653834";
const psychicOneCode = "846538340";
const psychicTwoCode = "846538341";
const banishedPsychicOneCode = "846538342";
const banishedPsychicTwoCode = "846538343";
const warriorCode = "846538344";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const racePsychic = 0x100000;
const attributeLight = 0x10;
const effectUpdateAttack = 100;
const eventPhaseEnd = 0x1200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script ESP Amplifier banished Psychic stat End Phase banish", () => {
  it("restores banished Psychic count ATK gain and End Phase self-banish for each boosted Psychic", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${amplifierCode}.lua`));
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === amplifierCode),
      { code: psychicOneCode, name: "ESP Psychic One", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePsychic, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
      { code: psychicTwoCode, name: "ESP Psychic Two", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePsychic, attribute: attributeLight, level: 4, attack: 1500, defense: 1000 },
      { code: banishedPsychicOneCode, name: "Banished Psychic One", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePsychic, attribute: attributeLight, level: 4, attack: 800, defense: 800 },
      { code: banishedPsychicTwoCode, name: "Banished Psychic Two", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePsychic, attribute: attributeLight, level: 4, attack: 900, defense: 900 },
      { code: warriorCode, name: "ESP Warrior Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1800, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 84653834, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [amplifierCode, psychicOneCode, psychicTwoCode, banishedPsychicOneCode, banishedPsychicTwoCode, warriorCode] }, 1: { main: [] } });
    startDuel(session);
    const amplifier = requireCard(session, amplifierCode);
    const psychicOne = requireCard(session, psychicOneCode);
    const psychicTwo = requireCard(session, psychicTwoCode);
    const banishedPsychicOne = requireCard(session, banishedPsychicOneCode);
    const banishedPsychicTwo = requireCard(session, banishedPsychicTwoCode);
    const warrior = requireCard(session, warriorCode);
    moveDuelCard(session.state, amplifier.uid, "hand", 0);
    moveFaceUpAttack(session, psychicOne, 0, 0);
    moveFaceUpAttack(session, psychicTwo, 0, 1);
    moveFaceUpAttack(session, warrior, 0, 2);
    moveFaceUpBanished(session, banishedPsychicOne, 0, 0);
    moveFaceUpBanished(session, banishedPsychicTwo, 0, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(amplifierCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === amplifier.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === amplifier.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === psychicOne.uid), restoredOpen.session.state)).toBe(1600);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === psychicTwo.uid), restoredOpen.session.state)).toBe(2100);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === warrior.uid), restoredOpen.session.state)).toBe(1800);
    expect(restoredOpen.session.state.effects.filter((effect) => [psychicOne.uid, psychicTwo.uid].includes(effect.sourceUid ?? "") && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", reset: { flags: 0x41fe1200 }, sourceUid: psychicOne.uid, value: 600 },
      { code: effectUpdateAttack, event: "continuous", reset: { flags: 0x41fe1200 }, sourceUid: psychicTwo.uid, value: 600 },
    ]);
    expect(restoredOpen.session.state.effects.filter((effect) => [psychicOne.uid, psychicTwo.uid].includes(effect.sourceUid ?? "") && effect.code === eventPhaseEnd).map((effect) => ({
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: eventPhaseEnd, countLimit: 1, event: "continuous", range: ["monsterZone"], reset: { flags: 0x41fe1200 }, sourceUid: psychicOne.uid },
      { code: eventPhaseEnd, countLimit: 1, event: "continuous", range: ["monsterZone"], reset: { flags: 0x41fe1200 }, sourceUid: psychicTwo.uid },
    ]);

    const restoredBoost = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredBoost);
    expectRestoredLegalActions(restoredBoost, 0);
    expect(currentAttack(restoredBoost.session.state.cards.find((card) => card.uid === psychicOne.uid), restoredBoost.session.state)).toBe(1600);
    expect(currentAttack(restoredBoost.session.state.cards.find((card) => card.uid === psychicTwo.uid), restoredBoost.session.state)).toBe(2100);
    restoredBoost.session.state.phase = "main2";
    restoredBoost.session.state.waitingFor = 0;
    const endPhase = getLuaRestoreLegalActions(restoredBoost, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(endPhase, JSON.stringify(getLuaRestoreLegalActions(restoredBoost, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBoost, endPhase!);
    expect(restoredBoost.session.state.eventHistory.filter((event) => event.eventName === "phaseEnd")).toEqual([{ eventName: "phaseEnd", eventCode: eventPhaseEnd }]);
    expect(restoredBoost.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredBoost.session.state.cards.find((card) => card.uid === psychicOne.uid)).toMatchObject({ location: "banished", controller: 0, reason: duelReason.effect });
    expect(restoredBoost.session.state.cards.find((card) => card.uid === psychicTwo.uid)).toMatchObject({ location: "banished", controller: 0, reason: duelReason.effect });
    expect(restoredBoost.session.state.cards.find((card) => card.uid === warrior.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    const banishedBoostedUids = new Set([psychicOne.uid, psychicTwo.uid]);
    expect(restoredBoost.session.state.eventHistory.filter((event) => event.eventName === "banished" && event.eventCardUid !== undefined && banishedBoostedUids.has(event.eventCardUid))).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: psychicOne.uid,
        eventPreviousState: { location: "monsterZone", controller: 0, sequence: 0, position: "faceUpAttack", faceUp: true },
        eventCurrentState: { location: "banished", controller: 0, sequence: 2, position: "faceUpAttack", faceUp: true },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: psychicOne.uid,
        eventReasonEffectId: 3,
      },
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: psychicTwo.uid,
        eventPreviousState: { location: "monsterZone", controller: 0, sequence: 1, position: "faceUpAttack", faceUp: true },
        eventCurrentState: { location: "banished", controller: 0, sequence: 3, position: "faceUpAttack", faceUp: true },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: psychicTwo.uid,
        eventReasonEffectId: 5,
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("ESP Amplifier");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("Duel.IsPhase(PHASE_DAMAGE) and Duel.IsDamageCalculated()");
  expect(script).toContain("Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsRace,RACE_PSYCHIC),tp,LOCATION_MZONE,0,1,nil)");
  expect(script).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsRace,RACE_PSYCHIC),tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("Duel.GetMatchingGroupCount(aux.FaceupFilter(Card.IsRace,RACE_PSYCHIC),tp,LOCATION_REMOVED,0,nil)*300");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)");
  expect(script).toContain("e2:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("e2:SetRange(LOCATION_MZONE)");
  expect(script).toContain("Duel.Remove(e:GetHandler(),POS_FACEUP,REASON_EFFECT)");
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function moveFaceUpBanished(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "banished", player);
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
