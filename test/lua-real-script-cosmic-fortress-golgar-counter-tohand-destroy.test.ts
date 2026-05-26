import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const golgarCode = "68319538";
const ownSpellCode = "683195380";
const opponentSpellCode = "683195381";
const opponentTargetCode = "683195382";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasGolgarScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${golgarCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeSynchro = 0x2000;
const setAlien = 0xc;
const counterA = 0x100e;

describe.skipIf(!hasUpstreamScripts || !hasGolgarScript)("Lua real script Cosmic Fortress Golgar counter toHand destroy", () => {
  it("restores Spell/Trap returns into A-Counters, then removes counters to destroy an opponent card", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${golgarCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = setupDuel(reader);
    const golgar = requireCard(session, golgarCode);
    const ownSpell = requireCard(session, ownSpellCode);
    const opponentSpell = requireCard(session, opponentSpellCode);
    const opponentTarget = requireCard(session, opponentTargetCode);
    moveFaceUpAttack(session, golgar, 0, 0);
    moveFaceUpAttack(session, opponentTarget, 1, 0);
    moveFaceUpSpell(session, ownSpell, 0, 0);
    moveFaceUpSpell(session, opponentSpell, 1, 0);
    registerGolgar(session, workspace);

    const restoredReturn = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredReturn);
    expectRestoredLegalActions(restoredReturn, 0);
    expect(restoredReturn.session.state.effects.filter((effect) => effect.sourceUid === golgar.uid).map((effect) => ({
      category: effect.category,
      event: effect.event,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: undefined, event: "continuous", property: 263168, range: ["monsterZone"] },
      { category: 0x800000 | 0x8, event: "ignition", property: 16, range: ["monsterZone"] },
      { category: 0x1, event: "ignition", property: 16, range: ["monsterZone"] },
    ]);
    const returnAction = getLuaRestoreLegalActions(restoredReturn, 0).find((action) =>
      action.type === "activateEffect" && action.uid === golgar.uid && action.effectId === "lua-3"
    );
    expect(returnAction, JSON.stringify(getLuaRestoreLegalActions(restoredReturn, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredReturn, returnAction!);
    resolveRestoredChain(restoredReturn);

    expect(restoredReturn.session.state.cards.find((card) => card.uid === ownSpell.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: golgar.uid,
      reasonEffectId: 3,
    });
    expect(restoredReturn.session.state.cards.find((card) => card.uid === opponentSpell.uid)).toMatchObject({
      location: "hand",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: golgar.uid,
      reasonEffectId: 3,
    });
    expect(getDuelCardCounter(restoredReturn.session.state.cards.find((card) => card.uid === golgar.uid), counterA)).toBe(2);

    const restoredDestroy = restoreDuelWithLuaScripts(serializeDuel(restoredReturn.session), workspace, reader);
    expectCleanRestore(restoredDestroy);
    expectRestoredLegalActions(restoredDestroy, 0);
    const destroyAction = getLuaRestoreLegalActions(restoredDestroy, 0).find((action) =>
      action.type === "activateEffect" && action.uid === golgar.uid && action.effectId === "lua-4"
    );
    expect(destroyAction, JSON.stringify(getLuaRestoreLegalActions(restoredDestroy, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroy, destroyAction!);
    resolveRestoredChain(restoredDestroy);

    expect(getDuelCardCounter(restoredDestroy.session.state.cards.find((card) => card.uid === golgar.uid), counterA)).toBe(0);
    expect(restoredDestroy.session.state.cards.find((card) => card.uid === opponentTarget.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: golgar.uid,
      reasonEffectId: 4,
    });
    expect(restoredDestroy.session.state.eventHistory.filter((event) =>
      ["becameTarget", "sentToHand", "counterAdded", "counterRemoved", "destroyed"].includes(event.eventName)
    ).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: ownSpell.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 3 },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: opponentSpell.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 3 },
      { eventName: "sentToHand", eventCode: 1012, eventCardUid: ownSpell.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: golgar.uid, eventReasonEffectId: 3, relatedEffectId: undefined },
      { eventName: "sentToHand", eventCode: 1012, eventCardUid: opponentSpell.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: golgar.uid, eventReasonEffectId: 3, relatedEffectId: undefined },
      { eventName: "sentToHand", eventCode: 1012, eventCardUid: ownSpell.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: golgar.uid, eventReasonEffectId: 3, relatedEffectId: undefined },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: golgar.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: golgar.uid, eventReasonEffectId: 3, relatedEffectId: undefined },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: golgar.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: golgar.uid, eventReasonEffectId: 3, relatedEffectId: undefined },
      { eventName: "counterRemoved", eventCode: 0x20000, eventCardUid: golgar.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: golgar.uid, eventReasonEffectId: 4, relatedEffectId: undefined },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: opponentTarget.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 4 },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: opponentTarget.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: golgar.uid, eventReasonEffectId: 4, relatedEffectId: undefined },
    ]);
  });
});

function setupDuel(reader: ReturnType<typeof createCardReader>): DuelSession {
  const session = createDuel({ seed: 68319538, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { extra: [golgarCode], main: [ownSpellCode] }, 1: { main: [opponentSpellCode, opponentTargetCode] } });
  startDuel(session);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return session;
}

function registerGolgar(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(golgarCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Cosmic Fortress Gol'gar");
  expect(script).toContain("Synchro.AddProcedure(c,aux.FilterSummonCode(652362),1,1,Synchro.NonTunerEx(Card.IsSetCard,SET_ALIEN),1,99)");
  expect(script).toContain("c:EnableReviveLimit()");
  expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND+CATEGORY_COUNTER)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,16,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,g,#g,0,0)");
  expect(script).toContain("local tg=Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)");
  expect(script).toContain("local rg=tg:Filter(Card.IsRelateToEffect,nil,e)");
  expect(script).toContain("Duel.SendtoHand(rg,nil,REASON_EFFECT)");
  expect(script).toContain("local g=Duel.GetMatchingGroup(Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
  expect(script).toContain("sg:GetFirst():AddCounter(COUNTER_A,1)");
  expect(script).toContain("Duel.IsCanRemoveCounter(tp,1,1,COUNTER_A,2,REASON_COST)");
  expect(script).toContain("Duel.RemoveCounter(tp,1,1,COUNTER_A,2,REASON_COST)");
  expect(script).toContain("Duel.SelectTarget(tp,aux.TRUE,tp,0,LOCATION_ONFIELD,1,1,nil)");
  expect(script).toContain("Duel.GetFirstTarget()");
  expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: golgarCode, name: "Cosmic Fortress Gol'gar", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, level: 5, attack: 2600, defense: 1800, setcodes: [setAlien] },
    { code: ownSpellCode, name: "Golgar Own Continuous Spell", kind: "spell", typeFlags: typeSpell },
    { code: opponentSpellCode, name: "Golgar Opponent Continuous Spell", kind: "spell", typeFlags: typeSpell },
    { code: opponentTargetCode, name: "Golgar Destroy Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1500, defense: 1200 },
  ];
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

function moveFaceUpSpell(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
