import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const urubonusCode = "47077697";
const reptileCostCode = "470776970";
const secondCostCode = "470776971";
const opponentOneCode = "470776972";
const opponentTwoCode = "470776973";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUrubonusScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${urubonusCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceReptile = 0x80000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const effectUpdateAttack = 100;
const effectUpdateDefense = 104;

describe.skipIf(!hasUpstreamScripts || !hasUrubonusScript)("Lua real script Urubonus release summon field stat", () => {
  it("restores Reptile release-cost hand summon and released-ATK opponent field reduction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${urubonusCode}.lua`);
    expectUrubonusScriptShape(script);
    const reader = createCardReader(cards());

    const restoredSummon = createRestoredSummonOpen({ reader, workspace });
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const urubonus = requireCard(restoredSummon.session, urubonusCode);
    const reptileCost = requireCard(restoredSummon.session, reptileCostCode);
    const opponentOne = requireCard(restoredSummon.session, opponentOneCode);
    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) =>
      action.type === "activateEffect" && action.uid === urubonus.uid && action.effectId === "lua-1"
    );
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summon!);
    resolveRestoredChain(restoredSummon);

    expect(restoredSummon.session.state.cards.find((card) => card.uid === reptileCost.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: urubonus.uid,
      reasonEffectId: 1,
    });
    expect(restoredSummon.session.state.cards.find((card) => card.uid === urubonus.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: urubonus.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredSummon.session.state.cards.find((card) => card.uid === opponentOne.uid), restoredSummon.session.state)).toBe(1700);
    expect(currentDefense(restoredSummon.session.state.cards.find((card) => card.uid === opponentOne.uid), restoredSummon.session.state)).toBe(1200);
    expect(restoredSummon.session.state.effects.filter((effect) =>
      effect.sourceUid === urubonus.uid && [effectUpdateAttack, effectUpdateDefense].includes(effect.code ?? -1)
    ).map((effect) => ({
      code: effect.code,
      range: effect.range,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, range: ["monsterZone"], sourceUid: urubonus.uid, targetRange: [0, 4], value: -300 },
      { code: effectUpdateDefense, range: ["monsterZone"], sourceUid: urubonus.uid, targetRange: [0, 4], value: -300 },
    ]);
    expect(restoredSummon.session.state.eventHistory.filter((event) => ["released", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "released", eventCardUid: reptileCost.uid, eventCode: 1017, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: urubonus.uid, eventReasonEffectId: 1, previous: "monsterZone", current: "graveyard" },
      { eventName: "specialSummoned", eventCardUid: urubonus.uid, eventCode: 1102, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: urubonus.uid, eventReasonEffectId: 1, previous: "hand", current: "monsterZone" },
    ]);
    expect(restoredSummon.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredDebuff = createRestoredDebuffOpen({ reader, workspace });
    expectCleanRestore(restoredDebuff);
    expectRestoredLegalActions(restoredDebuff, 0);
    const fieldUrubonus = requireCard(restoredDebuff.session, urubonusCode);
    const secondCost = requireCard(restoredDebuff.session, secondCostCode);
    const debuffTargetOne = requireCard(restoredDebuff.session, opponentOneCode);
    const debuffTargetTwo = requireCard(restoredDebuff.session, opponentTwoCode);
    const debuff = getLuaRestoreLegalActions(restoredDebuff, 0).find((action) =>
      action.type === "activateEffect" && action.uid === fieldUrubonus.uid && action.effectId === "lua-4"
    );
    expect(debuff, JSON.stringify(getLuaRestoreLegalActions(restoredDebuff, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDebuff, debuff!);
    resolveRestoredChain(restoredDebuff);

    expect(restoredDebuff.session.state.cards.find((card) => card.uid === secondCost.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: fieldUrubonus.uid,
      reasonEffectId: 4,
    });
    expect(currentAttack(restoredDebuff.session.state.cards.find((card) => card.uid === debuffTargetOne.uid), restoredDebuff.session.state)).toBe(900);
    expect(currentDefense(restoredDebuff.session.state.cards.find((card) => card.uid === debuffTargetOne.uid), restoredDebuff.session.state)).toBe(400);
    expect(currentAttack(restoredDebuff.session.state.cards.find((card) => card.uid === debuffTargetTwo.uid), restoredDebuff.session.state)).toBe(1400);
    expect(currentDefense(restoredDebuff.session.state.cards.find((card) => card.uid === debuffTargetTwo.uid), restoredDebuff.session.state)).toBe(900);
    expect(restoredDebuff.session.state.effects.filter((effect) =>
      [effectUpdateAttack, effectUpdateDefense].includes(effect.code ?? -1)
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: undefined, sourceUid: fieldUrubonus.uid, targetRange: [0, 4], value: -300 },
      { code: effectUpdateDefense, reset: undefined, sourceUid: fieldUrubonus.uid, targetRange: [0, 4], value: -300 },
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: debuffTargetOne.uid, targetRange: undefined, value: -800 },
      { code: effectUpdateDefense, reset: { flags: 1107169792 }, sourceUid: debuffTargetOne.uid, targetRange: undefined, value: -800 },
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: debuffTargetTwo.uid, targetRange: undefined, value: -800 },
      { code: effectUpdateDefense, reset: { flags: 1107169792 }, sourceUid: debuffTargetTwo.uid, targetRange: undefined, value: -800 },
    ]);
    expect(restoredDebuff.session.state.eventHistory.filter((event) => event.eventName === "released").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: secondCost.uid, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: fieldUrubonus.uid, eventReasonEffectId: 4, previous: "monsterZone", current: "graveyard" },
    ]);
    expect(restoredDebuff.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: urubonusCode, name: "Urubonus, the Avatar of Malice", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeDark, level: 5, attack: 2000, defense: 800 },
    { code: reptileCostCode, name: "Urubonus Reptile Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeDark, level: 4, attack: 600, defense: 600 },
    { code: secondCostCode, name: "Urubonus Text ATK Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 800, defense: 700 },
    { code: opponentOneCode, name: "Urubonus Opponent One", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 2000, defense: 1500 },
    { code: opponentTwoCode, name: "Urubonus Opponent Two", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 2500, defense: 2000 },
  ];
}

function createRestoredSummonOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 47077697, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [urubonusCode, reptileCostCode] }, 1: { main: [opponentOneCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, urubonusCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, reptileCostCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, opponentOneCode), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(urubonusCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredDebuffOpen({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 47077698, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [urubonusCode, secondCostCode] }, 1: { main: [opponentOneCode, opponentTwoCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, secondCostCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, urubonusCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, opponentOneCode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, opponentTwoCode), 1, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(urubonusCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectUrubonusScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Urubonus, the Avatar of Malice");
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetRange(LOCATION_HAND)");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.spcfilter,1,false,nil,nil,tp)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.spcfilter,1,1,false,nil,nil,tp)");
  expect(script).toContain("Duel.Release(g,REASON_COST)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetTargetRange(0,LOCATION_MZONE)");
  expect(script).toContain("e2:SetValue(-300)");
  expect(script).toContain("e3:SetCode(EFFECT_UPDATE_DEFENSE)");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.adcfilter,1,false,nil,nil)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.adcfilter,1,1,false,nil,nil)");
  expect(script).toContain("e:SetLabel(g:GetFirst():GetTextAttack())");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("e1:SetValue(-atk)");
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
