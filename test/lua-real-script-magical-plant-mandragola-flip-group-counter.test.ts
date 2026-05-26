import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const mandragolaCode = "7802006";
const spellCounterTargetCode = "91182675";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMandragolaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${mandragolaCode}.lua`));
const hasSpellCounterTargetScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${spellCounterTargetCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const counterSpell = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasMandragolaScript || !hasSpellCounterTargetScript)("Lua real script Magical Plant Mandragola flip group counter", () => {
  it("restores FLIP GetMatchingGroup aux.Next Spell Counter placement across face-up eligible cards", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${mandragolaCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredOpen = createRestoredFlipState(reader, workspace);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const mandragola = requireCard(restoredOpen.session, mandragolaCode);
    const target = requireCard(restoredOpen.session, spellCounterTargetCode);
    const flip = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "flipSummon" && action.uid === mandragola.uid);
    expect(flip, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, flip!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers.map(({ id: _id, ...trigger }) => trigger)).toEqual([
      {
        eventName: "flipSummoned",
        eventCode: 1001,
        eventCardUid: mandragola.uid,
        eventPlayer: 0,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        sourceUid: mandragola.uid,
        effectId: "lua-1",
        player: 0,
        eventTriggerTiming: "when",
        triggerBucket: "turnMandatory",
      },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === mandragola.uid && action.effectId === "lua-1");
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    expect(getDuelCardCounter(findCard(restoredTrigger.session, target.uid), counterSpell)).toBe(1);
    expect(getDuelCardCounter(findCard(restoredTrigger.session, mandragola.uid), counterSpell)).toBe(0);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["flipSummoned", "counterAdded"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "flipSummoned", eventCode: 1101, eventCardUid: mandragola.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: target.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: mandragola.uid, eventReasonEffectId: 1 },
    ]);

    const finalRestore = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(finalRestore);
    expectRestoredLegalActions(finalRestore, 0);
    expect(getDuelCardCounter(findCard(finalRestore.session, target.uid), counterSpell)).toBe(1);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const mandragola = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === mandragolaCode);
  const spellCounterTarget = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === spellCounterTargetCode);
  expect(mandragola).toBeDefined();
  expect(spellCounterTarget).toBeDefined();
  return [
    mandragola!,
    spellCounterTarget ?? { code: spellCounterTargetCode, name: "Mandragola Spell Counter Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 1, attack: 0, defense: 1400 },
  ];
}

function createRestoredFlipState(reader: ReturnType<typeof createCardReader>, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 7802006, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [mandragolaCode, spellCounterTargetCode] }, 1: { main: [] } });
  startDuel(session);
  const mandragola = moveDuelCard(session.state, requireCard(session, mandragolaCode).uid, "monsterZone", 0);
  mandragola.position = "faceDownDefense";
  mandragola.faceUp = false;
  moveFaceUpAttack(session, requireCard(session, spellCounterTargetCode), 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(mandragolaCode), workspace).ok).toBe(true);
  expect(host.loadCardScript(Number(spellCounterTargetCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Magical Plant Mandragola");
  expect(script).toContain("s.counter_list={COUNTER_SPELL}");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_FLIP)");
  expect(script).toContain("return c:IsFaceup() and c:IsCanAddCounter(COUNTER_SPELL,1)");
  expect(script).toContain("Duel.GetMatchingGroup(s.filter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,nil)");
  expect(script).toContain("for tc in aux.Next(g) do");
  expect(script).toContain("tc:AddCounter(COUNTER_SPELL,1)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uidOrCode: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uidOrCode || candidate.code === uidOrCode);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(guard++).toBeLessThan(10);
    const actions = getLuaRestoreLegalActions(restored, restored.session.state.waitingFor ?? 0);
    const action = actions.find((candidate) => candidate.type === "passChain");
    expect(action, JSON.stringify(actions, null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
  }
}
