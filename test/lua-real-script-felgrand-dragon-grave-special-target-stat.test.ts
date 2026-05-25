import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const felgrandCode = "3954901";
const graveTargetCode = "39549010";
const graveDecoyCode = "39549011";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasFelgrandScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${felgrandCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceDragon = 0x2000;
const attributeLight = 0x10;
const effectSpecialSummonCondition = 30;
const effectUpdateAttack = 100;
const effectFlagCardTarget = 0x10;
const resetEventStandardDisable = 33492992;

describe.skipIf(!hasUpstreamScripts || !hasFelgrandScript)("Lua real script Felgrand Dragon grave special target stat", () => {
  it("restores previous-field grave special summon condition into targeted level-based ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${felgrandCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 3954901, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [felgrandCode, graveTargetCode, graveDecoyCode] }, 1: { main: [] } });
    startDuel(session);

    const felgrand = requireCard(session, felgrandCode);
    const graveTarget = requireCard(session, graveTargetCode);
    const graveDecoy = requireCard(session, graveDecoyCode);
    moveFaceUpAttack(session, felgrand, 0);
    moveDuelCard(session.state, felgrand.uid, "graveyard", 0, duelReason.effect | duelReason.destroy, 1);
    moveDuelCard(session.state, graveTarget.uid, "graveyard", 0);
    moveDuelCard(session.state, graveDecoy.uid, "graveyard", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(felgrandCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.cards.find((card) => card.uid === felgrand.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
    });
    expect(session.state.effects.filter((effect) => effect.sourceUid === felgrand.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: undefined, code: effectSpecialSummonCondition, event: "continuous", property: 263168, sourceUid: felgrand.uid },
      { category: 2097152, code: 1102, event: "trigger", property: effectFlagCardTarget, sourceUid: felgrand.uid },
    ]);

    specialSummonDuelCard(session.state, felgrand.uid, 0, 0);
    expect(session.state.pendingTriggers.map((trigger) => ({
      sourceUid: trigger.sourceUid,
      player: trigger.player,
      triggerBucket: trigger.triggerBucket,
      eventName: trigger.eventName,
      eventCode: trigger.eventCode,
      eventCardUid: trigger.eventCardUid,
    }))).toEqual([
      {
        sourceUid: felgrand.uid,
        player: 0,
        triggerBucket: "turnMandatory",
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: felgrand.uid,
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === felgrand.uid
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === felgrand.uid), restoredTrigger.session.state)).toBe(4000);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === felgrand.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: undefined, reset: { flags: resetEventStandardDisable }, sourceUid: felgrand.uid, value: 1200 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["becameTarget", "specialSummoned"].includes(event.eventName)).map((event) => ({
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
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: felgrand.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "graveyard", current: "monsterZone", relatedEffectId: undefined },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: graveTarget.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "deck", current: "graveyard", relatedEffectId: 2 },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === felgrand.uid), restoredAfter.session.state)).toBe(4000);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Felgrand Dragon");
  expect(script).toContain("return e:GetHandler():IsLocation(LOCATION_GRAVE) and e:GetHandler():IsPreviousLocation(LOCATION_ONFIELD)");
  expect(script).toContain("return e:GetHandler():IsPreviousLocation(LOCATION_GRAVE)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("local tc=Duel.GetFirstTarget()");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(tc:GetLevel()*200)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD_DISABLE)");
}

function cards(): DuelCardData[] {
  return [
    { code: felgrandCode, name: "Felgrand Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeLight, level: 8, attack: 2800, defense: 2800 },
    { code: graveTargetCode, name: "Felgrand Level 6 Grave Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeLight, level: 6, attack: 1800, defense: 1200 },
    { code: graveDecoyCode, name: "Felgrand Level 4 Grave Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeLight, level: 4, attack: 1600, defense: 1000 },
  ];
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
