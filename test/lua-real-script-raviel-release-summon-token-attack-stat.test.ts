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
const ravielCode = "69890967";
const phantasmTokenCode = "69890968";
const fiendACode = "698909670";
const fiendBCode = "698909671";
const fiendCCode = "698909672";
const attackCostCode = "698909673";
const opponentNormalCode = "698909674";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasRavielScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${ravielCode}.lua`));
const typeMonster = 0x1;
const typeNormal = 0x10;
const typeEffect = 0x20;
const typeToken = 0x4000;
const typeSpecialSummon = 0x2000000;
const raceFiend = 0x8;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const effectUpdateAttack = 100;
const effectCannotAttackAnnounce = 86;

describe.skipIf(!hasUpstreamScripts || !hasRavielScript)("Lua real script Raviel release summon token attack stat", () => {
  it("restores three-Fiend procedure release, opponent summon Token, and release-cost ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectRavielScriptShape(workspace.readScript(`official/c${ravielCode}.lua`));
    const reader = createCardReader(cards());

    const restoredProcedure = createRestoredProcedure({ reader, workspace });
    expectCleanRestore(restoredProcedure);
    expectRestoredLegalActions(restoredProcedure, 0);
    const procedureRaviel = requireCard(restoredProcedure.session, ravielCode);
    const fiendA = requireCard(restoredProcedure.session, fiendACode);
    const fiendB = requireCard(restoredProcedure.session, fiendBCode);
    const fiendC = requireCard(restoredProcedure.session, fiendCCode);
    expect(restoredProcedure.session.state.effects.filter((effect) => effect.sourceUid === procedureRaviel.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      { category: undefined, code: 31, countLimit: undefined, event: "continuous", id: "lua-1-31", property: 0x40400, range: ["hand"], triggerEvent: undefined, value: undefined },
      { category: undefined, code: 30, countLimit: undefined, event: "continuous", id: "lua-2-30", property: 0x40400, range: ["hand"], triggerEvent: undefined, value: undefined },
      { category: undefined, code: 34, countLimit: undefined, event: "summonProcedure", id: "lua-3-34", property: 0x40000, range: ["hand"], triggerEvent: undefined, value: undefined },
      { category: 0x600, code: 1100, countLimit: undefined, event: "trigger", id: "lua-4-1100", property: undefined, range: ["monsterZone"], triggerEvent: "normalSummoned", value: undefined },
      { category: 0x200000, code: undefined, countLimit: 1, event: "ignition", id: "lua-5", property: undefined, range: ["monsterZone"], triggerEvent: undefined, value: undefined },
    ]);
    const procedure = getLuaRestoreLegalActions(restoredProcedure, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === procedureRaviel.uid);
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restoredProcedure, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredProcedure, procedure!);
    expect(restoredProcedure.session.state.cards.find((card) => card.uid === procedureRaviel.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
    });
    for (const material of [fiendA, fiendB, fiendC]) {
      expect(restoredProcedure.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
        location: "graveyard",
        controller: 0,
        reason: duelReason.cost | duelReason.release,
        reasonPlayer: 0,
        reasonCardUid: procedureRaviel.uid,
      });
    }
    expect(restoredProcedure.session.state.eventHistory.filter((event) => ["released", "sentToGraveyard", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventUids: event.eventUids,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "released", eventCode: 1017, eventCardUid: fiendA.uid, eventUids: undefined, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: procedureRaviel.uid, eventReasonEffectId: 3, previous: "monsterZone", current: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: fiendA.uid, eventUids: undefined, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: procedureRaviel.uid, eventReasonEffectId: 3, previous: "monsterZone", current: "graveyard" },
      { eventName: "released", eventCode: 1017, eventCardUid: fiendB.uid, eventUids: undefined, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: procedureRaviel.uid, eventReasonEffectId: 3, previous: "monsterZone", current: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: fiendB.uid, eventUids: undefined, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: procedureRaviel.uid, eventReasonEffectId: 3, previous: "monsterZone", current: "graveyard" },
      { eventName: "released", eventCode: 1017, eventCardUid: fiendC.uid, eventUids: undefined, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: procedureRaviel.uid, eventReasonEffectId: 3, previous: "monsterZone", current: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: fiendC.uid, eventUids: undefined, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: procedureRaviel.uid, eventReasonEffectId: 3, previous: "monsterZone", current: "graveyard" },
      { eventName: "released", eventCode: 1017, eventCardUid: fiendA.uid, eventUids: [fiendA.uid, fiendB.uid, fiendC.uid], eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: procedureRaviel.uid, eventReasonEffectId: 3, previous: "monsterZone", current: "graveyard" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: procedureRaviel.uid, eventUids: undefined, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "hand", current: "monsterZone" },
    ]);

    const restoredOpponentSummon = createRestoredOpponentSummon({ reader, workspace });
    expectCleanRestore(restoredOpponentSummon);
    expectRestoredLegalActions(restoredOpponentSummon, 1);
    const triggerRaviel = requireCard(restoredOpponentSummon.session, ravielCode);
    const opponentNormal = requireCard(restoredOpponentSummon.session, opponentNormalCode);
    const normalSummon = getLuaRestoreLegalActions(restoredOpponentSummon, 1).find((action) => action.type === "normalSummon" && action.uid === opponentNormal.uid);
    expect(normalSummon, JSON.stringify(getLuaRestoreLegalActions(restoredOpponentSummon, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpponentSummon, normalSummon!);
    expect(restoredOpponentSummon.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventPlayer: trigger.eventPlayer,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-4-1100", eventCardUid: opponentNormal.uid, eventCode: 1100, eventName: "normalSummoned", eventPlayer: 1, player: 0, sourceUid: triggerRaviel.uid, triggerBucket: "opponentMandatory" },
    ]);
    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpponentSummon.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const tokenSummon = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === triggerRaviel.uid && action.effectId === "lua-4-1100");
    expect(tokenSummon, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, tokenSummon!);
    resolveRestoredChain(restoredTrigger);
    const phantasmToken = restoredTrigger.session.state.cards.find((card) => card.code === phantasmTokenCode && card.location === "monsterZone" && card.controller === 0);
    expect(phantasmToken).toMatchObject({
      location: "monsterZone",
      controller: 0,
      owner: 0,
      faceUp: true,
      position: "faceUpAttack",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: triggerRaviel.uid,
      reasonEffectId: 4,
    });
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === phantasmToken!.uid && effect.code === effectCannotAttackAnnounce).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: effectCannotAttackAnnounce, property: undefined, reset: { flags: 33427456 }, sourceUid: phantasmToken!.uid },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["normalSummoned", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventUids: event.eventUids,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "normalSummoned", eventCode: 1100, eventCardUid: opponentNormal.uid, eventUids: undefined, eventPlayer: undefined, eventReason: duelReason.summon, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "hand", current: "monsterZone" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: phantasmToken!.uid, eventUids: [phantasmToken!.uid], eventPlayer: undefined, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: triggerRaviel.uid, eventReasonEffectId: 4, previous: "hand", current: "monsterZone" },
    ]);

    const restoredAttack = createRestoredAttackIgnition({ reader, workspace });
    expectCleanRestore(restoredAttack);
    expectRestoredLegalActions(restoredAttack, 0);
    const attackRaviel = requireCard(restoredAttack.session, ravielCode);
    const attackCost = requireCard(restoredAttack.session, attackCostCode);
    const attackBoost = getLuaRestoreLegalActions(restoredAttack, 0).find((action) => action.type === "activateEffect" && action.uid === attackRaviel.uid && action.effectId === "lua-5");
    expect(attackBoost, JSON.stringify(getLuaRestoreLegalActions(restoredAttack, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttack, attackBoost!);
    resolveRestoredChain(restoredAttack);
    expect(restoredAttack.session.state.cards.find((card) => card.uid === attackCost.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: attackRaviel.uid,
      reasonEffectId: 5,
    });
    expect(currentAttack(restoredAttack.session.state.cards.find((card) => card.uid === attackRaviel.uid), restoredAttack.session.state)).toBe(5500);
    expect(restoredAttack.session.state.effects.filter((effect) => effect.sourceUid === attackRaviel.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: undefined, reset: { flags: 1107235328 }, sourceUid: attackRaviel.uid, value: 1500 },
    ]);
    expect(restoredAttack.session.state.eventHistory.filter((event) => ["released", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventUids: event.eventUids,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "released", eventCode: 1017, eventCardUid: attackCost.uid, eventUids: undefined, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: attackRaviel.uid, eventReasonEffectId: 5, previous: "monsterZone", current: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: attackCost.uid, eventUids: undefined, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: attackRaviel.uid, eventReasonEffectId: 5, previous: "monsterZone", current: "graveyard" },
    ]);
    expect(restoredAttack.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredProcedure({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createBaseSession({ seed: 69890967, reader, workspace, main0: [ravielCode, fiendACode, fiendBCode, fiendCCode], main1: [] });
  moveDuelCard(session.state, requireCard(session, ravielCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, fiendACode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, fiendBCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, fiendCCode), 0, 2);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredOpponentSummon({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createBaseSession({ seed: 69890968, reader, workspace, main0: [ravielCode], main1: [opponentNormalCode] });
  moveFaceUpAttack(session, requireCard(session, ravielCode), 0, 0);
  moveDuelCard(session.state, requireCard(session, opponentNormalCode).uid, "hand", 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredAttackIgnition({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createBaseSession({ seed: 69890969, reader, workspace, main0: [ravielCode, attackCostCode], main1: [] });
  moveFaceUpAttack(session, requireCard(session, ravielCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, attackCostCode), 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createBaseSession({
  seed,
  reader,
  workspace,
  main0,
  main1,
}: {
  seed: number;
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  main0: string[];
  main1: string[];
}): DuelSession {
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: main0 }, 1: { main: main1 } });
  startDuel(session);
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(ravielCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
}

function expectRavielScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("c:EnableReviveLimit()");
  expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_CONDITION)");
  expect(script).toContain("e1:SetValue(aux.FALSE)");
  expect(script).toContain("e2:SetCode(EFFECT_SPSUMMON_PROC)");
  expect(script).toContain("Duel.GetReleaseGroup(tp):Filter(s.rfilter,nil,tp)");
  expect(script).toContain("aux.SelectUnselectGroup(rg,e,tp,3,3,aux.ChkfMMZ(1),0)");
  expect(script).toContain("aux.SelectUnselectGroup(rg,e,tp,3,3,aux.ChkfMMZ(1),1,tp,HINTMSG_RELEASE,nil,nil,true)");
  expect(script).toContain("Duel.Release(g,REASON_COST)");
  expect(script).toContain("e3:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_TOKEN)");
  expect(script).toContain("e3:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("return ep~=tp");
  expect(script).toContain("Duel.CreateToken(tp,id+1)");
  expect(script).toContain("Duel.SpecialSummon(token,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ATTACK_ANNOUNCE)");
  expect(script).toContain("e4:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.atkfilter,1,false,nil,c)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.atkfilter,1,1,false,nil,c)");
  expect(script).toContain("local atk=g:GetFirst():GetTextAttack()");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END)");
}

function cards(): DuelCardData[] {
  return [
    { code: ravielCode, name: "Raviel, Lord of Phantasms", kind: "monster", typeFlags: typeMonster | typeEffect | typeSpecialSummon, race: raceFiend, attribute: attributeDark, level: 10, attack: 4000, defense: 4000 },
    { code: phantasmTokenCode, name: "Phantasm Token", kind: "monster", typeFlags: typeMonster | typeNormal | typeToken, race: raceFiend, attribute: attributeDark, level: 1, attack: 1000, defense: 1000 },
    { code: fiendACode, name: "Raviel Fiend A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: fiendBCode, name: "Raviel Fiend B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1100, defense: 1000 },
    { code: fiendCCode, name: "Raviel Fiend C", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1200, defense: 1000 },
    { code: attackCostCode, name: "Raviel ATK Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1500, defense: 1000 },
    { code: opponentNormalCode, name: "Raviel Opponent Normal Summon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1400, defense: 1000 },
  ];
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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
