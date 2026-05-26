import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const vicCode = "78910832";
const handMachineCode = "789108320";
const deckMachineCode = "789108321";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasVicScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${vicCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceMachine = 0x20;
const attributeLight = 0x10;
const effectUpdateAttack = 100;
type SelectEffectOverride = { api: "SelectEffect"; player: 0; returned: number };
const selectHandSummon: SelectEffectOverride[] = [{ api: "SelectEffect", player: 0, returned: 1 }];
const selectDeckSend: SelectEffectOverride[] = [{ api: "SelectEffect", player: 0, returned: 2 }];

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasVicScript)("Lua real script Vic Viper Type-L battle SelectEffect destroyed revive stat", () => {
  it("restores Battle Start SelectEffect branches and destroyed LIGHT Machine revive ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${vicCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_PHASE+PHASE_BATTLE_START)");
    expect(script).toContain("return Duel.IsTurnPlayer(tp)");
    expect(script).toContain("Duel.SelectEffect(tp,");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,nil,1,tp,LOCATION_DECK)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.handspfilter,tp,LOCATION_HAND,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.tgfilter,tp,LOCATION_DECK,0,1,1,nil)");
    expect(script).toContain("Duel.SendtoGrave(g,REASON_EFFECT)");
    expect(script).toContain("e2:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_ATKCHANGE)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DELAY+EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e2:SetCode(EVENT_DESTROYED)");
    expect(script).toContain("Duel.SelectTarget(tp,s.gyspfilter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,tc,1,tp,0)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,tc,1,tp,1200)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(1200)");

    const reader = createCardReader(cards(workspace));
    const source = workspace;

    const restoredDeckSend = restoreVicWindow({ reader, source, workspace, promptOverrides: selectDeckSend });
    const vicDeckSend = requireCard(restoredDeckSend.session, vicCode);
    const deckMachine = requireCard(restoredDeckSend.session, deckMachineCode);
    changeToBattleAndAssert(restoredDeckSend, vicDeckSend);
    const restoredDeckSendTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDeckSend.session), source, reader, { promptOverrides: selectDeckSend });
    expectCleanRestore(restoredDeckSendTrigger);
    expectRestoredLegalActions(restoredDeckSendTrigger, 0);
    activateBattleTrigger(restoredDeckSendTrigger, vicDeckSend, "lua-1-4104");
    expect(restoredDeckSendTrigger.host.promptDecisions.filter((prompt) => prompt.api === "SelectEffect")).toEqual([
      { id: "lua-prompt-1", api: "SelectEffect", player: 0, options: [1, 2], descriptions: [1262573314, 1262573315], returned: 2 },
    ]);
    expect(restoredDeckSendTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restoredDeckSendTrigger);
    expect(restoredDeckSendTrigger.session.state.cards.find((card) => card.uid === deckMachine.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: vicDeckSend.uid,
      reasonEffectId: 1,
    });
    expect(restoredDeckSendTrigger.session.state.eventHistory.filter((event) => ["phaseBattle", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
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
      { eventName: "phaseBattle", eventCode: 4104, eventCardUid: undefined, eventReason: undefined, eventReasonPlayer: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: undefined, current: undefined },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: deckMachine.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: vicDeckSend.uid, eventReasonEffectId: 1, previous: "deck", current: "graveyard" },
    ]);

    const restoredHandSummon = restoreVicWindow({ reader, source, workspace, promptOverrides: selectHandSummon });
    const vicHandSummon = requireCard(restoredHandSummon.session, vicCode);
    const handMachine = requireCard(restoredHandSummon.session, handMachineCode);
    changeToBattleAndAssert(restoredHandSummon, vicHandSummon);
    const restoredHandSummonTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredHandSummon.session), source, reader, { promptOverrides: selectHandSummon });
    expectCleanRestore(restoredHandSummonTrigger);
    expectRestoredLegalActions(restoredHandSummonTrigger, 0);
    activateBattleTrigger(restoredHandSummonTrigger, vicHandSummon, "lua-1-4104");
    expect(restoredHandSummonTrigger.host.promptDecisions.filter((prompt) => prompt.api === "SelectEffect")).toEqual([
      { id: "lua-prompt-1", api: "SelectEffect", player: 0, options: [1, 2], descriptions: [1262573314, 1262573315], returned: 1 },
    ]);
    expect(restoredHandSummonTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restoredHandSummonTrigger);
    expect(restoredHandSummonTrigger.session.state.cards.find((card) => card.uid === handMachine.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: vicHandSummon.uid,
      reasonEffectId: 1,
    });

    const restoredDestroyed = restoreVicWindow({ reader, source, workspace, promptOverrides: [] });
    const destroyedVic = requireCard(restoredDestroyed.session, vicCode);
    destroyDuelCard(restoredDestroyed.session.state, destroyedVic.uid, 0, duelReason.effect | duelReason.destroy, 1);
    const restoredDestroyedTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDestroyed.session), source, reader);
    expectCleanRestore(restoredDestroyedTrigger);
    expectRestoredLegalActions(restoredDestroyedTrigger, 0);
    expect(restoredDestroyedTrigger.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonPlayer: trigger.eventReasonPlayer,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-2-1029", eventCardUid: destroyedVic.uid, eventCode: 1029, eventName: "destroyed", eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 1, player: 0, sourceUid: destroyedVic.uid, triggerBucket: "turnOptional" },
    ]);
    const destroyedTrigger = getLuaRestoreLegalActions(restoredDestroyedTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === destroyedVic.uid && action.effectId === "lua-2-1029"
    );
    expect(destroyedTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDestroyedTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroyedTrigger, destroyedTrigger!);
    expect(restoredDestroyedTrigger.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restoredDestroyedTrigger);
    expect(restoredDestroyedTrigger.session.state.cards.find((card) => card.uid === destroyedVic.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: destroyedVic.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredDestroyedTrigger.session.state.cards.find((card) => card.uid === destroyedVic.uid), restoredDestroyedTrigger.session.state)).toBe(2400);
    expect(restoredDestroyedTrigger.session.state.effects.filter((effect) => effect.sourceUid === destroyedVic.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: 0x400, reset: { flags: 33427456 }, sourceUid: destroyedVic.uid, value: 1200 },
    ]);
    expect(restoredDestroyedTrigger.session.state.eventHistory.filter((event) => ["destroyed", "becameTarget", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "destroyed", eventCode: 1029, eventCardUid: destroyedVic.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: destroyedVic.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 2, previous: "monsterZone", current: "graveyard" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: destroyedVic.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: destroyedVic.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "graveyard", current: "monsterZone" },
    ]);
    expect(restoredDestroyedTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === vicCode),
    { code: handMachineCode, name: "Vic Viper Hand Machine", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeLight, level: 4, attack: 1600, defense: 1000 },
    { code: deckMachineCode, name: "Vic Viper Deck Machine", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
  ];
}

