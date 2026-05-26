import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const spiderCode = "4941482";
const defenseTargetCode = "49414820";
const attackDecoyCode = "49414821";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSpiderScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${spiderCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceInsect = 0x800;
const raceWarrior = 0x1;
const attributeEarth = 0x1;
const eventToGrave = 1014;
const categoryControl = 0x2000;
const effectFlagCardTarget = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasSpiderScript)("Lua real script Informer Spider effect-grave control", () => {
  it("restores effect-sent field trigger into defense-position permanent control", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${spiderCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 4941482, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [spiderCode] }, 1: { main: [defenseTargetCode, attackDecoyCode] } });
    startDuel(session);

    const spider = requireCard(session, spiderCode);
    const defenseTarget = requireCard(session, defenseTargetCode);
    const attackDecoy = requireCard(session, attackDecoyCode);
    moveFaceUpAttack(session, spider, 0, 0);
    moveFaceUpDefense(session, defenseTarget, 1, 0);
    moveFaceUpAttack(session, attackDecoy, 1, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(spiderCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === spider.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: categoryControl, code: eventToGrave, event: "trigger", property: effectFlagCardTarget, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "sentToGraveyard" },
    ]);

    destroyDuelCard(restoredOpen.session.state, spider.uid, 0, duelReason.effect | duelReason.destroy, 1);
    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers.map((trigger) => ({
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
      {
        effectId: `lua-1-${eventToGrave}`,
        eventCardUid: spider.uid,
        eventCode: eventToGrave,
        eventName: "sentToGraveyard",
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        player: 0,
        sourceUid: spider.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const activate = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === spider.uid
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, activate!);
    expect(restoredTrigger.session.state.chain).toEqual([]);

    expect(findCard(restoredTrigger.session, spider.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 1,
    });
    expect(findCard(restoredTrigger.session, defenseTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      position: "faceUpDefense",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: spider.uid,
      reasonEffectId: 1,
    });
    expect(findCard(restoredTrigger.session, attackDecoy.uid)).toMatchObject({ location: "monsterZone", controller: 1, position: "faceUpAttack" });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["destroyed", "sentToGraveyard", "becameTarget", "controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previousLocation: event.eventPreviousState?.location,
      previousController: event.eventPreviousState?.controller,
      currentLocation: event.eventCurrentState?.location,
      currentController: event.eventCurrentState?.controller,
    }))).toEqual([
      { eventName: "destroyed", eventCode: 1029, eventCardUid: spider.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined, previousLocation: "monsterZone", previousController: 0, currentLocation: "graveyard", currentController: 0 },
      { eventName: "sentToGraveyard", eventCode: eventToGrave, eventCardUid: spider.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined, previousLocation: "monsterZone", previousController: 0, currentLocation: "graveyard", currentController: 0 },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: defenseTarget.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 1, previousLocation: "deck", previousController: 1, currentLocation: "monsterZone", currentController: 1 },
      { eventName: "controlChanged", eventCode: 1120, eventCardUid: defenseTarget.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: spider.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previousLocation: "monsterZone", previousController: 1, currentLocation: "monsterZone", currentController: 0 },
    ]);

    const restoredControl = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredControl);
    expectRestoredLegalActions(restoredControl, 0);
    expect(findCard(restoredControl.session, defenseTarget.uid)).toMatchObject({ controller: 0, previousController: 1 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: spiderCode, name: "Informer Spider", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceInsect, attribute: attributeEarth, level: 4, attack: 500, defense: 1800 },
    { code: defenseTargetCode, name: "Informer Spider Defense Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1800 },
    { code: attackDecoyCode, name: "Informer Spider Attack Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1700, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Informer Spider");
  expect(script).toContain("e2:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("return c:IsPreviousLocation(LOCATION_ONFIELD) and c:IsReason(REASON_EFFECT)");
  expect(script).toContain("return c:IsDefensePos() and c:IsControlerCanBeChanged()");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_CONTROL,g,#g,0,0)");
  expect(script).toContain("Duel.GetFirstTarget()");
  expect(script).toContain("Duel.GetControl(tc,tp)");
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function moveFaceUpDefense(session: DuelSession, card: DuelCardInstance, controller: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpDefense";
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
