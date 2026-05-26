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
const derringerCode = "5121528";
const bossRushCode = "66947414";
const crystalCoreCode = "22790789";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasDerringerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${derringerCode}.lua`));
const counterBes = 0x1f;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasDerringerScript)("Lua real script B.E.S. Derringer Core counter SelectEffect", () => {
  it("restores counter-cost quick effect into Boss Rush search branch", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${derringerCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const { restored, derringer, bossRush } = createRestoredScenario(workspace, reader, [{ api: "SelectEffect", player: 0, returned: 1 }]);

    expectRestoredLegalActions(restored, 0);
    const action = quickEffect(restored, derringer.uid);
    applyRestoredActionAndAssert(restored, action);
    expect(getDuelCardCounter(findCard(restored.session, derringer.uid), counterBes)).toBe(0);
    resolveRestoredChainIfOpen(restored);

    expect(findCard(restored.session, bossRush.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonCardUid: derringer.uid,
      reasonEffectId: 3,
      reasonPlayer: 0,
    });
    expect(restored.host.messages).toContain(`confirmed 1: ${bossRushCode}`);
    expect(restored.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectEffect", player: 0, options: [1, 2], descriptions: [81944450, 81944451], returned: 1 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) =>
      ["counterRemoved", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: derringer.uid, eventCode: 0x20000, eventName: "counterRemoved", eventPlayer: undefined, eventReason: duelReason.cost, eventReasonCardUid: derringer.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
      { eventCardUid: bossRush.uid, eventCode: 1012, eventName: "sentToHand", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: derringer.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
      { eventCardUid: bossRush.uid, eventCode: 1211, eventName: "confirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: derringer.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
      { eventCardUid: bossRush.uid, eventCode: 1212, eventName: "sentToHandConfirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: derringer.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
    ]);
  });

  it("restores counter-cost quick effect into graveyard B.E.S. Special Summon branch", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${derringerCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const { restored, derringer, crystalCore } = createRestoredScenario(workspace, reader, [{ api: "SelectEffect", player: 0, returned: 2 }]);

    expectRestoredLegalActions(restored, 0);
    applyRestoredActionAndAssert(restored, quickEffect(restored, derringer.uid));
    expect(getDuelCardCounter(findCard(restored.session, derringer.uid), counterBes)).toBe(0);
    resolveRestoredChainIfOpen(restored);

    expect(findCard(restored.session, crystalCore.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonCardUid: derringer.uid,
      reasonEffectId: 3,
      reasonPlayer: 0,
    });
    expect(restored.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectEffect", player: 0, options: [1, 2], descriptions: [81944450, 81944451], returned: 2 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) =>
      ["counterRemoved", "specialSummoned"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: derringer.uid, eventCode: 0x20000, eventName: "counterRemoved", eventReason: duelReason.cost, eventReasonCardUid: derringer.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
      { eventCardUid: crystalCore.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: derringer.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toContain("c:EnableCounterPermit(COUNTER_BES)");
  expect(script).toContain("e1:SetCost(Cost.Reveal(function(c) return c:IsSetCard(SET_BES) and c:IsMonster() end,true))");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("c:AddCounter(COUNTER_BES,3)");
  expect(script).toContain("e2:SetCost(Cost.RemoveCounterFromSelf(COUNTER_BES,1))");
  expect(script).toContain("local op=Duel.SelectEffect(tp,");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const wanted = new Set([derringerCode, bossRushCode, crystalCoreCode]);
  return workspace.readDatabaseCards("cards.cdb").filter((card) => wanted.has(card.code));
}

function createRestoredScenario(
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  reader: ReturnType<typeof createCardReader>,
  promptOverrides: { api: "SelectEffect"; player: 0; returned: number }[],
) {
  const session = createDuel({ seed: 5121528, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [derringerCode, bossRushCode, crystalCoreCode] }, 1: { main: [] } });
  startDuel(session);
  const derringer = requireCard(session, derringerCode);
  const bossRush = requireCard(session, bossRushCode);
  const crystalCore = requireCard(session, crystalCoreCode);
  const movedDerringer = moveDuelCard(session.state, derringer.uid, "monsterZone", 0);
  movedDerringer.position = "faceUpAttack";
  movedDerringer.faceUp = true;
  moveDuelCard(session.state, crystalCore.uid, "graveyard", 0);
  addDuelCardCounter(derringer, counterBes, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(derringerCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides });
  expectCleanRestore(restored);
  return { restored, derringer, bossRush, crystalCore };
}

function quickEffect(restored: ReturnType<typeof restoreDuelWithLuaScripts>, uid: string): DuelAction {
  const action = getLuaRestoreLegalActions(restored, 0).find((candidate) =>
    candidate.type === "activateEffect" && candidate.uid === uid && candidate.effectId === "lua-3-1002"
  );
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
  return action!;
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

function resolveRestoredChainIfOpen(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  if (restored.session.state.chain.length === 0) return;
  const pass = getLuaRestoreLegalActions(restored, restored.session.state.waitingFor!).find((action) => (action as { type: string }).type === "pass");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, restored.session.state.waitingFor!), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
}
