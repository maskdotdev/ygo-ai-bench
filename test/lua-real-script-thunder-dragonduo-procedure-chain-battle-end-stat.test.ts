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
const dragonduoCode = "55591586";
const lightCostCode = "555915860";
const darkCostCode = "555915861";
const handStarterCode = "555915862";
const battleTargetCode = "555915863";
const searchThunderCode = "555915864";
const banishedReturnCode = "555915865";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDragonduoScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${dragonduoCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceThunder = 0x1000;
const attributeLight = 0x10;
const attributeDark = 0x20;
const effectUpdateAttack = 100;
const phaseEndCode = 0x1200;

describe.skipIf(!hasUpstreamScripts || !hasDragonduoScript)("Lua real script Thunder Dragonduo procedure chain battle end stat", () => {
  it("restores LIGHT/DARK procedure banish, hand-chain ATK gain, battle search, and opponent End Phase return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${dragonduoCode}.lua`));
    const reader = createCardReader(cards());

    const restoredProcedure = createRestoredProcedureField({ reader, workspace });
    expectCleanRestore(restoredProcedure);
    expectRestoredLegalActions(restoredProcedure, 0);
    const procedureDragonduo = requireCard(restoredProcedure.session, dragonduoCode);
    const lightCost = requireCard(restoredProcedure.session, lightCostCode);
    const darkCost = requireCard(restoredProcedure.session, darkCostCode);
    const procedure = getLuaRestoreLegalActions(restoredProcedure, 0).find(
      (action): action is Extract<DuelAction, { type: "specialSummonProcedure" }> => action.type === "specialSummonProcedure" && action.uid === procedureDragonduo.uid,
    );
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restoredProcedure, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredProcedure, procedure!);
    expect(restoredProcedure.session.state.cards.find((card) => card.uid === procedureDragonduo.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
    });
    expect(restoredProcedure.session.state.cards.find((card) => card.uid === lightCost.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: procedureDragonduo.uid,
      reasonEffectId: 2,
    });
    expect(restoredProcedure.session.state.cards.find((card) => card.uid === darkCost.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: procedureDragonduo.uid,
      reasonEffectId: 2,
    });
    expect(restoredProcedure.session.state.eventHistory.filter((event) => ["banished", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      eventUids: event.eventUids,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: lightCost.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: procedureDragonduo.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, eventUids: undefined, previous: "graveyard", current: "banished" },
      { eventCardUid: darkCost.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: procedureDragonduo.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, eventUids: undefined, previous: "graveyard", current: "banished" },
      { eventCardUid: lightCost.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: procedureDragonduo.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, eventUids: [lightCost.uid, darkCost.uid], previous: "graveyard", current: "banished" },
      { eventCardUid: procedureDragonduo.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, eventUids: undefined, previous: "hand", current: "monsterZone" },
    ]);

    const restoredChain = createRestoredHandChainField({ reader, workspace });
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    const chainDragonduo = requireCard(restoredChain.session, dragonduoCode);
    const handStarter = requireCard(restoredChain.session, handStarterCode);
    const starter = getLuaRestoreLegalActions(restoredChain, 1).find((action) => action.type === "activateEffect" && action.uid === handStarter.uid);
    expect(starter, JSON.stringify(getLuaRestoreLegalActions(restoredChain, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredChain, starter!);
    const statTrigger = getLuaRestoreLegalActions(restoredChain, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === chainDragonduo.uid
    );
    expect(statTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredChain, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredChain, statTrigger!);
    resolveRestoredChain(restoredChain);
    expect(currentAttack(restoredChain.session.state.cards.find((card) => card.uid === chainDragonduo.uid), restoredChain.session.state)).toBe(3100);
    expect(restoredChain.session.state.effects.filter((effect) => effect.sourceUid === chainDragonduo.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([{ code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: chainDragonduo.uid, value: 300 }]);
    expect(restoredChain.host.messages).toContain("dragonduo hand starter resolved");

    const restoredBattle = createRestoredBattleSearchField({ reader, workspace });
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const battleDragonduo = requireCard(restoredBattle.session, dragonduoCode);
    const battleTarget = requireCard(restoredBattle.session, battleTargetCode);
    const battleCost = requireCard(restoredBattle.session, lightCostCode);
    const searchThunder = requireCard(restoredBattle.session, searchThunderCode);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === battleDragonduo.uid && action.targetUid === battleTarget.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    finishBattleUntilTrigger(restoredBattle);
    const battleTrigger = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === battleDragonduo.uid
    );
    expect(battleTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, battleTrigger!);
    resolveRestoredChain(restoredBattle);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === battleCost.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: battleDragonduo.uid,
      reasonEffectId: 4,
    });
    expect(restoredBattle.session.state.cards.find((card) => card.uid === searchThunder.uid)).toMatchObject({
      location: "hand",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: battleDragonduo.uid,
      reasonEffectId: 4,
    });
    expect(restoredBattle.host.messages).toContain(`confirmed 1: ${searchThunderCode}`);
    expect(restoredBattle.session.state.eventHistory.filter((event) =>
      ["battleDestroyed", "banished", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)
    ).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: battleTarget.uid, eventCode: 1140, eventName: "battleDestroyed", eventReason: duelReason.battle | duelReason.destroy, eventReasonCardUid: battleDragonduo.uid, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "monsterZone", current: "graveyard" },
      { eventCardUid: battleCost.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost, eventReasonCardUid: battleDragonduo.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, previous: "graveyard", current: "banished" },
      { eventCardUid: searchThunder.uid, eventCode: 1012, eventName: "sentToHand", eventReason: duelReason.effect, eventReasonCardUid: battleDragonduo.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, previous: "deck", current: "hand" },
      { eventCardUid: searchThunder.uid, eventCode: 1211, eventName: "confirmed", eventReason: duelReason.effect, eventReasonCardUid: battleDragonduo.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, previous: "deck", current: "hand" },
      { eventCardUid: searchThunder.uid, eventCode: 1212, eventName: "sentToHandConfirmed", eventReason: duelReason.effect, eventReasonCardUid: battleDragonduo.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, previous: "deck", current: "hand" },
    ]);

    const restoredEnd = createRestoredEndPhaseReturnField({ reader, workspace });
    expectCleanRestore(restoredEnd);
    expectRestoredLegalActions(restoredEnd, 1);
    const endDragonduo = requireCard(restoredEnd.session, dragonduoCode);
    const banishedReturn = requireCard(restoredEnd.session, banishedReturnCode);
    const endPhase = getLuaRestoreLegalActions(restoredEnd, 1).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(endPhase, JSON.stringify(getLuaRestoreLegalActions(restoredEnd, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEnd, endPhase!);
    expect(restoredEnd.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-5-4608", eventCode: phaseEndCode, eventName: "phaseEnd", player: 0, sourceUid: endDragonduo.uid, triggerBucket: "opponentOptional" },
    ]);
    const restoredEndTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredEnd.session), workspace, reader, {
      promptOverrides: [{ api: "SelectOption", player: 0, returned: 0 }],
    });
    expectCleanRestore(restoredEndTrigger);
    expectRestoredLegalActions(restoredEndTrigger, 0);
    const returnTrigger = getLuaRestoreLegalActions(restoredEndTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === endDragonduo.uid && action.effectId === "lua-5-4608"
    );
    expect(returnTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredEndTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEndTrigger, returnTrigger!);
    resolveRestoredChain(restoredEndTrigger);
    expect(restoredEndTrigger.host.promptDecisions.filter((prompt) => prompt.api === "SelectOption").map((prompt) => ({
      api: prompt.api,
      player: prompt.player,
      returned: prompt.returned,
    }))).toEqual([{ api: "SelectOption", player: 0, returned: 0 }]);
    expect(restoredEndTrigger.session.state.cards.find((card) => card.uid === banishedReturn.uid)).toMatchObject({
      location: "deck",
      controller: 0,
      sequence: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: endDragonduo.uid,
      reasonEffectId: 5,
    });
    expect(restoredEndTrigger.session.state.eventHistory.filter((event) => ["phaseEnd", "becameTarget", "sentToDeck"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: undefined, eventCode: phaseEndCode, eventName: "phaseEnd", eventReason: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: undefined, previous: undefined, current: undefined, relatedEffectId: undefined },
      { eventCardUid: banishedReturn.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "deck", current: "banished", relatedEffectId: 5 },
      { eventCardUid: banishedReturn.uid, eventCode: 1013, eventName: "sentToDeck", eventReason: duelReason.effect, eventReasonCardUid: endDragonduo.uid, eventReasonEffectId: 5, eventReasonPlayer: 0, previous: "banished", current: "deck", relatedEffectId: undefined },
    ]);
    expect(restoredEndTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredProcedureField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createBaseSession({ seed: 55591586, reader, workspace, main: [dragonduoCode, lightCostCode, darkCostCode] });
  moveDuelCard(session.state, requireCard(session, dragonduoCode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, lightCostCode).uid, "graveyard", 0);
  moveDuelCard(session.state, requireCard(session, darkCostCode).uid, "graveyard", 0);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredHandChainField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const source = sourceWithHandStarter(workspace);
  const session = createBaseSession({ seed: 55591587, reader, workspace, main: [dragonduoCode] }, source);
  moveFaceUpAttack(session, requireCard(session, dragonduoCode), 0);
  moveDuelCard(session.state, requireCard(session, handStarterCode).uid, "hand", 1);
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(handStarterCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function createRestoredBattleSearchField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createBaseSession({ seed: 55591588, reader, workspace, main: [dragonduoCode, battleTargetCode, lightCostCode, searchThunderCode] });
  moveFaceUpAttack(session, requireCard(session, dragonduoCode), 0);
  moveFaceUpAttack(session, requireCard(session, battleTargetCode), 1);
  moveDuelCard(session.state, requireCard(session, lightCostCode).uid, "graveyard", 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredEndPhaseReturnField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createBaseSession({ seed: 55591589, reader, workspace, main: [dragonduoCode, banishedReturnCode] });
  moveFaceUpAttack(session, requireCard(session, dragonduoCode), 0);
  moveDuelCard(session.state, requireCard(session, banishedReturnCode).uid, "banished", 0).faceUp = true;
  session.state.phase = "main2";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createBaseSession(
  {
    seed,
    reader,
    workspace,
    main,
  }: {
    seed: number;
    reader: ReturnType<typeof createCardReader>;
    workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
    main: string[];
  },
  source: { readScript(name: string): string | undefined } = workspace,
): DuelSession {
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main }, 1: { main: [handStarterCode] } });
  startDuel(session);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(dragonduoCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Thunder Dragonduo");
  expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
  expect(script).toContain("aux.ChkfMMZ(1)(sg,e,tp,mg)");
  expect(script).toContain("aux.SelectUnselectGroup(rg,e,tp,2,2,s.rescon,1,tp,HINTMSG_REMOVE,nil,nil,true)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
  expect(script).toContain("e2:SetCode(EVENT_CHAINING)");
  expect(script).toContain("Duel.GetChainInfo(ev,CHAININFO_TRIGGERING_LOCATION)==LOCATION_HAND");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(300)");
  expect(script).toContain("e3:SetCode(EVENT_BATTLE_DESTROYING)");
  expect(script).toContain("e3:SetCondition(aux.bdocon)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.thcfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
  expect(script).toContain("e4:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("return Duel.IsTurnPlayer(1-tp)");
  expect(script).toContain("Duel.SelectOption(tp,aux.Stringid(id,5),aux.Stringid(id,6))==0");
  expect(script).toContain("Duel.SendtoDeck(sg,nil,SEQ_DECKTOP,REASON_EFFECT)");
  expect(script).toContain("Duel.SendtoDeck(sg,nil,SEQ_DECKBOTTOM,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: dragonduoCode, name: "Thunder Dragonduo", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceThunder, attribute: attributeDark, level: 8, attack: 2800, defense: 0 },
    { code: lightCostCode, name: "Dragonduo LIGHT Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceThunder, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    { code: darkCostCode, name: "Dragonduo DARK Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceThunder, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: handStarterCode, name: "Dragonduo Hand Monster Starter", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceThunder, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    { code: battleTargetCode, name: "Dragonduo Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceThunder, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: searchThunderCode, name: "Dragonduo Search Thunder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceThunder, attribute: attributeLight, level: 4, attack: 1600, defense: 1000 },
    { code: banishedReturnCode, name: "Dragonduo Banished Return", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceThunder, attribute: attributeLight, level: 4, attack: 1200, defense: 1000 },
  ];
}

function sourceWithHandStarter(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): { readScript(name: string): string | undefined } {
  return {
    readScript(name: string) {
      if (name === `c${handStarterCode}.lua`) return handStarterScript();
      return workspace.readScript(name);
    },
  };
}

function handStarterScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("dragonduo hand starter resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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

function finishBattleUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(30);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
