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
const needleSunfishCode = "56223084";
const opponentTargetCode = "562230840";
const ownDecoyCode = "562230841";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasNeedleSunfishScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${needleSunfishCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceFish = 0x400;
const attributeWater = 0x2;
const effectUpdateAttack = 100;
const effectFlagCardTarget = 0x10;
const resetEventStandard = 33427456;

describe.skipIf(!hasUpstreamScripts || !hasNeedleSunfishScript)("Lua real script Needle Sunfish to-Grave target attack drop", () => {
  it("restores EVENT_TO_GRAVE targeted opponent ATK loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${needleSunfishCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 56223084, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [needleSunfishCode, ownDecoyCode] }, 1: { main: [opponentTargetCode] } });
    startDuel(session);

    const needleSunfish = requireCard(session, needleSunfishCode);
    const opponentTarget = requireCard(session, opponentTargetCode);
    const ownDecoy = requireCard(session, ownDecoyCode);
    moveFaceUpAttack(session, needleSunfish, 0, 0);
    moveFaceUpAttack(session, ownDecoy, 0, 1);
    moveFaceUpAttack(session, opponentTarget, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(needleSunfishCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === needleSunfish.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { category: 2097152, code: 1014, event: "trigger", property: effectFlagCardTarget, sourceUid: needleSunfish.uid },
    ]);

    destroyDuelCard(session.state, needleSunfish.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(session.state.pendingTriggers.map((trigger) => ({
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
        sourceUid: needleSunfish.uid,
        player: 0,
        triggerBucket: "turnMandatory",
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: needleSunfish.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === needleSunfish.uid
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === opponentTarget.uid), restoredTrigger.session.state)).toBe(1300);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === ownDecoy.uid), restoredTrigger.session.state)).toBe(1500);
    expect(restoredTrigger.session.state.effects.filter((effect) => [opponentTarget.uid, ownDecoy.uid].includes(effect.sourceUid) && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: undefined, reset: { flags: resetEventStandard }, sourceUid: opponentTarget.uid, value: -500 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["destroyed", "sentToGraveyard", "becameTarget"].includes(event.eventName)).map((event) => ({
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
      { eventName: "destroyed", eventCode: 1029, eventCardUid: needleSunfish.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "monsterZone", current: "graveyard", relatedEffectId: undefined },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: needleSunfish.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "monsterZone", current: "graveyard", relatedEffectId: undefined },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: opponentTarget.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "deck", current: "monsterZone", relatedEffectId: 1 },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(currentAttack(restoredAfter.session.state.cards.find((card) => card.uid === opponentTarget.uid), restoredAfter.session.state)).toBe(1300);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Needle Sunfish");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e1:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.GetFirstTarget()");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(-500)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD)");
}

function cards(): DuelCardData[] {
  return [
    { code: needleSunfishCode, name: "Needle Sunfish", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFish, attribute: attributeWater, level: 3, attack: 1500, defense: 100 },
    { code: opponentTargetCode, name: "Needle Sunfish Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFish, attribute: attributeWater, level: 4, attack: 1800, defense: 1000 },
    { code: ownDecoyCode, name: "Needle Sunfish Own Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFish, attribute: attributeWater, level: 4, attack: 1500, defense: 1000 },
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
