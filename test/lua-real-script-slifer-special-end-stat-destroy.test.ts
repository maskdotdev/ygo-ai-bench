import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const sliferCode = "10000020";
const weakSummonedCode = "100000200";
const strongSummonedCode = "100000201";
const handACode = "100000202";
const handBCode = "100000203";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSliferScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${sliferCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceDivineBeast = 0x800000;
const raceWarrior = 0x1;
const attributeDivine = 0x40;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasSliferScript)("Lua real script Slifer special end stat destroy", () => {
  it("restores special-summoned Slifer hand-count stats, summon-success ATK loss/destroy, and End Phase send", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${sliferCode}.lua`);
    expect(script).toContain("aux.AddNormalSummonProcedure(c,true,false,3,3)");
    expect(script).toContain("aux.AddNormalSetProcedure(c)");
    expect(script).toContain("e3:SetCode(EFFECT_CANNOT_DISABLE_SUMMON)");
    expect(script).toContain("e4:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("Duel.SetChainLimitTillChainEnd(aux.FALSE)");
    expect(script).toContain("e5:SetCategory(CATEGORY_TOGRAVE)");
    expect(script).toContain("e5:SetCode(EVENT_PHASE+PHASE_END)");
    expect(script).toContain("return e:GetHandler():IsSpecialSummoned()");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,e:GetHandler(),1,0,0)");
    expect(script).toContain("Duel.SendtoGrave(c,REASON_EFFECT)");
    expect(script).toContain("e6:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e7:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("return Duel.GetFieldGroupCount(c:GetControler(),LOCATION_HAND,0)*1000");
    expect(script).toContain("e8:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DESTROY)");
    expect(script).toContain("e8:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("e9:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("Duel.SetTargetCard(eg:Filter(s.atkfilter,nil,tp))");
    expect(script).toContain("local g=Duel.GetTargetCards(e):Match(Card.IsFaceup,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(-2000)");
    expect(script).toContain("Duel.BreakEffect()");
    expect(script).toContain("Duel.Destroy(dg,REASON_EFFECT)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 10000020, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sliferCode, handACode, handBCode] }, 1: { main: [weakSummonedCode, strongSummonedCode] } });
    startDuel(session);
    const slifer = requireCard(session, sliferCode);
    const weakSummoned = requireCard(session, weakSummonedCode);
    const strongSummoned = requireCard(session, strongSummonedCode);
    const handA = requireCard(session, handACode);
    const handB = requireCard(session, handBCode);
    moveDuelCard(session.state, slifer.uid, "graveyard", 0);
    moveDuelCard(session.state, handA.uid, "hand", 0);
    moveDuelCard(session.state, handB.uid, "hand", 0);
    moveDuelCard(session.state, weakSummoned.uid, "hand", 1);
    moveDuelCard(session.state, strongSummoned.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sliferCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    specialSummonDuelCard(restoredOpen.session.state, slifer.uid, 0);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === slifer.uid)).toMatchObject({ location: "monsterZone", summonType: "special" });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === slifer.uid), restoredOpen.session.state)).toBe(2000);
    expect(currentDefense(restoredOpen.session.state.cards.find((card) => card.uid === slifer.uid), restoredOpen.session.state)).toBe(2000);

    const restoredSummonedSlifer = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredSummonedSlifer);
    expectRestoredLegalActions(restoredSummonedSlifer, 0);
    expect(restoredSummonedSlifer.session.state.effects.filter((effect) => effect.sourceUid === slifer.uid && [100, 104].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { code: 100, property: 0x20000, range: ["monsterZone"] },
      { code: 104, property: 0x20000, range: ["monsterZone"] },
    ]);

    specialSummonDuelCard(restoredSummonedSlifer.session.state, weakSummoned.uid, 1);
    expect(restoredSummonedSlifer.session.state.pendingTriggers.filter((trigger) => trigger.sourceUid === slifer.uid)).toEqual([
      {
        id: "trigger-4-1",
        effectId: "lua-9-1102",
        eventCardUid: weakSummoned.uid,
        eventCode: 1102,
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventName: "specialSummoned",
        eventPlayer: 1,
        eventPreviousState: { controller: 1, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 1,
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: slifer.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummonedSlifer.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === slifer.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(restoredResolved.session.state.cards.find((card) => card.uid === weakSummoned.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: slifer.uid,
      reasonEffectId: 9,
    });
    expect(restoredResolved.session.state.cards.find((card) => card.uid === strongSummoned.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restoredResolved.session.state.effects.filter((effect) => effect.sourceUid === weakSummoned.uid && effect.code === 100)).toEqual([]);
    expect(restoredResolved.session.state.eventHistory.filter((event) => ["becameTarget", "breakEffect", "destroyed", "sentToGraveyard", "chainSolved"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      eventChainLinkId: event.eventChainLinkId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: weakSummoned.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 9, eventChainLinkId: "chain-4", previousLocation: "hand", currentLocation: "monsterZone" },
      { eventName: "breakEffect", eventCode: 1050, eventCardUid: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: slifer.uid, eventReasonEffectId: 9, relatedEffectId: undefined, eventChainLinkId: undefined, previousLocation: undefined, currentLocation: undefined },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: weakSummoned.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: slifer.uid, eventReasonEffectId: 9, relatedEffectId: undefined, eventChainLinkId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: weakSummoned.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: slifer.uid, eventReasonEffectId: 9, relatedEffectId: undefined, eventChainLinkId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "chainSolved", eventCode: 1022, eventCardUid: undefined, eventReason: undefined, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 9, eventChainLinkId: "chain-4", previousLocation: undefined, currentLocation: undefined },
    ]);

    advanceRestoredToEndPhase(restoredResolved);
    const endTrigger = getLuaRestoreLegalActions(restoredResolved, 0).find((action) => action.type === "activateTrigger" && action.uid === slifer.uid);
    expect(endTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredResolved, 0), null, 2)).toBeDefined();
    expect(endTrigger).not.toHaveProperty("operationInfos");
    applyRestoredActionAndAssert(restoredResolved, endTrigger!);
    passRestoredChain(restoredResolved);
    expect(restoredResolved.session.state.cards.find((card) => card.uid === slifer.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: slifer.uid,
      reasonEffectId: 5,
    });
    expect(restoredResolved.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" && event.eventCardUid === slifer.uid)).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: slifer.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: slifer.uid,
        eventReasonEffectId: 5,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: sliferCode, name: "Slifer the Sky Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDivineBeast, attribute: attributeDivine, level: 10, attack: 0, defense: 0 },
    { code: weakSummonedCode, name: "Slifer Weak Summoned Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2000, defense: 1000 },
    { code: strongSummonedCode, name: "Slifer Strong Summoned Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 3000, defense: 1000 },
    { code: handACode, name: "Slifer Hand A", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: handBCode, name: "Slifer Hand B", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
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

function advanceRestoredToEndPhase(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  for (const phase of ["battle", "main2", "end"] as const) {
    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === phase);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
  }
}
