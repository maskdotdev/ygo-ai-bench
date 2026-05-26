import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
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
const zelosCode = "975299";
const bossRushCode = "66947414";
const besFieldCode = "9752990";
const besHandCode = "9752991";
const decoyCode = "9752992";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasZelosScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${zelosCode}.lua`));
const setBes = 0x15;
const counterBes = 0x1f;
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeField = 0x80000;

describe.skipIf(!hasUpstreamScripts || !hasZelosScript)("Lua real script B.E.F. Zelos field counter summon", () => {
  it("restores Boss Rush search, B.E.S. stat/protection field effects, summon, and counter trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${zelosCode}.lua`);
    expectScriptShape(script);
    const source = fixtureSource(workspace);
    const reader = createCardReader(cards());
    const session = createSession(reader, workspace);
    const zelos = requireCard(session, zelosCode);
    const bossRush = requireCard(session, bossRushCode);
    const fieldBes = requireCard(session, besFieldCode);
    const handBes = requireCard(session, besHandCode);
    const decoy = requireCard(session, decoyCode);

    moveDuelCard(session.state, zelos.uid, "hand", 0);
    moveDuelCard(session.state, handBes.uid, "hand", 0);
    moveFaceUp(session, fieldBes, 0);
    moveFaceUp(session, decoy, 0);
    openMain(session);
    registerScripts(session, workspace, source);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader, { promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }] });
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    applyRestoredActionAndAssert(restoredActivation, requireAction(restoredActivation, zelos.uid, "activateEffect"));
    resolveRestoredChainIfOpen(restoredActivation);

    expect(findCard(restoredActivation.session, bossRush.uid)).toMatchObject({ location: "hand", reason: duelReason.effect, reasonCardUid: zelos.uid, reasonEffectId: 1 });
    expect(currentAttack(findCard(restoredActivation.session, fieldBes.uid), restoredActivation.session.state)).toBe(2000);
    expect(currentDefense(findCard(restoredActivation.session, fieldBes.uid), restoredActivation.session.state)).toBe(1700);
    expect(currentAttack(findCard(restoredActivation.session, decoy.uid), restoredActivation.session.state)).toBe(1000);
    expect(restoredActivation.session.state.effects.filter((effect) => effect.sourceUid === zelos.uid && [100, 104, 41, 71].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code, luaTargetDescriptor: effect.luaTargetDescriptor, range: effect.range, targetRange: effect.targetRange, value: effect.value,
    }))).toEqual([
      { code: 100, luaTargetDescriptor: "target:setcode:21", range: ["spellTrapZone"], targetRange: [4, 0], value: 500 },
      { code: 104, luaTargetDescriptor: "target:setcode:21", range: ["spellTrapZone"], targetRange: [4, 0], value: 500 },
      { code: 41, luaTargetDescriptor: "target:setcode:21", range: ["spellTrapZone"], targetRange: [4, 0], value: undefined },
      { code: 71, luaTargetDescriptor: "target:setcode:21", range: ["spellTrapZone"], targetRange: [4, 0], value: undefined },
    ]);

    const summon = requireAction(restoredActivation, zelos.uid, "activateEffect");
    applyRestoredActionAndAssert(restoredActivation, summon);
    resolveRestoredChainIfOpen(restoredActivation);
    expect(findCard(restoredActivation.session, handBes.uid)).toMatchObject({ location: "monsterZone", controller: 0, summonType: "special", reasonCardUid: zelos.uid });

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    applyRestoredActionAndAssert(restoredTrigger, requireAction(restoredTrigger, zelos.uid, "activateTrigger"));
    resolveRestoredChainIfOpen(restoredTrigger);
    expect(getDuelCardCounter(findCard(restoredTrigger.session, handBes.uid), counterBes)).toBe(1);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["sentToHandConfirmed", "specialSummoned", "counterAdded"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventCardUid: bossRush.uid, eventCode: 1212, eventName: "sentToHandConfirmed", eventReason: duelReason.effect, eventReasonCardUid: zelos.uid, eventReasonEffectId: 1, eventReasonPlayer: 0 },
      { eventCardUid: handBes.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: zelos.uid, eventReasonEffectId: 6, eventReasonPlayer: 0 },
      { eventCardUid: handBes.uid, eventCode: 0x10000, eventName: "counterAdded", eventReason: duelReason.effect, eventReasonCardUid: zelos.uid, eventReasonEffectId: 8, eventReasonPlayer: 0 },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,0))");
  expect(script).toContain("e2:SetTarget(aux.TargetBoolFunction(Card.IsSetCard,SET_BES))");
  expect(script).toContain("e4:SetValue(aux.indoval)");
  expect(script).toContain("e5:SetValue(aux.tgoval)");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e7:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("tc:AddCounter(0x1f,1)");
}

function cards(): DuelCardData[] {
  return [
    { code: zelosCode, name: "B.E.F. Zelos", kind: "spell", typeFlags: typeSpell | typeField },
    { code: bossRushCode, name: "Boss Rush", kind: "spell", typeFlags: typeSpell },
    { code: besFieldCode, name: "Zelos Field B.E.S.", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setBes], level: 4, attack: 1500, defense: 1200 },
    { code: besHandCode, name: "Zelos Hand B.E.S.", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setBes], level: 4, attack: 1300, defense: 1000 },
    { code: decoyCode, name: "Zelos Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
  ];
}

function createSession(reader: ReturnType<typeof createCardReader>, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelSession {
  const session = createDuel({ seed: 975299, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [zelosCode, bossRushCode, besFieldCode, besHandCode, decoyCode] }, 1: { main: [] } });
  startDuel(session);
  return session;
}

type ScriptSource = { readScript(name: string): string | undefined };
function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): ScriptSource {
  return { readScript(name: string) {
    if ([`c${besFieldCode}.lua`, `c${besHandCode}.lua`].includes(name)) return `local s,id=GetID(); function s.initial_effect(c) c:EnableCounterPermit(0x1f) end`;
    return workspace.readScript(name);
  } };
}
function registerScripts(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>, source: ScriptSource): void {
  const host = createLuaScriptHost(session, workspace);
  for (const code of [zelosCode, besFieldCode, besHandCode]) expect(host.loadCardScript(Number(code), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(3);
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
