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
const apprenticeCode = "9156135";
const counterTargetCode = "91561350";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasApprenticeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${apprenticeCode}.lua`));
const counterSpell = 0x1;
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasApprenticeScript)("Lua real script Apprentice Magician counter target", () => {
  it("restores summon-success target selection into Spell Counter placement", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${apprenticeCode}.lua`);
    expectScriptShape(script);
    const source = fixtureSource(workspace);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 9156135, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [apprenticeCode, counterTargetCode] }, 1: { main: [] } });
    startDuel(session);
    const apprentice = requireCard(session, apprenticeCode);
    const target = requireCard(session, counterTargetCode);
    moveDuelCard(session.state, apprentice.uid, "hand", 0);
    moveFaceUp(session, target, 0);
    openMain(session);
    registerScripts(session, workspace, source);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    applyRestoredActionAndAssert(restoredOpen, requireAction(restoredOpen, apprentice.uid, "normalSummon"));

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    applyRestoredActionAndAssert(restoredTrigger, requireAction(restoredTrigger, apprentice.uid, "activateTrigger"));
    resolveRestoredChainIfOpen(restoredTrigger);

    expect(getDuelCardCounter(findCard(restoredTrigger.session, target.uid), counterSpell)).toBe(1);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["normalSummoned", "becameTarget", "counterAdded"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventCardUid: apprentice.uid, eventCode: 1100, eventName: "normalSummoned", eventReason: duelReason.summon, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: target.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: target.uid, eventCode: 0x10000, eventName: "counterAdded", eventReason: duelReason.effect, eventReasonCardUid: apprentice.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e2:SetCode(EVENT_FLIP_SUMMON_SUCCESS)");
  expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)");
  expect(script).toContain("tc:AddCounter(COUNTER_SPELL,1)");
  expect(script).toContain("e4:SetCode(EVENT_BATTLE_DESTROYED)");
  expect(script).toContain("c:IsCanBeSpecialSummoned(e,0,tp,false,false,POS_FACEDOWN_DEFENSE)");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEDOWN_DEFENSE)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
}

function cards(): DuelCardData[] {
  return [
    { code: apprenticeCode, name: "Apprentice Magician", kind: "monster", typeFlags: typeMonster | typeEffect, level: 2, attack: 400, defense: 800, race: 2 },
    { code: counterTargetCode, name: "Apprentice Counter Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1200, defense: 1000 },
  ];
}

type ScriptSource = { readScript(name: string): string | undefined };
function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): ScriptSource {
  return { readScript(name: string) {
    if (name === `c${counterTargetCode}.lua`) return `local s,id=GetID(); function s.initial_effect(c) c:EnableCounterPermit(COUNTER_SPELL) end`;
    return workspace.readScript(name);
  } };
}
function registerScripts(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>, source: ScriptSource): void {
  const host = createLuaScriptHost(session, workspace);
  for (const code of [apprenticeCode, counterTargetCode]) expect(host.loadCardScript(Number(code), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
}
function openMain(session: DuelSession): void { session.state.phase = "main1"; session.state.turnPlayer = 0; session.state.waitingFor = 0; }
function moveFaceUp(session: DuelSession, card: DuelCardInstance, controller: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller); moved.faceUp = true; moved.position = "faceUpAttack";
}
function requireAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, uid: string, type: DuelAction["type"]): DuelAction {
  const action = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === type && (candidate as { uid?: string }).uid === uid);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
  return action!;
}
function resolveRestoredChainIfOpen(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  if (restored.session.state.chain.length === 0) return;
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => (action as { type: string }).type === "pass");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
}
function slimEvent(event: { eventName: string; eventCode?: number; eventCardUid?: string; eventReason?: number; eventReasonCardUid?: string; eventReasonEffectId?: number; eventReasonPlayer?: PlayerId }) {
  return { eventCardUid: event.eventCardUid, eventCode: event.eventCode, eventName: event.eventName, eventReason: event.eventReason, eventReasonCardUid: event.eventReasonCardUid, eventReasonEffectId: event.eventReasonEffectId, eventReasonPlayer: event.eventReasonPlayer };
}
function requireCard(session: DuelSession, code: string): DuelCardInstance { const card = session.state.cards.find((candidate) => candidate.code === code); expect(card).toBeDefined(); return card!; }
function findCard(session: DuelSession, uid: string): DuelCardInstance { const card = session.state.cards.find((candidate) => candidate.uid === uid); expect(card).toBeDefined(); return card!; }
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
  expect(response.legalActions).toEqual(getLegalActions(restored.session, response.state.waitingFor!));
}
