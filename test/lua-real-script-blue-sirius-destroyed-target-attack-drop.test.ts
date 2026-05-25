import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const blueSiriusCode = "32995007";
const tunerCode = "329950070";
const nonTunerCode = "329950071";
const opponentTargetCode = "329950072";
const ownDecoyCode = "329950073";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBlueSiriusScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${blueSiriusCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTuner = 0x1000;
const typeSynchro = 0x2000;
const raceBeastWarrior = 0x4000;
const attributeDark = 0x20;
const effectUpdateAttack = 100;
const effectFlagCardTarget = 0x10;
const resetEventStandard = 33427456;

describe.skipIf(!hasUpstreamScripts || !hasBlueSiriusScript)("Lua real script Blue Sirius destroyed target attack drop", () => {
  it("restores generic Synchro metadata into destroyed-from-field targeted opponent ATK loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${blueSiriusCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 32995007, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [tunerCode, nonTunerCode, ownDecoyCode], extra: [blueSiriusCode] },
      1: { main: [opponentTargetCode] },
    });
    startDuel(session);

    const blueSirius = requireCard(session, blueSiriusCode);
    const tuner = requireCard(session, tunerCode);
    const nonTuner = requireCard(session, nonTunerCode);
    const opponentTarget = requireCard(session, opponentTargetCode);
    const ownDecoy = requireCard(session, ownDecoyCode);
    moveFaceUpAttack(session, tuner, 0, 0);
    moveFaceUpAttack(session, nonTuner, 0, 1);
    moveFaceUpAttack(session, ownDecoy, 0, 2);
    moveFaceUpAttack(session, opponentTarget, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(blueSiriusCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(blueSirius.data).toMatchObject({
      synchroTunerMin: 1,
      synchroTunerMax: 1,
      synchroNonTunerMin: 1,
      synchroNonTunerMax: 99,
    });
    expect(session.state.effects.filter((effect) => effect.sourceUid === blueSirius.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", property: 263168, sourceUid: blueSirius.uid },
      { category: 2097152, code: 1014, event: "trigger", property: effectFlagCardTarget, sourceUid: blueSirius.uid },
    ]);

    const synchroSummon = getLegalActions(session, 0).find((action): action is Extract<DuelAction, { type: "synchroSummon" }> =>
      action.type === "synchroSummon" && action.uid === blueSirius.uid && sameMembers(action.materialUids, [tuner.uid, nonTuner.uid])
    );
    expect(synchroSummon, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, synchroSummon!);

    const restoredSummoned = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredSummoned);
    expectRestoredLegalActions(restoredSummoned, 0);
    expect(restoredSummoned.session.state.cards.find((card) => card.uid === blueSirius.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "synchro",
      summonMaterialUids: [tuner.uid, nonTuner.uid],
    });

    destroyDuelCard(restoredSummoned.session.state, blueSirius.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(restoredSummoned.session.state.cards.find((card) => card.uid === blueSirius.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 1,
    });
    expect(restoredSummoned.session.state.pendingTriggers.map((trigger) => ({
      sourceUid: trigger.sourceUid,
      player: trigger.player,
      triggerBucket: trigger.triggerBucket,
      eventName: trigger.eventName,
      eventCode: trigger.eventCode,
      eventCardUid: trigger.eventCardUid,
      eventReason: trigger.eventReason,
      eventReasonPlayer: trigger.eventReasonPlayer,
    }))).toEqual([
      {
        sourceUid: blueSirius.uid,
        player: 0,
        triggerBucket: "turnMandatory",
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: blueSirius.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummoned.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === blueSirius.uid
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === opponentTarget.uid), restoredTrigger.session.state)).toBe(200);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === ownDecoy.uid), restoredTrigger.session.state)).toBe(1600);
    expect(restoredTrigger.session.state.effects.filter((effect) => [opponentTarget.uid, ownDecoy.uid].includes(effect.sourceUid) && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: undefined, reset: { flags: resetEventStandard }, sourceUid: opponentTarget.uid, value: -2400 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["usedAsMaterial", "specialSummoned", "destroyed", "sentToGraveyard", "becameTarget"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: tuner.uid, eventReason: duelReason.material | duelReason.synchro, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "monsterZone", current: "graveyard", relatedEffectId: undefined },
      { eventName: "usedAsMaterial", eventCode: 1108, eventCardUid: tuner.uid, eventReason: duelReason.synchro, eventReasonPlayer: 0, eventReasonCardUid: blueSirius.uid, eventReasonEffectId: undefined, previous: "monsterZone", current: "graveyard", relatedEffectId: undefined },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: nonTuner.uid, eventReason: duelReason.material | duelReason.synchro, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "monsterZone", current: "graveyard", relatedEffectId: undefined },
      { eventName: "usedAsMaterial", eventCode: 1108, eventCardUid: nonTuner.uid, eventReason: duelReason.synchro, eventReasonPlayer: 0, eventReasonCardUid: blueSirius.uid, eventReasonEffectId: undefined, previous: "monsterZone", current: "graveyard", relatedEffectId: undefined },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: blueSirius.uid, eventReason: duelReason.summon | duelReason.specialSummon | duelReason.synchro, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "extraDeck", current: "monsterZone", relatedEffectId: undefined },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: blueSirius.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "monsterZone", current: "graveyard", relatedEffectId: undefined },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: blueSirius.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "monsterZone", current: "graveyard", relatedEffectId: undefined },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: opponentTarget.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "deck", current: "monsterZone", relatedEffectId: 3 },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === opponentTarget.uid), restoredAfter.session.state)).toBe(200);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Celestial Wolf Lord, Blue Sirius");
  expect(script).toContain("Synchro.AddProcedure(c,nil,1,1,Synchro.NonTuner(nil),1,99)");
  expect(script).toContain("e1:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("return e:GetHandler():IsPreviousLocation(LOCATION_ONFIELD) and e:GetHandler():IsReason(REASON_DESTROY)");
  expect(script).toContain("Duel.IsExistingTarget(Card.IsFaceup,tp,0,LOCATION_MZONE,1,nil)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.GetFirstTarget()");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(-2400)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD)");
}

function cards(): DuelCardData[] {
  return [
    { code: blueSiriusCode, name: "Celestial Wolf Lord, Blue Sirius", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceBeastWarrior, attribute: attributeDark, level: 6, attack: 2400, defense: 1500 },
    { code: tunerCode, name: "Blue Sirius Tuner", kind: "monster", typeFlags: typeMonster | typeEffect | typeTuner, race: raceBeastWarrior, attribute: attributeDark, level: 3, attack: 1000, defense: 1000 },
    { code: nonTunerCode, name: "Blue Sirius Non-Tuner", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeDark, level: 3, attack: 1200, defense: 1000 },
    { code: opponentTargetCode, name: "Blue Sirius Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeDark, level: 4, attack: 2600, defense: 1000 },
    { code: ownDecoyCode, name: "Blue Sirius Own Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeDark, level: 4, attack: 1600, defense: 1000 },
  ];
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

function sameMembers(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && expected.every((uid) => actual.includes(uid));
}
