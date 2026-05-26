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
const institutionCode = "94599451";
const searchMonsterCode = "945994510";
const decoyMonsterCode = "945994511";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasInstitutionScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${institutionCode}.lua`));
const counterSpell = 0x1;
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeContinuous = 0x20000;

describe.skipIf(!hasUpstreamScripts || !hasInstitutionScript)("Lua real script Mythical Institution counter search", () => {
  it("restores AnnounceNumber counter-cost search from Deck", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${institutionCode}.lua`);
    expectScriptShape(script);
    const source = fixtureSource(workspace);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 94599451, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [institutionCode, searchMonsterCode, decoyMonsterCode] }, 1: { main: [] } });
    startDuel(session);
    const institution = requireCard(session, institutionCode);
    const searchMonster = requireCard(session, searchMonsterCode);

    const movedInstitution = moveDuelCard(session.state, institution.uid, "spellTrapZone", 0);
    movedInstitution.faceUp = true;
    addDuelCardCounter(movedInstitution, counterSpell, 4);
    openMain(session);
    registerScripts(session, workspace, source);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader, {
      promptOverrides: [{ api: "AnnounceNumber", player: 0, returned: 4 }],
    });
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    applyRestoredActionAndAssert(restored, requireAction(restored, institution.uid, "activateEffect"));
    resolveRestoredChainIfOpen(restored);

    expect(getDuelCardCounter(findCard(restored.session, institution.uid), counterSpell)).toBe(0);
    expect(findCard(restored.session, searchMonster.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonCardUid: institution.uid,
      reasonEffectId: 4,
      reasonPlayer: 0,
    });
    expect(restored.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "AnnounceNumber", player: 0, options: [4], descriptions: [4], returned: 4 },
    ]);
    expect(restored.host.messages).toContain(`confirmed 1: ${searchMonsterCode}`);
    expect(restored.session.state.eventHistory.filter((event) => ["counterRemoved", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventCardUid: institution.uid, eventCode: 0x20000, eventName: "counterRemoved", eventReason: duelReason.cost, eventReasonCardUid: institution.uid, eventReasonEffectId: 4, eventReasonPlayer: 0 },
      { eventCardUid: searchMonster.uid, eventCode: 1012, eventName: "sentToHand", eventReason: duelReason.effect, eventReasonCardUid: institution.uid, eventReasonEffectId: 4, eventReasonPlayer: 0 },
      { eventCardUid: searchMonster.uid, eventCode: 1211, eventName: "confirmed", eventReason: duelReason.effect, eventReasonCardUid: institution.uid, eventReasonEffectId: 4, eventReasonPlayer: 0 },
      { eventCardUid: searchMonster.uid, eventCode: 1212, eventName: "sentToHandConfirmed", eventReason: duelReason.effect, eventReasonCardUid: institution.uid, eventReasonEffectId: 4, eventReasonPlayer: 0 },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toContain("c:EnableCounterPermit(COUNTER_SPELL)");
  expect(script).toContain("e2:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("e:GetHandler():AddCounter(COUNTER_SPELL,2)");
  expect(script).toContain("Duel.AnnounceNumber(tp,table.unpack(lvt))");
  expect(script).toContain("Duel.RemoveCounter(tp,1,0,COUNTER_SPELL,lv,REASON_COST)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
  expect(script).toContain("e4:SetCode(EFFECT_DESTROY_REPLACE)");
  expect(script).toContain("Duel.SelectEffectYesNo(tp,e:GetHandler(),96)");
  expect(script).toContain("e:GetHandler():RemoveCounter(ep,COUNTER_SPELL,1,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: institutionCode, name: "Mythical Institution", kind: "spell", typeFlags: typeSpell | typeContinuous },
    { code: searchMonsterCode, name: "Institution Level 4 Search", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1500, defense: 1200 },
    { code: decoyMonsterCode, name: "Institution Level 5 Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 5, attack: 1600, defense: 1300 },
  ];
}

type ScriptSource = { readScript(name: string): string | undefined };
function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): ScriptSource {
  return { readScript(name: string) {
    if ([`c${searchMonsterCode}.lua`, `c${decoyMonsterCode}.lua`].includes(name)) return `local s,id=GetID(); function s.initial_effect(c) c:EnableCounterPermit(COUNTER_SPELL) end`;
    return workspace.readScript(name);
  } };
}
function registerScripts(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>, source: ScriptSource): void {
  const host = createLuaScriptHost(session, workspace);
  for (const code of [institutionCode, searchMonsterCode, decoyMonsterCode]) expect(host.loadCardScript(Number(code), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(3);
}
function openMain(session: DuelSession): void { session.state.phase = "main1"; session.state.turnPlayer = 0; session.state.waitingFor = 0; }
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
