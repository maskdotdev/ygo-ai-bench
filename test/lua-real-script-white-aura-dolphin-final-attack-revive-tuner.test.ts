import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cardTypeFlags, currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { markProcedureComplete } from "#duel/procedure-status.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const dolphinCode = "78229193";
const opponentCode = "782291930";
const waterCostCode = "782291931";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDolphinScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${dolphinCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTuner = 0x1000;
const typeSynchro = 0x2000;
const raceFish = 0x20000;
const raceWarrior = 0x1;
const attributeWater = 0x2;
const attributeDark = 0x20;
const effectSetAttackFinal = 102;
const effectAddType = 115;

describe.skipIf(!hasUpstreamScripts || !hasDolphinScript)("Lua real script White Aura Dolphin final attack revive tuner", () => {
  it("restores ignition final ATK halve and destroyed WATER-cost SpecialSummonStep Tuner revive", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${dolphinCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());

    const restoredAttack = createRestoredAttackWindow({ reader, workspace });
    expectCleanRestore(restoredAttack);
    expectRestoredLegalActions(restoredAttack, 0);
    const attackDolphin = requireCard(restoredAttack.session, dolphinCode);
    const opponent = requireCard(restoredAttack.session, opponentCode, 1);
    const statAction = getLuaRestoreLegalActions(restoredAttack, 0).find((action) =>
      action.type === "activateEffect" && action.uid === attackDolphin.uid && action.effectId === "lua-3"
    );
    expect(statAction, JSON.stringify(getLuaRestoreLegalActions(restoredAttack, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttack, statAction!);
    passRestoredChain(restoredAttack);

    expect(currentAttack(restoredAttack.session.state.cards.find((card) => card.uid === opponent.uid), restoredAttack.session.state)).toBe(1201);
    expect(restoredAttack.session.state.effects.filter((effect) => effect.sourceUid === opponent.uid && effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, event: "continuous", property: 0x400, reset: { flags: 1107169792 }, sourceUid: opponent.uid, value: 1201 },
    ]);
    expect(restoredAttack.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
      eventChainDepth: event.eventChainDepth,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: opponent.uid, eventReason: 0, eventReasonPlayer: 0, relatedEffectId: 3, eventChainDepth: 1 },
    ]);

    const restoredDestroyed = createRestoredDestroyedWindow({ reader, workspace });
    expectCleanRestore(restoredDestroyed);
    expectRestoredLegalActions(restoredDestroyed, 0);
    const destroyedDolphin = requireCard(restoredDestroyed.session, dolphinCode);
    const waterCost = requireCard(restoredDestroyed.session, waterCostCode);
    const revive = getLuaRestoreLegalActions(restoredDestroyed, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === destroyedDolphin.uid && action.effectId === "lua-4-1029"
    );
    expect(revive, JSON.stringify(getLuaRestoreLegalActions(restoredDestroyed, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroyed, revive!);
    passRestoredChain(restoredDestroyed);

    expect(restoredDestroyed.session.state.cards.find((card) => card.uid === waterCost.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: destroyedDolphin.uid,
      reasonEffectId: 4,
    });
    expect(restoredDestroyed.session.state.cards.find((card) => card.uid === destroyedDolphin.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: destroyedDolphin.uid,
      reasonEffectId: 4,
    });
    expect(cardTypeFlags(restoredDestroyed.session.state.cards.find((card) => card.uid === destroyedDolphin.uid), restoredDestroyed.session.state) & typeTuner).toBe(typeTuner);
    expect(restoredDestroyed.session.state.effects.filter((effect) => effect.sourceUid === destroyedDolphin.uid && effect.code === effectAddType).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectAddType, event: "continuous", property: 0x400, reset: { flags: 33427456 }, sourceUid: destroyedDolphin.uid, value: typeTuner },
    ]);
    expect(restoredDestroyed.session.state.eventHistory.filter((event) => ["destroyed", "banished", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "destroyed", eventCode: 1029, eventCardUid: destroyedDolphin.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "banished", eventCode: 1011, eventCardUid: waterCost.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: destroyedDolphin.uid, eventReasonEffectId: 4 },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: destroyedDolphin.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: destroyedDolphin.uid, eventReasonEffectId: 4 },
    ]);
    expect(restoredDestroyed.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredAttackWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 78229193, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [], extra: [dolphinCode] }, 1: { main: [opponentCode] } });
  startDuel(session);
  const dolphin = moveFaceUpAttack(session, requireCard(session, dolphinCode), 0, 0);
  dolphin.summonType = "synchro";
  markProcedureComplete(dolphin);
  moveFaceUpAttack(session, requireCard(session, opponentCode, 1), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(dolphinCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredDestroyedWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 78229194, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [waterCostCode], extra: [dolphinCode] }, 1: { main: [] } });
  startDuel(session);
  const dolphin = moveFaceUpAttack(session, requireCard(session, dolphinCode), 0, 0);
  dolphin.summonType = "synchro";
  markProcedureComplete(dolphin);
  moveDuelCard(session.state, requireCard(session, waterCostCode).uid, "graveyard", 0).faceUp = true;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(dolphinCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  destroyDuelCard(session.state, dolphin.uid, 0, duelReason.effect | duelReason.destroy, 1);
  session.state.waitingFor = 0;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("White Aura Dolphin");
  expect(script).toContain("Synchro.AddProcedure(c,nil,1,1,Synchro.NonTuner(nil),1,99)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(math.ceil(tc:GetBaseAttack()/2))");
  expect(script).toContain("e2:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("return rp==1-tp and c:IsPreviousLocation(LOCATION_ONFIELD) and c:IsPreviousControler(tp)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.spcostfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,1,c,mmz_chk,tp)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
  expect(script).toContain("Duel.SpecialSummonStep(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e1:SetCode(EFFECT_ADD_TYPE)");
  expect(script).toContain("e1:SetValue(TYPE_TUNER)");
  expect(script).toContain("Duel.SpecialSummonComplete()");
}

function cards(): DuelCardData[] {
  return [
    { code: dolphinCode, name: "White Aura Dolphin", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceFish, attribute: attributeWater, level: 6, attack: 2400, defense: 1000 },
    { code: opponentCode, name: "White Aura Dolphin Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 2401, defense: 1000 },
    { code: waterCostCode, name: "White Aura Dolphin WATER Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFish, attribute: attributeWater, level: 4, attack: 1200, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string, controller?: PlayerId): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && (controller === undefined || candidate.controller === controller));
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
