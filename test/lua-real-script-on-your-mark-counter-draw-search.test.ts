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
const markCode = "31006879";
const synchronCode = "990310681";
const handCode = "990310682";
const drawOneCode = "990310683";
const drawTwoCode = "990310684";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasMarkScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${markCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeField = 0x80000;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x10;
const setSynchron = 0x1017;
const counterSignal = 0x1148;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasMarkScript)("Lua real script On Your Mark counter draw search", () => {
  it("restores optional Synchron search, Standby Signal Counter gain, and counter-cost draw discard", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${markCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredSearch = createRestoredSearchState(reader, workspace);
    expectCleanRestore(restoredSearch);
    expectRestoredLegalActions(restoredSearch, 0);
    const mark = requireCard(restoredSearch.session, markCode);
    const synchron = requireCard(restoredSearch.session, synchronCode);
    const activate = getLuaRestoreLegalActions(restoredSearch, 0).find((action) =>
      action.type === "activateEffect" && action.uid === mark.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredSearch, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSearch, activate!);
    resolveRestoredChain(restoredSearch);
    expect(findCard(restoredSearch.session, mark.uid)).toMatchObject({ location: "spellTrapZone", controller: 0, faceUp: true });
    expect(findCard(restoredSearch.session, synchron.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: mark.uid,
      reasonEffectId: 1,
    });
    expect(restoredSearch.host.promptDecisions).toContainEqual({ id: "lua-prompt-1", api: "SelectYesNo", player: 0, description: 496110064, returned: true });
    expect(restoredSearch.host.messages).toContain(`confirmed 1: ${synchronCode}`);

    const restoredStandby = createRestoredStandbyState(reader, workspace);
    expectCleanRestore(restoredStandby);
    expectRestoredLegalActions(restoredStandby, 0);
    const standby = getLuaRestoreLegalActions(restoredStandby, 0).find((action) => action.type === "changePhase" && action.phase === "standby");
    expect(standby, JSON.stringify(getLuaRestoreLegalActions(restoredStandby, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStandby, standby!);
    const standbyMark = requireCard(restoredStandby.session, markCode);
    const counterTrigger = getLuaRestoreLegalActions(restoredStandby, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === standbyMark.uid && action.effectId?.endsWith("-4098")
    );
    expect(counterTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredStandby, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStandby, counterTrigger!);
    resolveRestoredChain(restoredStandby);
    expect(getDuelCardCounter(findCard(restoredStandby.session, standbyMark.uid), counterSignal)).toBe(1);

    const restoredDraw = createRestoredDrawState(reader, workspace);
    expectCleanRestore(restoredDraw);
    expectRestoredLegalActions(restoredDraw, 0);
    const drawMark = requireCard(restoredDraw.session, markCode);
    const draw = getLuaRestoreLegalActions(restoredDraw, 0).find((action) =>
      action.type === "activateEffect" && action.uid === drawMark.uid && action.effectId === "lua-3"
    );
    expect(draw, JSON.stringify(getLuaRestoreLegalActions(restoredDraw, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDraw, draw!);
    resolveRestoredChain(restoredDraw);
    expect(findCard(restoredDraw.session, drawMark.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: drawMark.uid,
      reasonEffectId: 3,
    });
    expect(restoredDraw.session.state.cards.filter((card) => card.controller === 0 && card.location === "hand").map((card) => card.code).sort()).toHaveLength(2);
    const discarded = restoredDraw.session.state.cards.filter((card) =>
      [handCode, drawOneCode, drawTwoCode].includes(card.code) && card.location === "graveyard" && card.reason === duelReason.effect
    );
    expect(discarded.map((card) => ({
      reasonCardUid: card.reasonCardUid,
      reasonEffectId: card.reasonEffectId,
      reasonPlayer: card.reasonPlayer,
    }))).toEqual([{ reasonCardUid: drawMark.uid, reasonEffectId: 3, reasonPlayer: 0 }]);
    expect(restoredDraw.session.state.eventHistory.filter((event) => ["counterRemoved", "sentToGraveyard", "breakEffect"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "counterRemoved", eventCode: 0x20000, eventCardUid: drawMark.uid, eventPlayer: undefined, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: drawMark.uid, eventReasonEffectId: 3 },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: drawMark.uid, eventPlayer: undefined, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: drawMark.uid, eventReasonEffectId: 3 },
      { eventName: "breakEffect", eventCode: 1050, eventCardUid: undefined, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: drawMark.uid, eventReasonEffectId: 3 },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: discarded[0]?.uid, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: drawMark.uid, eventReasonEffectId: 3 },
    ]);
  });
});

function createRestoredSearchState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 31006879, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [markCode, synchronCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, markCode).uid, "hand", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerMark(session, workspace, true);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }] });
}

function createRestoredStandbyState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 31006880, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [markCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpSpell(session, requireCard(session, markCode));
  session.state.phase = "draw";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerMark(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredDrawState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 31006881, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [markCode, handCode, drawOneCode, drawTwoCode] }, 1: { main: [] } });
  startDuel(session);
  const mark = moveFaceUpSpell(session, requireCard(session, markCode));
  moveDuelCard(session.state, requireCard(session, handCode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, drawOneCode).uid, "deck", 0);
  moveDuelCard(session.state, requireCard(session, drawTwoCode).uid, "deck", 0);
  expect(addDuelCardCounter(mark, counterSignal, 2)).toBe(true);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerMark(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const mark = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === markCode);
  expect(mark).toBeDefined();
  return [
    { ...mark!, kind: "spell", typeFlags: typeSpell | typeField },
    { code: synchronCode, name: "On Your Mark Synchron", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setSynchron], race: raceWarrior, attribute: attributeEarth, level: 3, attack: 1300, defense: 1000 },
    { code: handCode, name: "On Your Mark Hand Card", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1400, defense: 1000 },
    { code: drawOneCode, name: "On Your Mark Draw One", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1500, defense: 1000 },
    { code: drawTwoCode, name: "On Your Mark Draw Two", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000 },
  ];
}

function registerMark(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>, yesPrompt = false): void {
  const host = createLuaScriptHost(session, workspace, yesPrompt ? { promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }] } : undefined);
  expect(host.loadCardScript(Number(markCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--On Your Mark, Get Set, DUEL!");
  expect(script).toContain("s.listed_series={SET_SYNCHRON}");
  expect(script).toContain("s.counter_place_list={COUNTER_SIGNAL}");
  expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)");
  expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,0))");
  expect(script).toContain("Duel.SendtoHand(sg,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,sg)");
  expect(script).toContain("e2:SetCode(EVENT_PHASE|PHASE_STANDBY)");
  expect(script).toContain("e:GetHandler():AddCounter(COUNTER_SIGNAL,1)");
  expect(script).toContain("Duel.IsCanRemoveCounter(tp,1,0,COUNTER_SIGNAL,2,REASON_COST)");
  expect(script).toContain("Duel.RemoveCounter(tp,1,0,COUNTER_SIGNAL,2,REASON_COST)");
  expect(script).toContain("Duel.SendtoGrave(c,REASON_COST)");
  expect(script).toContain("Duel.Draw(p,d,REASON_EFFECT)");
  expect(script).toContain("Duel.ShuffleHand(p)");
  expect(script).toContain("Duel.DiscardHand(p,nil,1,1,REASON_EFFECT)");
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

function moveFaceUpSpell(session: DuelSession, card: DuelCardInstance): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.sequence = 0;
  moved.faceUp = true;
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
