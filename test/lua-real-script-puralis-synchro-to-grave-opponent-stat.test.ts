import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { CardPosition, DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const puralisCode = "37038993";
const tunerCode = "370389930";
const nonTunerCode = "370389931";
const sendSpellCode = "370389932";
const ownMonsterCode = "370389933";
const opponentFaceUpCode = "370389934";
const opponentFaceDownCode = "370389935";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasPuralisScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${puralisCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeTuner = 0x1000;
const typeSynchro = 0x2000;
const raceReptile = 0x20000;
const attributeFire = 0x4;
const eventToGrave = 1014;
const effectUpdateAttack = 100;
const resetEventStandard = 33427456;

describe.skipIf(!hasUpstreamScripts || !hasPuralisScript)("Lua real script Puralis Synchro to-Grave opponent stat", () => {
  it("restores its Synchro procedure and previous-field EVENT_TO_GRAVE opponent ATK loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${puralisCode}.lua`);
    expectScriptShape(script);
    const source = sourceWithSendSpell(workspace);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 37038993, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [tunerCode, nonTunerCode, sendSpellCode, ownMonsterCode], extra: [puralisCode] },
      1: { main: [opponentFaceUpCode, opponentFaceDownCode] },
    });
    startDuel(session);

    const puralis = requireCard(session, puralisCode);
    const tuner = requireCard(session, tunerCode);
    const nonTuner = requireCard(session, nonTunerCode);
    const sendSpell = requireCard(session, sendSpellCode);
    const ownMonster = requireCard(session, ownMonsterCode);
    const opponentFaceUp = requireCard(session, opponentFaceUpCode);
    const opponentFaceDown = requireCard(session, opponentFaceDownCode);
    moveMonster(session, tuner, 0, "faceUpAttack", 0);
    moveMonster(session, nonTuner, 0, "faceUpAttack", 1);
    moveMonster(session, ownMonster, 0, "faceUpAttack", 2);
    moveMonster(session, opponentFaceUp, 1, "faceUpAttack", 0);
    moveMonster(session, opponentFaceDown, 1, "faceDownDefense", 1);
    moveDuelCard(session.state, sendSpell.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(Number(puralisCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(sendSpellCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(puralis.data).toMatchObject({
      synchroTunerMin: 1,
      synchroTunerMax: 1,
      synchroNonTunerMin: 1,
      synchroNonTunerMax: 1,
    });
    expect(session.state.effects.filter((effect) => effect.sourceUid === puralis.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      sourceUid: effect.sourceUid,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", sourceUid: puralis.uid, triggerEvent: undefined },
      { category: 2097152, code: eventToGrave, event: "trigger", sourceUid: puralis.uid, triggerEvent: "sentToGraveyard" },
    ]);

    const synchroSummon = getLegalActions(session, 0).find((action): action is Extract<DuelAction, { type: "synchroSummon" }> =>
      action.type === "synchroSummon" && action.uid === puralis.uid && sameMembers(action.materialUids, [tuner.uid, nonTuner.uid])
    );
    expect(synchroSummon, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, synchroSummon!);

    const restoredSummoned = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredSummoned);
    expectRestoredLegalActions(restoredSummoned, 0);
    expect(findCard(restoredSummoned.session, puralis.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "synchro",
      summonMaterialUids: [tuner.uid, nonTuner.uid],
    });

    const send = getLuaRestoreLegalActions(restoredSummoned, 0).find((action) => action.type === "activateEffect" && action.uid === sendSpell.uid);
    expect(send, JSON.stringify(getLuaRestoreLegalActions(restoredSummoned, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummoned, send!);
    resolveRestoredChain(restoredSummoned);
    expect(findCard(restoredSummoned.session, puralis.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: sendSpell.uid,
      reasonEffectId: 1,
    });
    expect(restoredSummoned.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonCardUid: trigger.eventReasonCardUid,
      eventReasonEffectId: trigger.eventReasonEffectId,
      eventTriggerTiming: trigger.eventTriggerTiming,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-4-1014",
        eventCardUid: puralis.uid,
        eventName: "sentToGraveyard",
        eventReason: duelReason.effect,
        eventReasonCardUid: sendSpell.uid,
        eventReasonEffectId: 1,
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: puralis.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummoned.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === puralis.uid && action.effectId === "lua-4-1014"
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    expect(currentAttack(findCard(restoredTrigger.session, ownMonster.uid), restoredTrigger.session.state)).toBe(1600);
    expect(currentAttack(findCard(restoredTrigger.session, opponentFaceUp.uid), restoredTrigger.session.state)).toBe(1200);
    expect(currentAttack(findCard(restoredTrigger.session, opponentFaceDown.uid), restoredTrigger.session.state)).toBe(1800);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === opponentFaceUp.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", property: undefined, reset: { flags: resetEventStandard }, sourceUid: opponentFaceUp.uid, value: -500 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["usedAsMaterial", "specialSummoned", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
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
      { eventCardUid: tuner.uid, eventCode: eventToGrave, eventName: "sentToGraveyard", eventReason: duelReason.synchro | duelReason.material, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "monsterZone", current: "graveyard" },
      { eventCardUid: tuner.uid, eventCode: 1108, eventName: "usedAsMaterial", eventReason: duelReason.synchro, eventReasonCardUid: puralis.uid, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "monsterZone", current: "graveyard" },
      { eventCardUid: nonTuner.uid, eventCode: eventToGrave, eventName: "sentToGraveyard", eventReason: duelReason.synchro | duelReason.material, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "monsterZone", current: "graveyard" },
      { eventCardUid: nonTuner.uid, eventCode: 1108, eventName: "usedAsMaterial", eventReason: duelReason.synchro, eventReasonCardUid: puralis.uid, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "monsterZone", current: "graveyard" },
      { eventCardUid: puralis.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon | duelReason.synchro, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "extraDeck", current: "monsterZone" },
      { eventCardUid: puralis.uid, eventCode: eventToGrave, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonCardUid: sendSpell.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previous: "monsterZone", current: "graveyard" },
      { eventCardUid: sendSpell.uid, eventCode: eventToGrave, eventName: "sentToGraveyard", eventReason: duelReason.rule, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "spellTrapZone", current: "graveyard" },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(findCard(restoredAfter.session, opponentFaceUp.uid), restoredAfter.session.state)).toBe(1200);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Puralis, the Purple Pyrotile");
  expect(script).toContain("Synchro.AddProcedure(c,nil,1,1,Synchro.NonTuner(nil),1,1)");
  expect(script).toContain("c:EnableReviveLimit()");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("return e:GetHandler():IsPreviousLocation(LOCATION_ONFIELD)");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("e1:SetValue(-500)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD)");
}

function cards(): DuelCardData[] {
  return [
    { code: puralisCode, name: "Puralis, the Purple Pyrotile", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceReptile, attribute: attributeFire, level: 2, attack: 800, defense: 1400 },
    { code: tunerCode, name: "Puralis Tuner", kind: "monster", typeFlags: typeMonster | typeEffect | typeTuner, race: raceReptile, attribute: attributeFire, level: 1, attack: 500, defense: 500 },
    { code: nonTunerCode, name: "Puralis Non-Tuner", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeFire, level: 1, attack: 500, defense: 500 },
    { code: sendSpellCode, name: "Puralis Send Spell", kind: "spell", typeFlags: typeSpell },
    { code: ownMonsterCode, name: "Puralis Own Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeFire, level: 4, attack: 1600, defense: 1000 },
    { code: opponentFaceUpCode, name: "Puralis Opponent Face-Up", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeFire, level: 4, attack: 1700, defense: 1000 },
    { code: opponentFaceDownCode, name: "Puralis Opponent Face-Down", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeFire, level: 4, attack: 1800, defense: 1000 },
  ];
}

function sourceWithSendSpell(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  return {
    readScript(name: string) {
      if (name === `c${sendSpellCode}.lua`) return sendPuralisScript();
      return workspace.readScript(name);
    },
  };
}

function sendPuralisScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(s.operation)
      c:RegisterEffect(e)
    end
    function s.operation(e,tp)
      local tc=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${puralisCode}),tp,LOCATION_MZONE,0,nil)
      if tc then Duel.SendtoGrave(tc,REASON_EFFECT) end
    end
  `;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function moveMonster(session: DuelSession, card: DuelCardInstance, player: PlayerId, position: CardPosition, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = position !== "faceDownDefense";
  moved.position = position;
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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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

function sameMembers(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && expected.every((uid) => actual.includes(uid));
}
