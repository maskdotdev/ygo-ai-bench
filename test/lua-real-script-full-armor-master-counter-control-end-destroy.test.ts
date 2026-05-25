import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const fullArmorCode = "54082269";
const targetCode = "540822690";
const wedgeCounter = 0x1002;
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSynchro = 0x2000;
const raceWingedBeast = 0x80;
const attributeDark = 0x20;
const categoryControl = 0x2000;
const categoryDestroy = 0x1;
const eventPhaseEnd = 0x1200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Blackwing Full Armor Master counter control end destroy", () => {
  it("restores immunity, chain watchers, Wedge Counter control, and turn-player End Phase destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${fullArmorCode}.lua`);
    expect(script).toContain("--Blackwing Full Armor Master");
    expect(script).toContain("Synchro.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_BLACKWING),1,1,Synchro.NonTuner(nil),1,99)");
    expect(script).toContain("e1:SetCode(EFFECT_IMMUNE_EFFECT)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_SINGLE_RANGE)");
    expect(script).toContain("e2:SetCode(EVENT_CHAINING)");
    expect(script).toContain("e2:SetOperation(aux.chainreg)");
    expect(script).toContain("e3:SetCode(EVENT_CHAIN_SOLVED)");
    expect(script).toContain("local p,loc=Duel.GetChainInfo(ev,CHAININFO_TRIGGERING_PLAYER,CHAININFO_TRIGGERING_LOCATION)");
    expect(script).toContain("re:IsMonsterEffect() and re:GetHandler():GetCounter(0x1002)==0 and p~=tp and loc==LOCATION_MZONE and c:GetFlagEffect(1)>0");
    expect(script).toContain("re:GetHandler():AddCounter(0x1002,1)");
    expect(script).toContain("e4:SetCategory(CATEGORY_CONTROL)");
    expect(script).toContain("e4:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("e4:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("return c:GetCounter(0x1002)>0 and c:IsControlerCanBeChanged()");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.GetControl(tc,tp)");
    expect(script).toContain("e5:SetCode(EVENT_PHASE+PHASE_END)");
    expect(script).toContain("return tp==Duel.GetTurnPlayer()");
    expect(script).toContain("Duel.GetMatchingGroup(s.desfilter,tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
    expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      { code: fullArmorCode, name: "Blackwing Full Armor Master", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceWingedBeast, attribute: attributeDark, level: 10, attack: 3000, defense: 3000 },
      { code: targetCode, name: "Full Armor Master Wedge Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 54082269, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [], extra: [fullArmorCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const fullArmor = requireCard(session, fullArmorCode);
    const target = requireCard(session, targetCode);
    moveFaceUpAttack(session, fullArmor, 0);
    moveFaceUpAttack(session, target, 1);
    expect(addDuelCardCounter(target, wedgeCounter, 1)).toBe(true);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(fullArmorCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(
      restoredOpen.session.state.effects
        .filter((effect) => effect.sourceUid === fullArmor.uid)
        .map((effect) => ({
          category: effect.category,
          code: effect.code,
          event: effect.event,
          property: effect.property,
          range: effect.range,
          triggerEvent: effect.triggerEvent,
        })),
    ).toEqual([
      { category: undefined, code: 31, event: "continuous", property: 263168, range: ["monsterZone"], triggerEvent: undefined },
      { category: undefined, code: 1, event: "continuous", property: 131072, range: ["monsterZone"], triggerEvent: undefined },
      { category: undefined, code: 1027, event: "continuous", property: 1024, range: ["monsterZone"], triggerEvent: undefined },
      { category: undefined, code: 1022, event: "continuous", property: undefined, range: ["monsterZone"], triggerEvent: undefined },
      { category: categoryControl, code: undefined, event: "ignition", property: 16, range: ["monsterZone"], triggerEvent: undefined },
      { category: categoryDestroy, code: eventPhaseEnd, event: "trigger", property: undefined, range: ["monsterZone"], triggerEvent: "phaseEnd" },
    ]);

    const control = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === fullArmor.uid);
    expect(control, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, control!);
    expect(restoredOpen.session.state.chain).toEqual([]);

    const restoredControlledState = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredControlledState);
    expectRestoredLegalActions(restoredControlledState, 0);
    expect(restoredControlledState.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      controller: 0,
      previousController: 1,
      location: "monsterZone",
    });
    expect(restoredControlledState.session.state.eventHistory.filter((event) => event.eventName === "controlChanged" && event.eventCardUid === target.uid)).toEqual([
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: target.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: fullArmor.uid,
        eventReasonEffectId: 6,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);

    const restoredControlled = restoreDuelWithLuaScripts(serializeDuel(restoredControlledState.session), workspace, reader);
    expectCleanRestore(restoredControlled);
    expectRestoredLegalActions(restoredControlled, 0);
    changePhase(restoredControlled, 0, "battle");
    changePhase(restoredControlled, 0, "main2");
    changePhase(restoredControlled, 0, "end");
    expect(restoredControlled.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-10-1",
        effectId: "lua-7-4608",
        eventCode: eventPhaseEnd,
        eventName: "phaseEnd",
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: fullArmor.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredEnd = restoreDuelWithLuaScripts(serializeDuel(restoredControlled.session), workspace, reader);
    expectCleanRestore(restoredEnd);
    expectRestoredLegalActions(restoredEnd, 0);
    const endTrigger = getLuaRestoreLegalActions(restoredEnd, 0).find((action) => action.type === "activateTrigger" && action.uid === fullArmor.uid && action.effectId === "lua-7-4608");
    expect(endTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredEnd, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEnd, endTrigger!);

    const restoredEndChain = restoreDuelWithLuaScripts(serializeDuel(restoredEnd.session), workspace, reader);
    expectCleanRestore(restoredEndChain);
    expectRestoredLegalActions(restoredEndChain, 1);
    resolveRestoredChain(restoredEndChain);
    expect(restoredEndChain.session.state.cards.find((card) => card.uid === fullArmor.uid)).toMatchObject({ controller: 0, location: "monsterZone" });
    expect(restoredEndChain.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      controller: 0,
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: fullArmor.uid,
      reasonEffectId: 7,
    });
    expect(restoredEndChain.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === target.uid)).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: target.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: fullArmor.uid,
        eventReasonEffectId: 7,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: 0 | 1): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
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

function changePhase(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1, phase: DuelSession["state"]["phase"]): void {
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "changePhase" && candidate.phase === phase);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, action!);
}