function restoreVicWindow({
  reader,
  source,
  workspace,
  promptOverrides,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: ReturnType<typeof createUpstreamNodeWorkspace>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  promptOverrides: SelectEffectOverride[];
}) {
  const session = createDuel({ seed: 78910832, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [vicCode, handMachineCode, deckMachineCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, vicCode), 0, 0);
  moveDuelCard(session.state, requireCard(session, handMachineCode).uid, "hand", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(vicCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader, { promptOverrides });
  expectCleanRestore(restored);
  expectRestoredLegalActions(restored, 0);
  return restored;
}

function changeToBattleAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, vic: DuelCardInstance): void {
  const battle = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
  expect(battle, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, battle!);
  expect(restored.session.state.pendingTriggers.map((trigger) => ({
    effectId: trigger.effectId,
    eventCode: trigger.eventCode,
    eventName: trigger.eventName,
    player: trigger.player,
    sourceUid: trigger.sourceUid,
    triggerBucket: trigger.triggerBucket,
  }))).toEqual([
    { effectId: "lua-1-4104", eventCode: 4104, eventName: "phaseBattle", player: 0, sourceUid: vic.uid, triggerBucket: "turnOptional" },
  ]);
}

function activateBattleTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>, vic: DuelCardInstance, effectId: string): void {
  const trigger = getLuaRestoreLegalActions(restored, 0).find((action) =>
    action.type === "activateTrigger" && action.uid === vic.uid && action.effectId === effectId
  );
  expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, trigger!);
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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
