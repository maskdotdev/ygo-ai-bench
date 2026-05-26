import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
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
const crusaderCode = "73853830";
const spellCounterTargetCode = "91182675";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCrusaderScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${crusaderCode}.lua`));
const hasSpellCounterTargetScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${spellCounterTargetCode}.lua`));
const counterSpell = 0x1;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasCrusaderScript || !hasSpellCounterTargetScript)("Lua real script Crusader of Endymion Gemini counter stat", () => {
  it("restores Gemini-status targeted Spell Counter placement into self ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${crusaderCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredOpen = createRestoredOpen(reader, workspace);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const crusader = requireCard(restoredOpen.session, crusaderCode);
    const target = requireCard(restoredOpen.session, spellCounterTargetCode);
    expect(getLuaRestoreLegalActions(restoredOpen, 0).some((action) => action.type === "activateEffect" && action.uid === crusader.uid)).toBe(false);
    const geminiSummon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "normalSummon" && action.uid === crusader.uid);
    expect(geminiSummon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, geminiSummon!);

    const restoredGemini = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredGemini);
    expectRestoredLegalActions(restoredGemini, 0);
    const counterAction = getLuaRestoreLegalActions(restoredGemini, 0).find((action) => action.type === "activateEffect" && action.uid === crusader.uid);
    expect(counterAction, JSON.stringify(getLuaRestoreLegalActions(restoredGemini, 0), null, 2)).toBeDefined();
    expect(counterAction?.type).toBe("activateEffect");
    if (!counterAction || counterAction.type !== "activateEffect") throw new Error("Expected Crusader counter activation");
    const counterEffectId = counterAction.effectId;
    applyRestoredActionAndAssert(restoredGemini, counterAction!);
    resolveRestoredChain(restoredGemini);

    expect(getDuelCardCounter(findCard(restoredGemini.session, target.uid), counterSpell)).toBe(1);
    expect(currentAttack(findCard(restoredGemini.session, crusader.uid), restoredGemini.session.state)).toBe(2500);
    expect(restoredGemini.session.state.effects.filter((effect) => effect.sourceUid === crusader.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([{ code: effectUpdateAttack, event: "continuous", reset: { flags: 1107235328 }, sourceUid: crusader.uid, value: 600 }]);
    expect(restoredGemini.session.state.eventHistory.filter((event) => ["normalSummoned", "becameTarget", "counterAdded"].includes(event.eventName)).map((event) => eventSummary(event))).toEqual([
      { eventName: "normalSummoned", eventCode: 1100, eventCardUid: crusader.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: target.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: target.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: crusader.uid, eventReasonEffectId: counterEffectNumber(counterEffectId) },
    ]);

    const finalRestore = restoreDuelWithLuaScripts(serializeDuel(restoredGemini.session), workspace, reader);
    expectCleanRestore(finalRestore);
    expectRestoredLegalActions(finalRestore, 0);
    expect(currentAttack(findCard(finalRestore.session, crusader.uid), finalRestore.session.state)).toBe(2500);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const rows = workspace.readDatabaseCards("cards.cdb");
  const crusader = rows.find((card) => card.code === crusaderCode);
  const target = rows.find((card) => card.code === spellCounterTargetCode);
  expect(crusader).toBeDefined();
  expect(target).toBeDefined();
  return [crusader!, target!];
}

function createRestoredOpen(reader: ReturnType<typeof createCardReader>, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 73853830, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [crusaderCode, spellCounterTargetCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, crusaderCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, spellCounterTargetCode), 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(crusaderCode), workspace).ok).toBe(true);
  expect(host.loadCardScript(Number(spellCounterTargetCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Crusader of Endymion");
  expect(script).toContain("Gemini.AddProcedure(c)");
  expect(script).toContain("e1:SetCondition(Gemini.EffectStatusCondition)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsCanAddCounter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil,COUNTER_SPELL,1)");
  expect(script).toContain("tc:AddCounter(COUNTER_SPELL,1)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(600)");
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
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function eventSummary(event: { eventName: string; eventCode?: number; eventCardUid?: string; eventReason?: number; eventReasonPlayer?: PlayerId; eventReasonCardUid?: string; eventReasonEffectId?: number }) {
  return {
    eventName: event.eventName,
    eventCode: event.eventCode,
    eventCardUid: event.eventCardUid,
    eventReason: event.eventReason,
    eventReasonPlayer: event.eventReasonPlayer,
    eventReasonCardUid: event.eventReasonCardUid,
    eventReasonEffectId: event.eventReasonEffectId,
  };
}

function counterEffectNumber(effectId: string): number {
  return Number(effectId.replace("lua-", "").split("-")[0]);
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
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
