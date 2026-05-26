import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getDuelCardCounter } from "#duel/counters.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const tempestCode = "63101919";
const tunerCode = "631019190";
const nonTunerCode = "631019191";
const costACode = "631019192";
const costBCode = "631019193";
const spellCounter = 0x1;
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTuner = 0x1000;
const raceSpellcaster = 0x2;
const raceWarrior = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Tempest Magician Spell Counter damage", () => {
  it("restores Synchro summon counter trigger, hand-send cost counters, and all Spell Counter damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${tempestCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 63101919, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [tunerCode, nonTunerCode, costACode, costBCode], extra: [tempestCode] }, 1: { main: [] } });
    startDuel(session);

    const tempest = requireCard(session, tempestCode);
    const tuner = requireCard(session, tunerCode);
    const nonTuner = requireCard(session, nonTunerCode);
    const costA = requireCard(session, costACode);
    const costB = requireCard(session, costBCode);
    moveFaceUpAttack(session, tuner, 0);
    moveFaceUpAttack(session, nonTuner, 0);
    moveDuelCard(session.state, costA.uid, "hand", 0);
    moveDuelCard(session.state, costB.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(tempestCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(tempest.data.synchroTunerMin).toBe(1);
    expect(tempest.data.synchroTunerMax).toBe(1);
    expect(tempest.data.synchroNonTunerMin).toBe(1);
    expect(tempest.data.synchroNonTunerMax).toBe(99);
    expect(session.state.effects.filter((effect) => effect.sourceUid === tempest.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      value: effect.value,
    }))).toEqual([
      { code: 0x10000 + spellCounter, event: "continuous", range: ["extraDeck"], value: 4 },
      { code: 31, event: "continuous", range: ["extraDeck"], value: undefined },
      { code: 1102, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], value: undefined },
      { code: undefined, event: "ignition", range: ["monsterZone"], value: undefined },
      { code: undefined, event: "ignition", range: ["monsterZone"], value: undefined },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const synchro = getLuaRestoreLegalActions(restoredOpen, 0).find(
      (action) => action.type === "synchroSummon" && action.uid === tempest.uid && action.materialUids.includes(tuner.uid) && action.materialUids.includes(nonTuner.uid),
    );
    expect(synchro, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, synchro!);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === tempest.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      summonType: "synchro",
      summonMaterialUids: [tuner.uid, nonTuner.uid],
      reason: duelReason.summon | duelReason.specialSummon | duelReason.synchro,
    });
    expect(restoredOpen.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-7-1",
        effectId: "lua-4-1102",
        sourceUid: tempest.uid,
        player: 0,
        triggerBucket: "turnMandatory",
        eventName: "specialSummoned",
        eventPlayer: 0,
        eventCode: 1102,
        eventCardUid: tempest.uid,
        eventReason: duelReason.summon | duelReason.specialSummon | duelReason.synchro,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === tempest.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(getDuelCardCounter(restoredTrigger.session.state.cards.find((card) => card.uid === tempest.uid), spellCounter)).toBe(1);

    const restoredCounterIgnition = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredCounterIgnition);
    expectRestoredLegalActions(restoredCounterIgnition, 0);
    const addCounter = getLuaRestoreLegalActions(restoredCounterIgnition, 0).filter((action) => action.type === "activateEffect" && action.uid === tempest.uid)[0];
    expect(addCounter, JSON.stringify(getLuaRestoreLegalActions(restoredCounterIgnition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredCounterIgnition, addCounter!);
    expect(restoredCounterIgnition.session.state.cards.find((card) => card.uid === costA.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: tempest.uid,
      reasonEffectId: 5,
    });
    expect(restoredCounterIgnition.session.state.cards.find((card) => card.uid === costB.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: tempest.uid,
      reasonEffectId: 5,
    });
    expect(restoredCounterIgnition.session.state.chain).toEqual([]);
    expect(getDuelCardCounter(restoredCounterIgnition.session.state.cards.find((card) => card.uid === tempest.uid), spellCounter)).toBe(3);

    const restoredDamageIgnition = restoreDuelWithLuaScripts(serializeDuel(restoredCounterIgnition.session), workspace, reader);
    expectCleanRestore(restoredDamageIgnition);
    expectRestoredLegalActions(restoredDamageIgnition, 0);
    const damage = getLuaRestoreLegalActions(restoredDamageIgnition, 0).find((action) => action.type === "activateEffect" && action.uid === tempest.uid);
    expect(damage, JSON.stringify(getLuaRestoreLegalActions(restoredDamageIgnition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDamageIgnition, damage!);
    expect(getDuelCardCounter(restoredDamageIgnition.session.state.cards.find((card) => card.uid === tempest.uid), spellCounter)).toBe(0);
    expect(restoredDamageIgnition.session.state.chain).toEqual([]);
    expect(restoredDamageIgnition.session.state.players[1].lifePoints).toBe(6500);
    expect(restoredDamageIgnition.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 1500,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: tempest.uid,
        eventReasonEffectId: 6,
      },
    ]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === tempestCode),
    { code: tunerCode, name: "Tempest Magician Tuner", kind: "monster", typeFlags: typeMonster | typeTuner, race: raceWarrior, level: 2, attack: 800, defense: 1000 },
    { code: nonTunerCode, name: "Tempest Magician Spellcaster Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, level: 4, attack: 1500, defense: 1000 },
    { code: costACode, name: "Tempest Magician Cost A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
    { code: costBCode, name: "Tempest Magician Cost B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toContain("Tempest Magician");
  expect(script).toContain("c:EnableCounterPermit(COUNTER_SPELL)");
  expect(script).toContain("Synchro.AddProcedure(c,nil,1,1,Synchro.NonTunerEx(Card.IsRace,RACE_SPELLCASTER),1,99)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return e:GetHandler():IsSynchroSummoned()");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,2,0,COUNTER_SPELL)");
  expect(script).toContain("e:GetHandler():AddCounter(COUNTER_SPELL,1)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,Card.IsAbleToGraveAsCost,tp,LOCATION_HAND,0,1,63,nil)");
  expect(script).toContain("Duel.SendtoGrave(g,REASON_COST)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,Card.IsCanAddCounter,tp,LOCATION_MZONE,0,1,1,nil,COUNTER_SPELL,1)");
  expect(script).toContain("g:GetFirst():AddCounter(COUNTER_SPELL,1)");
  expect(script).toContain("Duel.GetCounter(tp,1,1,COUNTER_SPELL)>0");
  expect(script).toContain("tc:RemoveCounter(tp,COUNTER_SPELL,sct,0)");
  expect(script).toContain("Duel.SetTargetPlayer(1-tp)");
  expect(script).toContain("Duel.SetTargetParam(ct*500)");
  expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)");
  expect(script).toContain("Duel.Damage(p,d,REASON_EFFECT)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
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
