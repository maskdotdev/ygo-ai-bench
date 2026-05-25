import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const guideCode = "52702748";
const graveTargetCode = "527027480";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasGuideScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${guideCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const categoryRemove = 0x4;
const categoryControl = 0x2000;
const effectFlagCardTarget = 0x10;
const eventSummonSuccess = 1100;
const eventPhaseEnd = 0x1200;

describe.skipIf(!hasUpstreamScripts || !hasGuideScript)("Lua real script D.D. Guide summon control end banish", () => {
  it("restores summon-triggered self-control transfer and End Phase opponent-selected banish", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${guideCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 52702748, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [guideCode, graveTargetCode] }, 1: { main: [] } });
    startDuel(session);

    const guide = requireCard(session, guideCode);
    const graveTarget = requireCard(session, graveTargetCode);
    moveDuelCard(session.state, guide.uid, "hand", 0);
    moveDuelCard(session.state, graveTarget.uid, "graveyard", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(guideCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === guide.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: categoryControl, code: eventSummonSuccess, countLimit: undefined, event: "trigger", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "normalSummoned" },
      { category: categoryRemove, code: eventPhaseEnd, countLimit: 1, event: "trigger", property: effectFlagCardTarget, range: ["monsterZone"], triggerEvent: "phaseEnd" },
    ]);
    expectRestoredLegalActions(restoredOpen, 0);
    const summon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "normalSummon" && action.uid === guide.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, summon!);

    const restoredSummonTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredSummonTrigger);
    expectRestoredLegalActions(restoredSummonTrigger, 0);
    const controlTrigger = getLuaRestoreLegalActions(restoredSummonTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === guide.uid && action.effectId === "lua-1-1100"
    );
    expect(controlTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredSummonTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonTrigger, controlTrigger!);

    const restoredControlChain = restoreDuelWithLuaScripts(serializeDuel(restoredSummonTrigger.session), workspace, reader);
    expectCleanRestore(restoredControlChain);
    expectRestoredLegalActions(restoredControlChain, 1);
    resolveRestoredChain(restoredControlChain);
    expect(restoredControlChain.session.state.cards.find((card) => card.uid === guide.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      previousController: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: guide.uid,
      reasonEffectId: 1,
    });

    const restoredEndOpen = restoreDuelWithLuaScripts(serializeDuel(restoredControlChain.session), workspace, reader);
    expectCleanRestore(restoredEndOpen);
    expectRestoredLegalActions(restoredEndOpen, 0);
    changePhase(restoredEndOpen, 0, "battle");
    changePhase(restoredEndOpen, 0, "main2");
    changePhase(restoredEndOpen, 0, "end");
    expect(restoredEndOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-2-4608", eventCode: eventPhaseEnd, eventName: "phaseEnd", player: 1, sourceUid: guide.uid, triggerBucket: "opponentMandatory" },
    ]);
    const banishTrigger = getLuaRestoreLegalActions(restoredEndOpen, 1).find((action) =>
      action.type === "activateTrigger" && action.uid === guide.uid && action.effectId === "lua-2-4608"
    );
    expect(banishTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredEndOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEndOpen, banishTrigger!);

    const restoredBanishChain = restoreDuelWithLuaScripts(serializeDuel(restoredEndOpen.session), workspace, reader);
    expectCleanRestore(restoredBanishChain);
    expectRestoredLegalActions(restoredBanishChain, 0);
    resolveRestoredChain(restoredBanishChain);

    expect(restoredBanishChain.session.state.cards.find((card) => card.uid === graveTarget.uid)).toMatchObject({
      location: "banished",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 1,
      reasonCardUid: guide.uid,
      reasonEffectId: 2,
    });
    expect(restoredBanishChain.session.state.cards.find((card) => card.uid === guide.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
    });
    expect(restoredBanishChain.session.state.eventHistory.filter((event) => ["normalSummoned", "controlChanged", "phaseEnd", "becameTarget", "banished"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "normalSummoned", eventCode: eventSummonSuccess, eventCardUid: guide.uid, eventReason: duelReason.summon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previousLocation: "hand", currentLocation: "monsterZone" },
      { eventName: "controlChanged", eventCode: 1120, eventCardUid: guide.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: guide.uid, eventReasonEffectId: 1, previousLocation: "monsterZone", currentLocation: "monsterZone" },
      { eventName: "phaseEnd", eventCode: eventPhaseEnd, eventCardUid: undefined, eventReason: undefined, eventReasonPlayer: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previousLocation: undefined, currentLocation: undefined },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: graveTarget.uid, eventReason: 0, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previousLocation: "deck", currentLocation: "graveyard" },
      { eventName: "banished", eventCode: 1011, eventCardUid: graveTarget.uid, eventReason: duelReason.effect, eventReasonPlayer: 1, eventReasonCardUid: guide.uid, eventReasonEffectId: 2, previousLocation: "graveyard", currentLocation: "banished" },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--D.D. Guide");
  expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("Duel.GetControl(c,1-tp)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e2:SetCategory(CATEGORY_REMOVE)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e2:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("aux.SpElimFilter(c)");
  expect(script).toContain("Duel.SelectTarget(1-tp,s.rmfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,1,nil,1-tp)");
  expect(script).toContain("Duel.Remove(tc,POS_FACEUP,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: guideCode, name: "D.D. Guide", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1400, defense: 1000 },
    { code: graveTargetCode, name: "D.D. Guide Grave Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1500, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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

function changePhase(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, phase: DuelSession["state"]["phase"]): void {
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "changePhase" && candidate.phase === phase);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, action!);
}
