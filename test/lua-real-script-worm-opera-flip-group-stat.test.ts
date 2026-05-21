import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const operaCode = "28465301";
const wormAllyCode = "284653010";
const ownNonWormCode = "284653011";
const opponentNonWormCode = "284653012";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasOperaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${operaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceReptile = 0x80000;
const raceWarrior = 0x1;
const setWorm = 0x3e;

describe.skipIf(!hasUpstreamScripts || !hasOperaScript)("Lua real script Worm Opera flip group stat", () => {
  it("restores FLIP GetMatchingGroup aux.Next ATK loss excluding face-up Worm Reptiles", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${operaCode}.lua`);
    expect(script).toContain("e1:SetType(EFFECT_TYPE_FLIP+EFFECT_TYPE_SINGLE)");
    expect(script).toContain("local g=Duel.GetMatchingGroup(s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
    expect(script).toContain("for tc in aux.Next(g) do");
    expect(script).toContain("not (c:IsSetCard(SET_WORM) and c:IsRace(RACE_REPTILE))");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(-500)");

    const cards: DuelCardData[] = [
      { code: operaCode, name: "Worm Opera", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setWorm], race: raceReptile, level: 2, attack: 400, defense: 800 },
      { code: wormAllyCode, name: "Worm Opera Excluded Worm Ally", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setWorm], race: raceReptile, level: 4, attack: 1600, defense: 1000 },
      { code: ownNonWormCode, name: "Worm Opera Own Non-Worm", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1500, defense: 1200 },
      { code: opponentNonWormCode, name: "Worm Opera Opponent Non-Worm", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1800, defense: 1400 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 28465301, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [operaCode, wormAllyCode, ownNonWormCode] }, 1: { main: [opponentNonWormCode] } });
    startDuel(session);
    const opera = requireCard(session, operaCode);
    const wormAlly = requireCard(session, wormAllyCode);
    const ownNonWorm = requireCard(session, ownNonWormCode);
    const opponentNonWorm = requireCard(session, opponentNonWormCode);
    const movedOpera = moveDuelCard(session.state, opera.uid, "monsterZone", 0);
    movedOpera.position = "faceDownDefense";
    movedOpera.faceUp = false;
    moveFaceUpAttack(session, wormAlly, 0);
    moveFaceUpAttack(session, ownNonWorm, 0);
    moveFaceUpAttack(session, opponentNonWorm, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(operaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const flip = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "flipSummon" && action.uid === opera.uid);
    expect(flip, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, flip!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === opera.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);

    const state = restoredTrigger.session.state;
    expect(currentAttack(state.cards.find((card) => card.uid === opera.uid), state)).toBe(400);
    expect(currentAttack(state.cards.find((card) => card.uid === wormAlly.uid), state)).toBe(1600);
    expect(currentAttack(state.cards.find((card) => card.uid === ownNonWorm.uid), state)).toBe(1000);
    expect(currentAttack(state.cards.find((card) => card.uid === opponentNonWorm.uid), state)).toBe(1300);
    expect(currentDefense(state.cards.find((card) => card.uid === opponentNonWorm.uid), state)).toBe(1400);
    expect(state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(state.effects.filter((effect) => [ownNonWorm.uid, opponentNonWorm.uid].includes(effect.sourceUid) && effect.code === 100).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 100, reset: { flags: 33427456 }, sourceUid: ownNonWorm.uid, value: -500 },
      { code: 100, reset: { flags: 33427456 }, sourceUid: opponentNonWorm.uid, value: -500 },
    ]);
    expect(state.eventHistory.filter((event) => event.eventName === "flipSummoned")).toEqual([
      {
        eventName: "flipSummoned",
        eventCode: 1101,
        eventCardUid: opera.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: ReturnType<typeof requireCard>, player: 0 | 1): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
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
