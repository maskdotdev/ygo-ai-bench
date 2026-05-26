import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const riryokuGuardianCode = "96661780";
const gateGuardianCode = "25833572";
const kazejinCode = "62340868";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasRiryokuGuardianScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${riryokuGuardianCode}.lua`));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasRiryokuGuardianScript)("Lua real script Riryoku Guardian LP search stat", () => {
  it("restores opponent LP halving ATK gain and grave SelfBanish banished-piece search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${riryokuGuardianCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const statSession = createDuel({ seed: 96661780, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(statSession, { 0: { main: [riryokuGuardianCode, gateGuardianCode] }, 1: { main: [] } });
    startDuel(statSession);
    statSession.state.players[0].lifePoints = 4000;
    statSession.state.players[1].lifePoints = 8000;
    const handGuardian = requireCard(statSession, riryokuGuardianCode);
    const gateGuardian = requireCard(statSession, gateGuardianCode);
    moveDuelCard(statSession.state, handGuardian.uid, "hand", 0);
    moveFaceUpAttack(statSession, gateGuardian, 0, 0);
    statSession.state.phase = "main1";
    statSession.state.turnPlayer = 0;
    statSession.state.waitingFor = 0;
    const statHost = createLuaScriptHost(statSession, workspace);
    expect(statHost.loadCardScript(Number(riryokuGuardianCode), workspace).ok).toBe(true);
    expect(statHost.registerInitialEffects()).toBe(1);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(statSession), workspace, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    const statActivation = getLuaRestoreLegalActions(restoredStat, 0).find((action) =>
      action.type === "activateEffect" && action.uid === handGuardian.uid
    );
    expect(statActivation, JSON.stringify(getLuaRestoreLegalActions(restoredStat, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStat, statActivation!);
    expect(restoredStat.session.state.chain).toEqual([]);
    expect(restoredStat.session.state.players[0].lifePoints).toBe(4000);
    expect(restoredStat.session.state.players[1].lifePoints).toBe(4000);
    const boostedGateGuardian = findCard(restoredStat.session, gateGuardian.uid);
    expect(boostedGateGuardian.attackModifier).toBe(4000);
    expect(currentAttack(boostedGateGuardian, restoredStat.session.state)).toBe(7750);
    expect(findCard(restoredStat.session, handGuardian.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reasonPlayer: 0,
    });
    const restoredStatAfterResolution = restoreDuelWithLuaScripts(serializeDuel(restoredStat.session), workspace, reader);
    expectCleanRestore(restoredStatAfterResolution);
    expectRestoredLegalActions(restoredStatAfterResolution, 0);
    expect(restoredStatAfterResolution.session.state.eventHistory.filter((event) =>
      ["becameTarget"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: gateGuardian.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
    ]);

    const searchSession = createDuel({ seed: 96661781, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(searchSession, { 0: { main: [riryokuGuardianCode, kazejinCode] }, 1: { main: [] } });
    startDuel(searchSession);
    const graveGuardian = requireCard(searchSession, riryokuGuardianCode);
    const kazejin = requireCard(searchSession, kazejinCode);
    moveDuelCard(searchSession.state, graveGuardian.uid, "graveyard", 0).faceUp = true;
    moveDuelCard(searchSession.state, kazejin.uid, "banished", 0).faceUp = true;
    searchSession.state.phase = "main1";
    searchSession.state.turnPlayer = 0;
    searchSession.state.waitingFor = 0;
    const searchHost = createLuaScriptHost(searchSession, workspace);
    expect(searchHost.loadCardScript(Number(riryokuGuardianCode), workspace).ok).toBe(true);
    expect(searchHost.registerInitialEffects()).toBe(1);

    const restoredSearch = restoreDuelWithLuaScripts(serializeDuel(searchSession), workspace, reader);
    expectCleanRestore(restoredSearch);
    expectRestoredLegalActions(restoredSearch, 0);
    const searchActivation = getLuaRestoreLegalActions(restoredSearch, 0).find((action) =>
      action.type === "activateEffect" && action.uid === graveGuardian.uid
    );
    expect(searchActivation, JSON.stringify(getLuaRestoreLegalActions(restoredSearch, 0), null, 2)).toBeDefined();
    if (!searchActivation || searchActivation.type !== "activateEffect") throw new Error("Missing Riryoku Guardian grave activation");
    const searchEffectId = Number(searchActivation.effectId.match(/^lua-(\d+)/)?.[1]);
    applyRestoredActionAndAssert(restoredSearch, searchActivation);

    const restoredSearchChain = restoreDuelWithLuaScripts(serializeDuel(restoredSearch.session), workspace, reader);
    expectCleanRestore(restoredSearchChain);
    expectRestoredLegalActions(restoredSearchChain, 1);
    resolveRestoredChain(restoredSearchChain);
    expect(findCard(restoredSearchChain.session, graveGuardian.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: graveGuardian.uid,
      reasonEffectId: searchEffectId,
    });
    expect(findCard(restoredSearchChain.session, kazejin.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: graveGuardian.uid,
      reasonEffectId: searchEffectId,
    });
    expect(restoredSearchChain.session.state.eventHistory.filter((event) =>
      ["banished", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      ...(event.eventUids === undefined ? {} : { eventUids: event.eventUids }),
    }))).toEqual([
      { eventCardUid: graveGuardian.uid, eventCode: 1011, eventName: "banished", eventPlayer: undefined, eventReason: duelReason.cost, eventReasonCardUid: graveGuardian.uid, eventReasonEffectId: searchEffectId, eventReasonPlayer: 0 },
      { eventCardUid: kazejin.uid, eventCode: 1012, eventName: "sentToHand", eventPlayer: undefined, eventReason: duelReason.effect, eventReasonCardUid: graveGuardian.uid, eventReasonEffectId: searchEffectId, eventReasonPlayer: 0 },
      { eventCardUid: kazejin.uid, eventCode: 1211, eventName: "confirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: graveGuardian.uid, eventReasonEffectId: searchEffectId, eventReasonPlayer: 0, eventUids: [kazejin.uid] },
      { eventCardUid: kazejin.uid, eventCode: 1212, eventName: "sentToHandConfirmed", eventPlayer: 1, eventReason: duelReason.effect, eventReasonCardUid: graveGuardian.uid, eventReasonEffectId: searchEffectId, eventReasonPlayer: 0, eventUids: [kazejin.uid] },
    ]);
    expect(restoredSearchChain.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Riryoku Guardian");
  expect(script).toContain("Duel.GetLP(tp)<Duel.GetLP(1-tp)");
  expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsOriginalSetCard,SET_GATE_GUARDIAN),tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("Duel.SetLP(1-tp,Duel.GetLP(1-tp)/2)");
  expect(script).toContain("tc:UpdateAttack(Duel.GetLP(1-tp),RESET_EVENT|RESETS_STANDARD,e:GetHandler())");
  expect(script).toContain("e2:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("e2:SetCost(Cost.SelfBanish)");
  expect(script).toContain("return c:IsCode(CARDS_SANGA_KAZEJIN_SUIJIN) and c:IsAbleToHand() and (c:IsLocation(LOCATION_DECK) or c:IsFaceup())");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK|LOCATION_REMOVED,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const official = workspace.readDatabaseCards("cards.cdb").filter((card) =>
    [riryokuGuardianCode, gateGuardianCode, kazejinCode].includes(card.code)
  );
  expect(official.map((card) => card.code).sort()).toEqual([gateGuardianCode, kazejinCode, riryokuGuardianCode].sort());
  return official;
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
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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
