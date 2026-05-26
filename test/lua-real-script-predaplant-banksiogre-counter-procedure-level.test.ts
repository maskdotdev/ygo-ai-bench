import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentLevel } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter, getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const banksiogreCode = "22138839";
const releaseTargetCode = "221388390";
const opponentLevelFourCode = "221388391";
const opponentLevelOneCode = "221388392";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasBanksiogreScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${banksiogreCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const racePlant = 0x400;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x10;
const counterPredator = 0x1041;
const categoryCounter = 0x800000;
const effectSpecialSummonProc = 34;
const effectChangeLevel = 131;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasBanksiogreScript)("Lua real script Predaplant Banksiogre counter procedure level", () => {
  it("restores opponent Predator Counter release procedure and to-grave counter level changes", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${banksiogreCode}.lua`));
    const reader = createCardReader(cards(workspace));

    const restoredProcedure = createRestoredProcedureOpen(reader, workspace);
    expectCleanRestore(restoredProcedure);
    expectRestoredLegalActions(restoredProcedure, 0);
    const procedureBanksiogre = requireCard(restoredProcedure.session, banksiogreCode);
    const releaseTarget = requireCard(restoredProcedure.session, releaseTargetCode);
    expect(restoredProcedure.session.state.effects.filter((effect) => effect.sourceUid === procedureBanksiogre.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: undefined, code: effectSpecialSummonProc, event: "summonProcedure", id: "lua-1-34", property: 262144, range: ["hand"] },
      { category: categoryCounter, code: 1014, event: "trigger", id: "lua-2-1014", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"] },
    ]);

    const procedure = getLuaRestoreLegalActions(restoredProcedure, 0).find((action) =>
      action.type === "specialSummonProcedure" && action.uid === procedureBanksiogre.uid && action.effectId === "lua-1-34"
    );
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restoredProcedure, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredProcedure, procedure!);
    expect(restoredProcedure.session.state.cards.find((card) => card.uid === releaseTarget.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.release | duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: procedureBanksiogre.uid,
      reasonEffectId: 1,
    });
    expect(restoredProcedure.session.state.cards.find((card) => card.uid === procedureBanksiogre.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
    });
    expect(restoredProcedure.session.state.eventHistory.filter((event) => ["released", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "released", eventCode: 1017, eventCardUid: releaseTarget.uid, eventReason: duelReason.release | duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: procedureBanksiogre.uid, eventReasonEffectId: 1 },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: procedureBanksiogre.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
    ]);

    const restoredTrigger = createRestoredToGraveTrigger(reader, workspace);
    expectCleanRestore(restoredTrigger);
    const graveBanksiogre = requireCard(restoredTrigger.session, banksiogreCode);
    const levelFour = requireCard(restoredTrigger.session, opponentLevelFourCode);
    const levelOne = requireCard(restoredTrigger.session, opponentLevelOneCode);
    expect(getLuaRestoreLegalActions(restoredTrigger, 0).some((action) =>
      action.type === "activateTrigger" && action.uid === graveBanksiogre.uid && action.effectId === "lua-2-1014"
    )).toBe(true);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === graveBanksiogre.uid && action.effectId === "lua-2-1014"
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(getDuelCardCounter(restoredTrigger.session.state.cards.find((card) => card.uid === levelFour.uid), counterPredator)).toBe(1);
    expect(getDuelCardCounter(restoredTrigger.session.state.cards.find((card) => card.uid === levelOne.uid), counterPredator)).toBe(1);
    expect(currentLevel(restoredTrigger.session.state.cards.find((card) => card.uid === levelFour.uid), restoredTrigger.session.state)).toBe(1);
    expect(currentLevel(restoredTrigger.session.state.cards.find((card) => card.uid === levelOne.uid), restoredTrigger.session.state)).toBe(1);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === levelFour.uid && effect.code === effectChangeLevel).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: effectChangeLevel, event: "continuous", reset: { flags: 33427456 }, value: 1 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["sentToGraveyard", "counterAdded"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: graveBanksiogre.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: levelFour.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: graveBanksiogre.uid, eventReasonEffectId: 2 },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: levelOne.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: graveBanksiogre.uid, eventReasonEffectId: 2 },
    ]);

    const restoredLevel = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredLevel);
    expectRestoredLegalActions(restoredLevel, 0);
    expect(currentLevel(restoredLevel.session.state.cards.find((card) => card.uid === levelFour.uid), restoredLevel.session.state)).toBe(1);
  });
});

function createRestoredProcedureOpen(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 22138839, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [banksiogreCode] }, 1: { main: [releaseTargetCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, banksiogreCode).uid, "hand", 0);
  const releaseTarget = moveFaceUpAttack(session, requireCard(session, releaseTargetCode), 1, 0);
  expect(addDuelCardCounter(releaseTarget, counterPredator, 1)).toBe(true);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerBanksiogre(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredToGraveTrigger(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 22138840, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [banksiogreCode] }, 1: { main: [opponentLevelFourCode, opponentLevelOneCode] } });
  startDuel(session);
  const banksiogre = moveFaceUpAttack(session, requireCard(session, banksiogreCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, opponentLevelFourCode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, opponentLevelOneCode), 1, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerBanksiogre(session, workspace);
  sendDuelCardToGraveyard(session.state, banksiogre.uid, 0, duelReason.effect, 0);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function registerBanksiogre(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(banksiogreCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const banksiogre = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === banksiogreCode);
  expect(banksiogre).toBeDefined();
  return [
    banksiogre!,
    { code: releaseTargetCode, name: "Banksiogre Release Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1200 },
    { code: opponentLevelFourCode, name: "Banksiogre Level Four Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1700, defense: 1000 },
    { code: opponentLevelOneCode, name: "Banksiogre Level One Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, attribute: attributeDark, level: 1, attack: 500, defense: 500 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Predaplant Banksiogre");
  expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
  expect(script).toContain("Duel.CheckReleaseGroup(tp,s.rfilter,1,false,1,true,c,tp,nil,true,nil,tp)");
  expect(script).toContain("Duel.SelectReleaseGroup(tp,s.rfilter,1,1,false,true,true,c,nil,nil,true,nil,tp)");
  expect(script).toContain("Duel.Release(g,REASON_COST)");
  expect(script).toContain("e2:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("return e:GetHandler():IsPreviousLocation(LOCATION_ONFIELD)");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("tc:AddCounter(COUNTER_PREDATOR,1)");
  expect(script).toContain("if tc:GetLevel()>1 then");
  expect(script).toContain("e1:SetCode(EFFECT_CHANGE_LEVEL)");
  expect(script).toContain("return e:GetHandler():GetCounter(COUNTER_PREDATOR)>0");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
