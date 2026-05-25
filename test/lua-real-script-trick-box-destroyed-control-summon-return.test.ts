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
const trickBoxCode = "93983867";
const destroyedPerformageCode = "939838670";
const revivePerformageCode = "939838671";
const opponentTargetCode = "939838672";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasTrickBoxScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${trickBoxCode}.lua`));
const typeMonster = 0x1;
const typeTrap = 0x4;
const typeEffect = 0x20;
const raceSpellcaster = 0x10;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const attributeEarth = 0x1;
const setPerformage = 0xc6;
const eventToGrave = 1014;
const eventPhaseEnd = 0x1200;
const effectSetControl = 4;
const categoryControl = 0x2000;
const categorySpecialSummon = 0x200;

describe.skipIf(!hasUpstreamScripts || !hasTrickBoxScript)("Lua real script Trick Box destroyed control summon return", () => {
  it("restores destroyed Performage trap activation into temporary control and opponent-field Performage summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 93983867, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [trickBoxCode, destroyedPerformageCode, revivePerformageCode] },
      1: { main: [opponentTargetCode] },
    });
    startDuel(session);
    expectScriptShape(workspace.readScript(`official/c${trickBoxCode}.lua`));

    const trickBox = requireCard(session, trickBoxCode);
    const destroyedPerformage = requireCard(session, destroyedPerformageCode);
    const revivePerformage = requireCard(session, revivePerformageCode);
    const opponentTarget = requireCard(session, opponentTargetCode);
    const setTrap = moveDuelCard(session.state, trickBox.uid, "spellTrapZone", 0);
    setTrap.faceUp = false;
    setTrap.position = "faceDown";
    moveFaceUpAttack(session, destroyedPerformage, 0);
    moveDuelCard(session.state, revivePerformage.uid, "graveyard", 0).faceUp = true;
    moveFaceUpAttack(session, opponentTarget, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(trickBoxCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === trickBox.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: categoryControl | categorySpecialSummon, code: eventToGrave, event: "trigger", id: `lua-1-${eventToGrave}`, property: 0x14010, range: ["spellTrapZone"], triggerEvent: "sentToGraveyard" },
    ]);

    destroyDuelCard(restoredOpen.session.state, destroyedPerformage.uid, 1, duelReason.effect | duelReason.destroy, 1);
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
        eventCardUid: destroyedPerformage.uid,
        eventCode: eventToGrave,
        eventName: "sentToGraveyard",
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        player: 0,
        sourceUid: trickBox.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const activate = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === trickBox.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, activate!);
    resolveRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === opponentTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: trickBox.uid,
      reasonEffectId: 1,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === revivePerformage.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      owner: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: trickBox.uid,
      reasonEffectId: 1,
    });
    expect(restoredTrigger.session.state.effects.some((effect) =>
      effect.sourceUid === revivePerformage.uid
      && effect.event === "continuous"
      && effect.code === eventPhaseEnd
      && effect.range?.includes("monsterZone")
    )).toBe(true);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["controlChanged", "breakEffect", "specialSummoned"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
      previousController: event.eventPreviousState?.controller,
      currentController: event.eventCurrentState?.controller,
    }))).toEqual([
      { eventName: "controlChanged", eventCardUid: opponentTarget.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: trickBox.uid, eventReasonEffectId: 1, previous: "monsterZone", current: "monsterZone", previousController: 1, currentController: 0 },
      { eventName: "breakEffect", eventCardUid: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: trickBox.uid, eventReasonEffectId: 1, previous: undefined, current: undefined, previousController: undefined, currentController: undefined },
      { eventName: "specialSummoned", eventCardUid: revivePerformage.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: trickBox.uid, eventReasonEffectId: 1, previous: "graveyard", current: "monsterZone", previousController: 0, currentController: 1 },
    ]);

    changePhase(restoredTrigger, 0, "battle");
    changePhase(restoredTrigger, 0, "main2");
    changePhase(restoredTrigger, 0, "end");
    expect(restoredTrigger.session.state.effects.some((effect) =>
      effect.sourceUid === revivePerformage.uid
      && effect.event === "continuous"
      && effect.code === effectSetControl
      && effect.value === 0
    )).toBe(true);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: trickBoxCode, name: "Trick Box", kind: "trap", typeFlags: typeTrap, setcodes: [setPerformage] },
    { code: destroyedPerformageCode, name: "Trick Box Destroyed Performage", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeLight, level: 4, attack: 1500, defense: 1000, setcodes: [setPerformage] },
    { code: revivePerformageCode, name: "Trick Box Revived Performage", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeLight, level: 4, attack: 1600, defense: 1000, setcodes: [setPerformage] },
    { code: opponentTargetCode, name: "Trick Box Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1700, defense: 1000 },
  ];
}

function expectScriptShape(script: string): void {
  expect(script).toContain("Trick Box");
  expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL+CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("c:IsSetCard(SET_PERFORMAGE) and c:IsReason(REASON_DESTROY) and c:IsPreviousPosition(POS_FACEUP)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsControlerCanBeChanged,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.GetControl(tc,tp,PHASE_END,1)");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,1-tp,false,false,POS_FACEUP)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_CONTROL)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
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
