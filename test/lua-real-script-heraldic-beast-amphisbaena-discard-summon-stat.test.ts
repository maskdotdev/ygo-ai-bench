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
const amphisbaenaCode = "87255382";
const heraldicDiscardCode = "872553820";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAmphisbaenaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${amphisbaenaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const setHeraldicBeast = 0x76;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasAmphisbaenaScript)("Lua real script Heraldic Beast Amphisbaena discard summon stat", () => {
  it("restores Heraldic Beast discard cost into hand Special Summon and on-field ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${amphisbaenaCode}.lua`);
    expectAmphisbaenaScriptShape(script);
    const reader = createCardReader(cards());

    const restoredSummon = createRestoredSummonOpen({ reader, workspace });
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const handAmphisbaena = requireCard(restoredSummon.session, amphisbaenaCode);
    const summonDiscard = requireCard(restoredSummon.session, heraldicDiscardCode);
    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) =>
      action.type === "activateEffect" && action.uid === handAmphisbaena.uid && action.effectId === "lua-1"
    );
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summon!);
    resolveRestoredChain(restoredSummon);

    expect(restoredSummon.session.state.cards.find((card) => card.uid === summonDiscard.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "hand",
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: handAmphisbaena.uid,
      reasonEffectId: 1,
    });
    expect(restoredSummon.session.state.cards.find((card) => card.uid === handAmphisbaena.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: handAmphisbaena.uid,
      reasonEffectId: 1,
    });
    expect(restoredSummon.session.state.eventHistory.filter((event) => ["discarded", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "discarded", eventCode: 1018, eventCardUid: summonDiscard.uid, eventReason: duelReason.cost | duelReason.discard, eventReasonPlayer: 0, eventReasonCardUid: handAmphisbaena.uid, eventReasonEffectId: 1, previous: "hand", current: "graveyard" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: handAmphisbaena.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: handAmphisbaena.uid, eventReasonEffectId: 1, previous: "hand", current: "monsterZone" },
    ]);

    const restoredStat = createRestoredStatOpen({ reader, workspace });
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    const fieldAmphisbaena = requireCard(restoredStat.session, amphisbaenaCode);
    const statDiscard = requireCard(restoredStat.session, heraldicDiscardCode);
    const stat = getLuaRestoreLegalActions(restoredStat, 0).find((action) =>
      action.type === "activateEffect" && action.uid === fieldAmphisbaena.uid && action.effectId === "lua-2"
    );
    expect(stat, JSON.stringify(getLuaRestoreLegalActions(restoredStat, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStat, stat!);
    resolveRestoredChain(restoredStat);

    expect(restoredStat.session.state.cards.find((card) => card.uid === statDiscard.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "hand",
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: fieldAmphisbaena.uid,
      reasonEffectId: 2,
    });
    expect(restoredStat.session.state.effects.filter((effect) => effect.sourceUid === fieldAmphisbaena.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107235328 }, sourceUid: fieldAmphisbaena.uid, value: 800 },
    ]);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === fieldAmphisbaena.uid), restoredStat.session.state)).toBe(2500);
    expect(restoredStat.session.state.eventHistory.filter((event) => event.eventName === "discarded").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "discarded", eventCode: 1018, eventCardUid: statDiscard.uid, eventReason: duelReason.cost | duelReason.discard, eventReasonPlayer: 0, eventReasonCardUid: fieldAmphisbaena.uid, eventReasonEffectId: 2, previous: "hand", current: "graveyard" },
    ]);
    expect(restoredStat.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: amphisbaenaCode, name: "Heraldic Beast Amphisbaena", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setHeraldicBeast], level: 4, attack: 1700, defense: 1100 },
    { code: heraldicDiscardCode, name: "Heraldic Beast Discard Cost", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setHeraldicBeast], level: 4, attack: 1000, defense: 1000 },
  ];
}

function createRestoredSummonOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 87255382, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [amphisbaenaCode, heraldicDiscardCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, amphisbaenaCode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, heraldicDiscardCode).uid, "hand", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(amphisbaenaCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredStatOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 87255383, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [amphisbaenaCode, heraldicDiscardCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, amphisbaenaCode), 0, 0);
  moveDuelCard(session.state, requireCard(session, heraldicDiscardCode).uid, "hand", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(amphisbaenaCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectAmphisbaenaScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Heraldic Beast Amphisbaena");
  expect(script).toContain("e1:SetRange(LOCATION_HAND)");
  expect(script).toContain("e2:SetRange(LOCATION_MZONE)");
  expect(script).toContain("return c:IsSetCard(SET_HERALDIC_BEAST) and c:IsDiscardable()");
  expect(script).toContain("Duel.DiscardHand(tp,s.cfilter,1,1,REASON_COST|REASON_DISCARD,e:GetHandler())");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END)");
  expect(script).toContain("e1:SetValue(800)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
  const waitingFor = restored.session.state.waitingFor;
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
