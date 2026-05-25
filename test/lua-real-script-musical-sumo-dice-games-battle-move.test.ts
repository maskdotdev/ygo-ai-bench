import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const sumoCode = "96637156";
const materialACode = "966371560";
const materialBCode = "966371561";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSumoScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${sumoCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceMachine = 0x20;
const attributeEarth = 0x10;
const categoryControl = 0x2000;
const categoryDice = 0x2000000;
const categoryToGrave = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasSumoScript)("Lua real script Musical Sumo Dice Games battle movement", () => {
  it("restores opponent Battle Phase dice movement with Xyz overlay state", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${sumoCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 1, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialACode, materialBCode], extra: [sumoCode] }, 1: { main: [] } });
    startDuel(session);

    const sumo = requireCard(session, sumoCode);
    const materialA = requireCard(session, materialACode);
    const materialB = requireCard(session, materialBCode);
    moveFaceUpAttack(session, sumo, 0, 4);
    attachOverlay(session, sumo, materialA, materialB);
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sumoCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 1);
    expect(restoredBattle.session.state.effects.filter((effect) => effect.sourceUid === sumo.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 31, countLimit: undefined, event: "continuous", range: ["monsterZone"], triggerEvent: undefined },
      { category: categoryControl | categoryDice | categoryToGrave, code: 4104, countLimit: 1, event: "trigger", range: ["monsterZone"], triggerEvent: "phaseBattle" },
    ]);
    const battle = getLuaRestoreLegalActions(restoredBattle, 1).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battle, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, battle!);
    expect(restoredBattle.session.state.pendingTriggers.map(({ id: _id, ...trigger }) => trigger)).toEqual([
      {
        player: 0,
        effectId: "lua-2-4104",
        sourceUid: sumo.uid,
        eventName: "phaseBattle",
        eventCode: 4104,
        eventTriggerTiming: "when",
        triggerBucket: "opponentMandatory",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === sumo.uid && action.effectId === "lua-2-4104"
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);

    const restoredMoved = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredMoved);
    expectRestoredLegalActions(restoredMoved, restoredMoved.session.state.waitingFor ?? restoredMoved.session.state.turnPlayer);
    expect(restoredMoved.session.state.chain).toHaveLength(0);
    expect(restoredMoved.session.state.lastDiceResults).toEqual([3]);
    expect(restoredMoved.session.state.cards.find((card) => card.uid === sumo.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 0,
      position: "faceUpAttack",
      sequence: 1,
      reason: 0,
      reasonPlayer: 0,
      overlayUids: [materialA.uid, materialB.uid],
    });
    expect(restoredMoved.session.state.cards.find((card) => card.uid === materialA.uid)).toMatchObject({ location: "overlay", controller: 0 });
    expect(restoredMoved.session.state.cards.find((card) => card.uid === materialB.uid)).toMatchObject({ location: "overlay", controller: 0 });
    expect(restoredMoved.session.state.eventHistory.filter((event) => ["phaseBattle", "diceTossed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousController: event.eventPreviousState?.controller,
      currentController: event.eventCurrentState?.controller,
      previousSequence: event.eventPreviousState?.sequence,
      currentSequence: event.eventCurrentState?.sequence,
    }))).toEqual([
      {
        eventName: "phaseBattle",
        eventCode: 4104,
        eventPlayer: undefined,
        eventValue: undefined,
        eventCardUid: undefined,
        eventReason: undefined,
        eventReasonPlayer: undefined,
        eventReasonCardUid: undefined,
        eventReasonEffectId: undefined,
        previousController: undefined,
        currentController: undefined,
        previousSequence: undefined,
        currentSequence: undefined,
      },
      {
        eventName: "diceTossed",
        eventCode: 1150,
        eventPlayer: 0,
        eventValue: 1,
        eventCardUid: undefined,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: sumo.uid,
        eventReasonEffectId: 2,
        previousController: undefined,
        currentController: undefined,
        previousSequence: undefined,
        currentSequence: undefined,
      },
    ]);
    expect(restoredMoved.session.state.winner).toBeUndefined();
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Musical Sumo Dice Games");
  expect(script).toContain("Xyz.AddProcedure(c,nil,6,2)");
  expect(script).toContain("e1:SetCategory(CATEGORY_DICE+CATEGORY_CONTROL+CATEGORY_TOGRAVE)");
  expect(script).toContain("e1:SetCode(EVENT_PHASE|PHASE_BATTLE_START)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DICE,nil,0,tp,1)");
  expect(script).toContain("local dice=Duel.TossDice(tp,1)");
  expect(script).toContain("Duel.GetMZoneCount(fp,tc,tp,nil,1<<nseq)");
  expect(script).toContain("Duel.Overlay(c,tc)");
  expect(script).toContain("Duel.GetControl(c,1-tp,0,0,1<<nseq)");
  expect(script).toContain("Duel.MoveSequence(c,seq)");
  expect(script).toContain("Duel.Win(tp,WIN_REASON_MUSICAL_SUMO)");
}

function cards(): DuelCardData[] {
  return [
    { code: sumoCode, name: "Musical Sumo Dice Games", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceMachine, attribute: attributeEarth, level: 6, attack: 600, defense: 3000 },
    { code: materialACode, name: "Musical Sumo Dice Games Material A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 6, attack: 1000, defense: 1000 },
    { code: materialBCode, name: "Musical Sumo Dice Games Material B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 6, attack: 1000, defense: 1000 },
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

function attachOverlay(session: DuelSession, holder: DuelCardInstance, ...materials: DuelCardInstance[]): void {
  holder.overlayUids = [];
  for (const [sequence, material] of materials.entries()) {
    moveDuelCard(session.state, material.uid, "overlay", holder.controller, duelReason.material | duelReason.xyz, holder.controller).sequence = sequence;
    holder.overlayUids.push(material.uid);
  }
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
