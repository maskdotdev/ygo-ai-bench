import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter, getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const lifeShaverCode = "38105306";
const firstDiscardCode = "381053060";
const secondDiscardCode = "381053061";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasLifeShaverScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${lifeShaverCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const counterLife = 0x208;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasLifeShaverScript)("Lua real script Life Shaver counter hand discard", () => {
  it("restores opponent End Phase counters into self-send exact-count hand discard", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${lifeShaverCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredEndPhase = createRestoredEndPhaseState(reader, workspace);
    expectCleanRestore(restoredEndPhase);
    expectRestoredLegalActions(restoredEndPhase, 1);
    const lifeShaver = requireCard(restoredEndPhase.session, lifeShaverCode);
    const endPhase = getLuaRestoreLegalActions(restoredEndPhase, 1).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(endPhase, JSON.stringify(getLuaRestoreLegalActions(restoredEndPhase, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEndPhase, endPhase!);
    expect(restoredEndPhase.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-3-4608",
        eventCode: 0x1200,
        eventName: "phaseEnd",
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: lifeShaver.uid,
        triggerBucket: "opponentMandatory",
      },
    ]);
    expectRestoredLegalActions(restoredEndPhase, 0);
    const counterTrigger = getLuaRestoreLegalActions(restoredEndPhase, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === lifeShaver.uid && action.effectId === "lua-3-4608"
    );
    expect(counterTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredEndPhase, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEndPhase, counterTrigger!);
    resolveRestoredChain(restoredEndPhase);
    expect(getDuelCardCounter(findCard(restoredEndPhase.session, lifeShaver.uid), counterLife)).toBe(1);
    expect(restoredEndPhase.session.state.eventHistory.filter((event) => ["phaseEnd", "counterAdded"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "phaseEnd", eventCode: 0x1200, eventCardUid: undefined, eventReason: undefined, eventReasonPlayer: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: lifeShaver.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: lifeShaver.uid, eventReasonEffectId: 3 },
    ]);

    const restoredDiscard = createRestoredDiscardState(reader, workspace);
    expectCleanRestore(restoredDiscard);
    expectRestoredLegalActions(restoredDiscard, 0);
    const discardLifeShaver = requireCard(restoredDiscard.session, lifeShaverCode);
    const firstDiscard = requireCard(restoredDiscard.session, firstDiscardCode);
    const secondDiscard = requireCard(restoredDiscard.session, secondDiscardCode);
    const discard = getLuaRestoreLegalActions(restoredDiscard, 0).find((action) =>
      action.type === "activateEffect" && action.uid === discardLifeShaver.uid && action.effectId === "lua-4-1002"
    );
    expect(discard, JSON.stringify(getLuaRestoreLegalActions(restoredDiscard, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDiscard, discard!);
    expect(restoredDiscard.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restoredDiscard);
    expect(findCard(restoredDiscard.session, discardLifeShaver.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: discardLifeShaver.uid,
      reasonEffectId: 4,
    });
    for (const card of [firstDiscard, secondDiscard]) {
      expect(findCard(restoredDiscard.session, card.uid)).toMatchObject({
        location: "graveyard",
        reason: duelReason.effect,
        reasonPlayer: 0,
        reasonCardUid: discardLifeShaver.uid,
        reasonEffectId: 4,
      });
    }
    expect(restoredDiscard.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventUids: event.eventUids,
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: discardLifeShaver.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: discardLifeShaver.uid, eventReasonEffectId: 4, eventUids: undefined },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: firstDiscard.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: discardLifeShaver.uid, eventReasonEffectId: 4, eventUids: undefined },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: secondDiscard.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: discardLifeShaver.uid, eventReasonEffectId: 4, eventUids: undefined },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: firstDiscard.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: discardLifeShaver.uid, eventReasonEffectId: 4, eventUids: [firstDiscard.uid, secondDiscard.uid] },
    ]);
  });
});

function createRestoredEndPhaseState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 38105306, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [lifeShaverCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpSpellTrap(session, requireCard(session, lifeShaverCode), 0, 0);
  session.state.phase = "main2";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  registerLifeShaver(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredDiscardState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 38105307, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [lifeShaverCode] }, 1: { main: [firstDiscardCode, secondDiscardCode] } });
  startDuel(session);
  const lifeShaver = moveFaceUpSpellTrap(session, requireCard(session, lifeShaverCode), 0, 0);
  moveDuelCard(session.state, requireCard(session, firstDiscardCode).uid, "hand", 1);
  moveDuelCard(session.state, requireCard(session, secondDiscardCode).uid, "hand", 1);
  expect(addDuelCardCounter(lifeShaver, counterLife, 2)).toBe(true);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerLifeShaver(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const lifeShaver = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === lifeShaverCode);
  expect(lifeShaver).toBeDefined();
  return [
    lifeShaver!,
    { code: firstDiscardCode, name: "Life Shaver First Discard", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    { code: secondDiscardCode, name: "Life Shaver Second Discard", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
  ];
}

function registerLifeShaver(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(lifeShaverCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Life Shaver");
  expect(script).toContain("c:SetUniqueOnField(1,0,id)");
  expect(script).toContain("c:EnableCounterPermit(0x208)");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e1:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("return Duel.IsTurnPlayer(1-tp)");
  expect(script).toContain("c:AddCounter(0x208,1)");
  expect(script).toContain("e2:SetCategory(CATEGORY_TOGRAVE+CATEGORY_HANDES)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("return e:GetHandler():GetCounter(0x208)>0 and (Duel.IsMainPhase() or Duel.IsBattlePhase())");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_HANDES,nil,0,1-tp,c:GetCounter(0x208))");
  expect(script).toContain("Duel.SendtoGrave(c,REASON_EFFECT)>0");
  expect(script).toContain("Duel.DiscardHand(1-tp,Card.IsDiscardable,ct,ct,REASON_EFFECT,nil,REASON_EFFECT)");
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

function moveFaceUpSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
