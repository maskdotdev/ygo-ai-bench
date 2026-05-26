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
const carTurboCode = "96945958";
const windAllyCode = "969459580";
const graveSpeedroidCode = "969459581";
const nonWindCode = "969459582";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCarTurboScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${carTurboCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const attributeWind = 0x8;
const attributeEarth = 0x1;
const setSpeedroid = 0x2016;
const effectCannotActivate = 6;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasCarTurboScript)("Lua real script Speedroid CarTurbo summon banish attack stat", () => {
  it("restores WIND-gated hand summon activation lock and graveyard banish-cost WIND boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${carTurboCode}.lua`);
    expectCarTurboScriptShape(script);
    const reader = createCardReader(cards());

    const restoredSummon = createRestoredSummonOpen({ reader, workspace });
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const carTurbo = requireCard(restoredSummon.session, carTurboCode);
    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) =>
      action.type === "activateEffect" && action.uid === carTurbo.uid && action.effectId === "lua-1"
    );
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summon!);
    resolveRestoredChain(restoredSummon);

    expect(restoredSummon.session.state.cards.find((card) => card.uid === carTurbo.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: carTurbo.uid,
      reasonEffectId: 1,
    });
    expect(restoredSummon.session.state.effects.filter((effect) => effect.sourceUid === carTurbo.uid && effect.code === effectCannotActivate).map((effect) => ({
      code: effect.code,
      description: effect.description,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
    }))).toEqual([
      { code: effectCannotActivate, description: 1551135330, property: 0x4000800, reset: { flags: 0x40000200 }, sourceUid: carTurbo.uid, targetRange: [1, 0] },
    ]);
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
      { eventCardUid: carTurbo.uid, eventCode: 1102, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: carTurbo.uid, eventReasonEffectId: 1, previous: "hand", current: "monsterZone" },
    ]);
    expect(restoredSummon.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredBoost = createRestoredBoostOpen({ reader, workspace });
    expectCleanRestore(restoredBoost);
    expectRestoredLegalActions(restoredBoost, 0);
    const graveCarTurbo = requireCard(restoredBoost.session, carTurboCode);
    const graveSpeedroid = requireCard(restoredBoost.session, graveSpeedroidCode);
    const windAlly = requireCard(restoredBoost.session, windAllyCode);
    const nonWind = requireCard(restoredBoost.session, nonWindCode);
    const boost = getLuaRestoreLegalActions(restoredBoost, 0).find((action) =>
      action.type === "activateEffect" && action.uid === graveCarTurbo.uid && action.effectId === "lua-2"
    );
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredBoost, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBoost, boost!);
    resolveRestoredChain(restoredBoost);

    expect(restoredBoost.session.state.cards.find((card) => card.uid === graveCarTurbo.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: graveCarTurbo.uid,
      reasonEffectId: 2,
    });
    expect(restoredBoost.session.state.cards.find((card) => card.uid === graveSpeedroid.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: graveCarTurbo.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredBoost.session.state.cards.find((card) => card.uid === windAlly.uid), restoredBoost.session.state)).toBe(2300);
    expect(currentAttack(restoredBoost.session.state.cards.find((card) => card.uid === nonWind.uid), restoredBoost.session.state)).toBe(1700);
    expect(restoredBoost.session.state.effects.filter((effect) => effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: 0x400, reset: { flags: 1107169792 }, sourceUid: windAlly.uid, value: 800 },
    ]);
    expect(restoredBoost.session.state.eventHistory.filter((event) => ["banished"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: graveSpeedroid.uid, eventCode: 1011, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: graveCarTurbo.uid, eventReasonEffectId: 2, previous: "graveyard", current: "banished" },
      { eventCardUid: graveCarTurbo.uid, eventCode: 1011, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: graveCarTurbo.uid, eventReasonEffectId: 2, previous: "graveyard", current: "banished" },
      { eventCardUid: graveSpeedroid.uid, eventCode: 1011, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: graveCarTurbo.uid, eventReasonEffectId: 2, previous: "graveyard", current: "banished" },
    ]);
    expect(restoredBoost.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: carTurboCode, name: "Speedroid CarTurbo", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeWind, setcodes: [setSpeedroid], level: 3, attack: 800, defense: 1200 },
    { code: windAllyCode, name: "CarTurbo WIND Ally", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeWind, level: 4, attack: 1500, defense: 1200 },
    { code: graveSpeedroidCode, name: "CarTurbo Grave Speedroid", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeWind, setcodes: [setSpeedroid], level: 3, attack: 1000, defense: 1000 },
    { code: nonWindCode, name: "CarTurbo Non-WIND", kind: "monster", typeFlags: typeMonster | typeEffect, attribute: attributeEarth, level: 4, attack: 1700, defense: 1000 },
  ];
}

function createRestoredSummonOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 96945958, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [carTurboCode, windAllyCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, carTurboCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, windAllyCode), 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(carTurboCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredBoostOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 96945959, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [carTurboCode, graveSpeedroidCode, windAllyCode, nonWindCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, carTurboCode).uid, "graveyard", 0);
  moveDuelCard(session.state, requireCard(session, graveSpeedroidCode).uid, "graveyard", 0);
  moveFaceUpAttack(session, requireCard(session, windAllyCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, nonWindCode), 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(carTurboCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectCarTurboScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Speedroid CarTurbo");
  expect(script).toContain("e1:SetRange(LOCATION_HAND)");
  expect(script).toContain("Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsAttribute,ATTRIBUTE_WIND),tp,LOCATION_MZONE,0,1,nil)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ACTIVATE)");
  expect(script).toContain("Duel.RegisterEffect(e1,tp)");
  expect(script).toContain("e2:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_GRAVE,0,1,1,c)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
  expect(script).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsAttribute,ATTRIBUTE_WIND),tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
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
