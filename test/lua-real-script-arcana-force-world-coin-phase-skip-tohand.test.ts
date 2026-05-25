import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const worldCode = "23846921";
const costACode = "238469210";
const costBCode = "238469211";
const graveFirstCode = "238469212";
const graveLastCode = "238469213";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasWorldScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${worldCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const categoryCoin = 0x1000000;
const categoryToHand = 0x8;
const effectSkipTurn = 188;

describe.skipIf(!hasUpstreamScripts || !hasWorldScript)("Lua real script Arcana Force World coin phase skip to hand", () => {
  it("restores Arcana coin-result registration into End Phase skip-turn cost and Draw Phase Graveyard return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${worldCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());

    const heads = createResolvedCoinWindow({ seed: 151, reader, workspace });
    const headsWorld = requireCard(heads.session, worldCode);
    expect(heads.session.state.lastCoinResults).toEqual([1]);
    expectCleanRestore(heads);
    expectRestoredLegalActions(heads, 0);
    expect(heads.session.state.effects.filter((effect) => effect.sourceUid === headsWorld.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: categoryCoin, code: 1100, countLimit: undefined, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "normalSummoned" },
      { category: categoryCoin, code: 1102, countLimit: undefined, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "specialSummoned" },
      { category: categoryCoin, code: 1101, countLimit: undefined, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "flipSummoned" },
      { category: undefined, code: 4608, countLimit: 1, event: "trigger", range: ["monsterZone"], triggerEvent: "phaseEnd" },
      { category: categoryToHand, code: 4097, countLimit: 1, event: "trigger", range: ["monsterZone"], triggerEvent: "phaseDraw" },
    ]);

    moveToPhaseStart(heads.session, "main2");
    const end = getLuaRestoreLegalActions(heads, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(end, JSON.stringify(getLuaRestoreLegalActions(heads, 0), null, 2)).toBeDefined();
    applyRestored(heads, end!);
    expect(heads.session.state.pendingTriggers.map(({ id: _id, ...trigger }) => trigger)).toEqual([
      {
        player: 0,
        effectId: "lua-4-4608",
        sourceUid: headsWorld.uid,
        eventName: "phaseEnd",
        eventCode: 0x1200,
        eventTriggerTiming: "when",
        triggerBucket: "turnOptional",
      },
    ]);
    const skipTrigger = getLuaRestoreLegalActions(heads, 0).find((action) => action.type === "activateTrigger" && action.uid === headsWorld.uid);
    expect(skipTrigger, JSON.stringify(getLuaRestoreLegalActions(heads, 0), null, 2)).toBeDefined();
    applyRestored(heads, skipTrigger!);
    passRestoredChain(heads);
    expect(heads.session.state.cards.filter((card) => [worldCode, costACode, costBCode].includes(card.code)).map((card) => ({
      code: card.code,
      location: card.location,
      reason: card.reason,
      reasonPlayer: card.reasonPlayer,
      reasonCardUid: card.reasonCardUid,
    }))).toEqual([
      { code: worldCode, location: "monsterZone", reason: duelReason.summon | duelReason.specialSummon, reasonPlayer: 0, reasonCardUid: undefined },
      { code: costACode, location: "graveyard", reason: duelReason.cost, reasonPlayer: 0, reasonCardUid: headsWorld.uid },
      { code: costBCode, location: "graveyard", reason: duelReason.cost, reasonPlayer: 0, reasonCardUid: headsWorld.uid },
    ]);
    expect(heads.session.state.effects.filter((effect) => effect.code === effectSkipTurn).map((effect) => ({
      code: effect.code,
      controller: effect.controller,
      reset: effect.reset,
      targetRange: effect.targetRange,
    }))).toEqual([
      { code: effectSkipTurn, controller: 0, reset: { flags: 1610613248 }, targetRange: [0, 1] },
    ]);

    const tails = createResolvedCoinWindow({ seed: 1, reader, workspace });
    const tailsWorld = requireCard(tails.session, worldCode);
    const graveLast = requireCard(tails.session, graveLastCode);
    expect(tails.session.state.lastCoinResults).toEqual([0]);
    moveToPhaseStart(tails.session, "end");
    tails.session.state.turnPlayer = 0;
    tails.session.state.waitingFor = 0;
    expectCleanRestore(tails);
    expectRestoredLegalActions(tails, 0);
    const endTurn = getLuaRestoreLegalActions(tails, 0).find((action) => action.type === "endTurn");
    expect(endTurn, JSON.stringify(getLuaRestoreLegalActions(tails, 0), null, 2)).toBeDefined();
    applyRestored(tails, endTurn!);
    expect(tails.session.state.pendingTriggers.map((trigger) => ({
      player: trigger.player,
      effectId: trigger.effectId,
      sourceUid: trigger.sourceUid,
      eventName: trigger.eventName,
      eventCode: trigger.eventCode,
      eventPlayer: trigger.eventPlayer,
      eventTriggerTiming: trigger.eventTriggerTiming,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        player: 0,
        effectId: "lua-5-4097",
        sourceUid: tailsWorld.uid,
        eventName: "phaseDraw",
        eventCode: 0x1001,
        eventPlayer: 1,
        eventTriggerTiming: "when",
        triggerBucket: "opponentMandatory",
      },
    ]);
    const toHandTrigger = getLuaRestoreLegalActions(tails, 0).find((action) => action.type === "activateTrigger" && action.uid === tailsWorld.uid);
    expect(toHandTrigger, JSON.stringify(getLuaRestoreLegalActions(tails, 0), null, 2)).toBeDefined();
    applyRestored(tails, toHandTrigger!);
    passRestoredChain(tails);
    expect(tails.session.state.cards.find((card) => card.uid === graveLast.uid)).toMatchObject({
      location: "hand",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: tailsWorld.uid,
      reasonEffectId: 5,
    });
    expect(tails.session.state.eventHistory.filter((event) => ["coinTossed", "phaseEnd", "phaseDraw", "sentToGraveyard", "sentToHand", "confirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "coinTossed",
        eventCode: 1151,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: tailsWorld.uid,
        eventReasonEffectId: 2,
      },
      {
        eventName: "phaseDraw",
        eventCode: 0x1001,
        eventPlayer: 1,
      },
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: graveLast.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: tailsWorld.uid,
        eventReasonEffectId: 5,
        eventPreviousState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 1 },
        eventCurrentState: { controller: 1, faceUp: false, location: "hand", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: graveLast.uid,
        eventPlayer: 0,
        eventValue: 1,
        eventUids: [graveLast.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: tailsWorld.uid,
        eventReasonEffectId: 5,
        eventPreviousState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 1 },
        eventCurrentState: { controller: 1, faceUp: false, location: "hand", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function createResolvedCoinWindow({
  seed,
  reader,
  workspace,
}: {
  seed: number;
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [worldCode, costACode, costBCode] }, 1: { main: [graveFirstCode, graveLastCode] } });
  startDuel(session);
  const world = requireCard(session, worldCode);
  moveFaceUpAttack(session, requireCard(session, costACode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, costBCode), 0, 2);
  moveFaceUpAttack(session, requireCard(session, graveFirstCode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, graveLastCode), 1, 1);
  moveDuelCard(session.state, requireCard(session, graveFirstCode).uid, "graveyard", 1).sequence = 0;
  moveDuelCard(session.state, requireCard(session, graveLastCode).uid, "graveyard", 1).sequence = 1;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(worldCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  specialSummonDuelCard(session.state, world.uid, 0);
  world.sequence = 4;

  const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
  expectCleanRestore(restoredTrigger);
  expectRestoredLegalActions(restoredTrigger, 0);
  const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === world.uid);
  expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
  applyRestored(restoredTrigger, trigger!);
  passRestoredChain(restoredTrigger);
  const restoredCoin = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
  expectCleanRestore(restoredCoin);
  expectRestoredLegalActions(restoredCoin, 0);
  return restoredCoin;
}

function cards(): DuelCardData[] {
  return [
    { code: worldCode, name: "Arcana Force XXI - The World", kind: "monster", typeFlags: typeMonster | typeEffect, level: 8, attack: 3100, defense: 3100 },
    { code: costACode, name: "World Skip Cost A", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    { code: costBCode, name: "World Skip Cost B", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    { code: graveFirstCode, name: "World Graveyard First", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    { code: graveLastCode, name: "World Graveyard Last", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Arcana Force XXI - The World");
  expect(script).toContain("s.toss_coin=true");
  expect(script).toContain("e1:SetCategory(CATEGORY_COIN)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("s.arcanareg(c,Arcana.TossCoin(c,tp))");
  expect(script).toContain("e1:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsAbleToGraveAsCost,tp,LOCATION_MZONE,0,2,nil)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,Card.IsAbleToGraveAsCost,tp,LOCATION_MZONE,0,2,2,nil)");
  expect(script).toContain("Duel.SendtoGrave(g,REASON_COST)");
  expect(script).toContain("e1:SetCode(EFFECT_SKIP_TURN)");
  expect(script).toContain("Duel.RegisterEffect(e1,tp)");
  expect(script).toContain("e2:SetCategory(CATEGORY_TOHAND)");
  expect(script).toContain("e2:SetCode(EVENT_PHASE|PHASE_DRAW)");
  expect(script).toContain("Duel.GetFieldCard(1-tp,LOCATION_GRAVE,Duel.GetFieldGroupCount(1-tp,LOCATION_GRAVE,0)-1)");
  expect(script).toContain("Duel.SendtoHand(tc,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(tp,tc)");
  expect(script).toContain("Arcana.RegisterCoinResult(c,coin)");
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

function moveToPhaseStart(session: DuelSession, phase: DuelSession["state"]["phase"]): void {
  session.state.phase = phase;
  session.state.waitingFor = session.state.turnPlayer;
  session.state.chain = [];
  session.state.pendingTriggers = [];
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

function applyRestored(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
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
    applyRestored(restored, pass!);
  }
}
