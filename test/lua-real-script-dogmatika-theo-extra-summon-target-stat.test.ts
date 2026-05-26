import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const theoCode = "96891787";
const extraTargetCode = "968917870";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasTheoScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${theoCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const summonTypeFusion = 0x43000000;

describe.skipIf(!hasUpstreamScripts || !hasTheoScript)("Lua real script Dogmatika Theo extra summon target stat", () => {
  it("restores Extra Deck summon-location hand summon and targeted ATK shift", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${theoCode}.lua`);
    expectTheoScriptShape(script);
    const reader = createCardReader(cards());

    const restoredSummon = createRestoredSummonOpen({ reader, workspace });
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const handTheo = requireCard(restoredSummon.session, theoCode);
    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) =>
      action.type === "activateEffect" && action.uid === handTheo.uid && action.effectId === "lua-1"
    );
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summon!);
    resolveRestoredChain(restoredSummon);

    expect(restoredSummon.session.state.cards.find((card) => card.uid === handTheo.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: handTheo.uid,
      reasonEffectId: 1,
    });
    expect(restoredSummon.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: requireCard(restoredSummon.session, extraTargetCode).uid, eventCode: 1102, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "extraDeck", current: "monsterZone" },
      { eventCardUid: handTheo.uid, eventCode: 1102, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: handTheo.uid, eventReasonEffectId: 1, previous: "hand", current: "monsterZone" },
    ]);

    const restoredStat = createRestoredStatOpen({ reader, workspace });
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    const fieldTheo = requireCard(restoredStat.session, theoCode);
    const extraTarget = requireCard(restoredStat.session, extraTargetCode);
    const stat = getLuaRestoreLegalActions(restoredStat, 0).find((action) =>
      action.type === "activateEffect" && action.uid === fieldTheo.uid && action.effectId === "lua-3"
    );
    expect(stat, JSON.stringify(getLuaRestoreLegalActions(restoredStat, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStat, stat!);
    resolveRestoredChain(restoredStat);

    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === fieldTheo.uid), restoredStat.session.state)).toBe(2400);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === extraTarget.uid), restoredStat.session.state)).toBe(1600);
    expect(restoredStat.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: extraTarget.uid, eventCode: 1028, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "extraDeck", current: "monsterZone" },
    ]);
    expect(restoredStat.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: theoCode, name: "Dogmatika Theo, the Iron Punch", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1500 },
    { code: extraTargetCode, name: "Dogmatika Theo Extra Target", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, level: 4, attack: 2200, defense: 1000 },
  ];
}

function createRestoredSummonOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 96891787, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [theoCode], extra: [extraTargetCode] }, 1: { main: [] } });
  startDuel(session);
  const theo = requireCard(session, theoCode);
  const extraTarget = requireCard(session, extraTargetCode);
  moveDuelCard(session.state, theo.uid, "hand", 0);
  specialSummonDuelCard(session.state, extraTarget.uid, 0, 0, {}, summonTypeFusion, true, true);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(theoCode), workspace).ok).toBe(true);
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
  const session = createDuel({ seed: 96891788, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [theoCode], extra: [extraTargetCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, theoCode), 0, 0);
  specialSummonDuelCard(session.state, requireCard(session, extraTargetCode).uid, 0, 0, {}, summonTypeFusion, true, true);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(theoCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectTheoScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Dogmatika Theo, the Iron Punch");
  expect(script).toContain("e1:SetRange(LOCATION_HAND)");
  expect(script).toContain("s.cfilter=aux.FaceupFilter(Card.IsSummonLocation,LOCATION_EXTRA)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e2:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("return c:IsSummonLocation(LOCATION_EXTRA)");
  expect(script).toContain("e3:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("Duel.SelectTarget(tp,s.cfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("c:UpdateAttack(600,RESETS_STANDARD_DISABLE_PHASE_END)");
  expect(script).toContain("tc:UpdateAttack(-600,RESETS_STANDARD_DISABLE_PHASE_END,c)");
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
