import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter, getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const radiationCode = "32692693";
const ursarcticSummonCode = "990326921";
const ursarcticGraveCode = "990326922";
const drawCode = "990326923";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasRadiationScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${radiationCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeContinuous = 0x20000;
const typeEffect = 0x20;
const raceBeast = 0x4000;
const attributeWater = 0x2;
const setUrsarctic = 0x165;
const counterUrsarctic = 0x209;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasRadiationScript)("Lua real script Ursarctic Radiation counter draw toDeck", () => {
  it("restores special-summon counter-cost draw and End Phase Ursarctic shuffle", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${radiationCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredDraw = createRestoredDrawState(reader, workspace);
    expectCleanRestore(restoredDraw);
    const drawRadiation = requireCard(restoredDraw.session, radiationCode);
    const summoned = requireCard(restoredDraw.session, ursarcticSummonCode);
    specialSummonDuelCard(restoredDraw.session.state, summoned.uid, 0);
    expect(restoredDraw.session.state.pendingTriggers.filter((trigger) => trigger.sourceUid === drawRadiation.uid).map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-3-1102", eventCardUid: summoned.uid, eventCode: 1102, eventName: "specialSummoned", player: 0, sourceUid: drawRadiation.uid, triggerBucket: "turnOptional" },
    ]);
    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDraw.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const draw = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === drawRadiation.uid && action.effectId === "lua-3-1102"
    );
    expect(draw, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, draw!);
    resolveRestoredChain(restoredTrigger);
    expect(getDuelCardCounter(findCard(restoredTrigger.session, drawRadiation.uid), counterUrsarctic)).toBe(1);
    expect(findCard(restoredTrigger.session, drawCode)).toMatchObject({
      location: "hand",
      reason: duelReason.rule,
      reasonPlayer: 0,
    });

    const restoredToDeck = createRestoredToDeckState(reader, workspace);
    expectCleanRestore(restoredToDeck);
    expectRestoredLegalActions(restoredToDeck, 0);
    const toDeckRadiation = requireCard(restoredToDeck.session, radiationCode);
    const graveUrsarctic = requireCard(restoredToDeck.session, ursarcticGraveCode);
    const end = getLuaRestoreLegalActions(restoredToDeck, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(end, JSON.stringify(getLuaRestoreLegalActions(restoredToDeck, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredToDeck, end!);
    const toDeck = getLuaRestoreLegalActions(restoredToDeck, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === toDeckRadiation.uid && action.effectId?.endsWith("-4608")
    );
    expect(toDeck, JSON.stringify(getLuaRestoreLegalActions(restoredToDeck, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredToDeck, toDeck!);
    resolveRestoredChain(restoredToDeck);
    expect(findCard(restoredToDeck.session, graveUrsarctic.uid)).toMatchObject({
      location: "deck",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: toDeckRadiation.uid,
      reasonEffectId: 4,
    });
    expect(restoredToDeck.session.state.eventHistory.filter((event) => ["phaseEnd", "becameTarget", "sentToDeck"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "phaseEnd", eventCode: 4608, eventCardUid: undefined, eventReason: undefined, eventReasonPlayer: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: graveUrsarctic.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "sentToDeck", eventCode: 1013, eventCardUid: graveUrsarctic.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: toDeckRadiation.uid, eventReasonEffectId: 4 },
    ]);
  });
});

function createRestoredDrawState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 32692694, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [radiationCode, ursarcticSummonCode, drawCode] }, 1: { main: [] } });
  startDuel(session);
  const radiation = moveFaceUpSpell(session, requireCard(session, radiationCode));
  moveDuelCard(session.state, requireCard(session, ursarcticSummonCode).uid, "hand", 0);
  expect(addDuelCardCounter(radiation, counterUrsarctic, 2)).toBe(true);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerRadiation(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredToDeckState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 32692695, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [radiationCode, ursarcticGraveCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpSpell(session, requireCard(session, radiationCode));
  moveDuelCard(session.state, requireCard(session, ursarcticGraveCode).uid, "graveyard", 0);
  session.state.phase = "main2";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerRadiation(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const radiation = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === radiationCode);
  expect(radiation).toBeDefined();
  return [
    { ...radiation!, kind: "spell", typeFlags: typeSpell | typeContinuous, setcodes: [setUrsarctic] },
    { code: ursarcticSummonCode, name: "Ursarctic Radiation Summoned", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setUrsarctic], race: raceBeast, attribute: attributeWater, level: 7, attack: 2200, defense: 1000 },
    { code: ursarcticGraveCode, name: "Ursarctic Radiation Grave Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setUrsarctic], race: raceBeast, attribute: attributeWater, level: 7, attack: 2100, defense: 1000 },
    { code: drawCode, name: "Ursarctic Radiation Draw", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeWater, level: 4, attack: 1500, defense: 1000 },
  ];
}

function registerRadiation(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(radiationCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Ursarctic Radiation");
  expect(script).toContain("c:EnableCounterPermit(0x209)");
  expect(script).toContain("c:AddCounter(0x209,7)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return c:IsSetCard(SET_URSARCTIC) and c:IsSummonLocation(LOCATION_HAND|LOCATION_EXTRA) and c:IsFaceup()");
  expect(script).toContain("e:GetHandler():RemoveCounter(tp,0x209,1,REASON_COST)");
  expect(script).toContain("Duel.SetTargetPlayer(tp)");
  expect(script).toContain("Duel.SetTargetParam(1)");
  expect(script).toContain("Duel.Draw(p,d,REASON_EFFECT)");
  expect(script).toContain("e3:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("Duel.SelectTarget(tp,s.tdfilter,tp,LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoDeck(tc,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)");
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
