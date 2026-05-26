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
const assembwurmCode = "7445307";
const handCostCode = "744530700";
const fieldCostCode = "744530701";
const blockerACode = "744530702";
const blockerBCode = "744530703";
const blockerCCode = "744530704";
const removeCostCode = "744530705";
const removeTargetCode = "744530706";
const removeDecoyCode = "744530707";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAssembwurmScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${assembwurmCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceCyberse = 0x1000000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeLight = 0x10;
const effectSetAttackFinal = 102;

describe.skipIf(!hasUpstreamScripts || !hasAssembwurmScript)("Lua real script Dual Assembwurm select-unselect summon banish stat", () => {
  it("restores SelectUnselectGroup Cyberse banish cost into halved Special Summon and field remove", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${assembwurmCode}.lua`));
    const reader = createCardReader(cards());

    const restoredSummon = createRestoredAssembwurmSummonField({ reader, workspace });
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const summonAssembwurm = requireCard(restoredSummon.session, assembwurmCode);
    const handCost = requireCard(restoredSummon.session, handCostCode);
    const fieldCost = requireCard(restoredSummon.session, fieldCostCode);
    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find(
      (action) => action.type === "activateEffect" && action.uid === summonAssembwurm.uid && action.effectId === "lua-1",
    );
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summon!);
    resolveRestoredChain(restoredSummon);

    for (const costCard of [handCost, fieldCost]) {
      expect(restoredSummon.session.state.cards.find((card) => card.uid === costCard.uid)).toMatchObject({
        location: "banished",
        controller: 0,
        faceUp: true,
        reason: duelReason.cost,
        reasonPlayer: 0,
        reasonCardUid: summonAssembwurm.uid,
        reasonEffectId: 1,
      });
    }
    expect(restoredSummon.session.state.cards.find((card) => card.uid === summonAssembwurm.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      sequence: 0,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: summonAssembwurm.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredSummon.session.state.cards.find((card) => card.uid === summonAssembwurm.uid), restoredSummon.session.state)).toBe(1400);
    expect(restoredSummon.session.state.effects.filter((effect) => effect.sourceUid === summonAssembwurm.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, reset: { flags: 33492992 }, sourceUid: summonAssembwurm.uid, value: 1400 },
    ]);
    expect(restoredSummon.session.state.eventHistory.filter((event) => ["banished", "specialSummoned"].includes(event.eventName)).map((event) => ({
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
      { eventName: "banished", eventCode: 1011, eventCardUid: handCost.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: summonAssembwurm.uid, eventReasonEffectId: 1, previous: "hand", current: "banished" },
      { eventName: "banished", eventCode: 1011, eventCardUid: fieldCost.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: summonAssembwurm.uid, eventReasonEffectId: 1, previous: "monsterZone", current: "banished" },
      { eventName: "banished", eventCode: 1011, eventCardUid: handCost.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: summonAssembwurm.uid, eventReasonEffectId: 1, previous: "hand", current: "banished" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: summonAssembwurm.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: summonAssembwurm.uid, eventReasonEffectId: 1, previous: "graveyard", current: "monsterZone" },
    ]);

    const restoredRemove = createRestoredAssembwurmRemoveField({ reader, workspace });
    expectCleanRestore(restoredRemove);
    expectRestoredLegalActions(restoredRemove, 0);
    const removeAssembwurm = requireCard(restoredRemove.session, assembwurmCode);
    const removeCost = requireCard(restoredRemove.session, removeCostCode);
    const removeTarget = requireCard(restoredRemove.session, removeTargetCode);
    const removeDecoy = requireCard(restoredRemove.session, removeDecoyCode);
    const remove = getLuaRestoreLegalActions(restoredRemove, 0).find(
      (action) => action.type === "activateEffect" && action.uid === removeAssembwurm.uid && action.effectId === "lua-2",
    );
    expect(remove, JSON.stringify(getLuaRestoreLegalActions(restoredRemove, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRemove, remove!);
    resolveRestoredChain(restoredRemove);

    expect(restoredRemove.session.state.cards.find((card) => card.uid === removeCost.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: removeAssembwurm.uid,
      reasonEffectId: 2,
    });
    expect(restoredRemove.session.state.cards.find((card) => card.uid === removeAssembwurm.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: removeAssembwurm.uid,
      reasonEffectId: 2,
    });
    expect(restoredRemove.session.state.cards.find((card) => card.uid === removeTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      faceUp: true,
    });
    expect(restoredRemove.session.state.cards.find((card) => card.uid === removeDecoy.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      faceUp: true,
    });
    expect(restoredRemove.session.state.eventHistory.filter((event) => event.eventName === "banished").map((event) => ({
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
      { eventName: "banished", eventCode: 1011, eventCardUid: removeCost.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: removeAssembwurm.uid, eventReasonEffectId: 2, previous: "hand", current: "banished" },
      { eventName: "banished", eventCode: 1011, eventCardUid: removeAssembwurm.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: removeAssembwurm.uid, eventReasonEffectId: 2, previous: "monsterZone", current: "banished" },
    ]);
    expect(restoredRemove.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredAssembwurmSummonField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 7445307, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [assembwurmCode, handCostCode, fieldCostCode, blockerACode, blockerBCode, blockerCCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, assembwurmCode).uid, "graveyard", 0);
  moveDuelCard(session.state, requireCard(session, handCostCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, fieldCostCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, blockerACode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, blockerBCode), 0, 2);
  moveFaceUpAttack(session, requireCard(session, blockerCCode), 0, 3);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(assembwurmCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredAssembwurmRemoveField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 744530701, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [assembwurmCode, removeCostCode] }, 1: { main: [removeTargetCode, removeDecoyCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, assembwurmCode), 0, 0);
  moveDuelCard(session.state, requireCard(session, removeCostCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, removeTargetCode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, removeDecoyCode), 1, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(assembwurmCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Dual Assembwurm");
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetRange(LOCATION_HAND|LOCATION_GRAVE)");
  expect(script).toContain("return c:IsRace(RACE_CYBERSE) and (c:IsLocation(LOCATION_HAND) or c:IsFaceup()) and c:IsAbleToRemoveAsCost()");
  expect(script).toContain("Duel.GetMatchingGroup(s.spcostfilter,tp,LOCATION_HAND|LOCATION_MZONE,0,e:GetHandler())");
  expect(script).toContain("aux.SelectUnselectGroup(rg,e,tp,2,2,aux.ChkfMMZ(1),0)");
  expect(script).toContain("aux.SelectUnselectGroup(rg,e,tp,2,2,aux.ChkfMMZ(1),1,tp,HINTMSG_REMOVE)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
  expect(script).toContain("Duel.SpecialSummonStep(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(math.ceil(c:GetAttack()/2))");
  expect(script).toContain("Duel.SpecialSummonComplete()");
  expect(script).toContain("e2:SetCategory(CATEGORY_REMOVE)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,Card.IsAbleToRemoveAsCost,tp,LOCATION_HAND,0,1,1,nil)");
  expect(script).toContain("return c:IsAttackBelow(atk) and c:IsFaceup() and c:IsAbleToRemove()");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_REMOVE,nil,1,PLAYER_EITHER,LOCATION_MZONE)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.rmfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil,c:GetAttack())");
  expect(script).toContain("Duel.HintSelection(g)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: assembwurmCode, name: "Dual Assembwurm", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeDark, level: 8, attack: 2800, defense: 1000 },
    { code: handCostCode, name: "Dual Assembwurm Hand Cyberse Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    { code: fieldCostCode, name: "Dual Assembwurm Field Cyberse Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeLight, level: 4, attack: 1200, defense: 1000 },
    { code: blockerACode, name: "Dual Assembwurm Field Blocker A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1500, defense: 1000 },
    { code: blockerBCode, name: "Dual Assembwurm Field Blocker B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1600, defense: 1000 },
    { code: blockerCCode, name: "Dual Assembwurm Field Blocker C", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1700, defense: 1000 },
    { code: removeCostCode, name: "Dual Assembwurm Remove Hand Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeLight, level: 4, attack: 900, defense: 900 },
    { code: removeTargetCode, name: "Dual Assembwurm Remove Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeLight, level: 4, attack: 2100, defense: 1000 },
    { code: removeDecoyCode, name: "Dual Assembwurm Large Remove Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 3200, defense: 1000 },
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
