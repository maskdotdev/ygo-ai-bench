import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter, getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const darkStringsCode = "69170557";
const materialCode = "691705570";
const lowTargetCode = "691705571";
const highTargetCode = "691705572";
const drawCode = "691705573";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasDarkStringsScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${darkStringsCode}.lua`));
const stringCounter = 0x1024;
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceMachine = 0x20;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasDarkStringsScript)("Lua real script Dark Strings counter destroy draw damage", () => {
  it("restores detach counter placement and Special Summon destroy-draw-damage trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${darkStringsCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const counterSession = openSession(reader, workspace, 69170557);
    const counterDarkStrings = requireCard(counterSession, darkStringsCode);
    const counterMaterial = requireCard(counterSession, materialCode);
    const counterTarget = requireCard(counterSession, highTargetCode);
    moveFaceUpAttack(counterSession, counterDarkStrings, 0, 0);
    moveFaceUpAttack(counterSession, counterTarget, 1, 0);
    attachMaterial(counterSession, counterDarkStrings, counterMaterial);
    registerDarkStrings(counterSession, workspace);

    const restoredCounter = restoreDuelWithLuaScripts(serializeDuel(counterSession), workspace, reader);
    expectCleanRestore(restoredCounter);
    expectRestoredLegalActions(restoredCounter, 0);
    const ignition = getLuaRestoreLegalActions(restoredCounter, 0).find((action) => action.type === "activateEffect" && action.uid === counterDarkStrings.uid);
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredCounter, 0), null, 2)).toBeDefined();
    applyRestored(restoredCounter, ignition!);
    passRestoredChain(restoredCounter);
    expect(restoredCounter.session.state.cards.find((card) => card.uid === counterDarkStrings.uid)?.overlayUids).toEqual([]);
    expect(getDuelCardCounter(restoredCounter.session.state.cards.find((card) => card.uid === counterTarget.uid), stringCounter)).toBe(1);
    expect(restoredCounter.session.state.eventHistory.filter((event) => ["detachedMaterial", "counterAdded"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "detachedMaterial", eventCardUid: counterMaterial.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: counterDarkStrings.uid, eventReasonEffectId: 3, previous: "overlay", current: "graveyard" },
      { eventName: "counterAdded", eventCardUid: counterTarget.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: counterDarkStrings.uid, eventReasonEffectId: 3, previous: "deck", current: "monsterZone" },
    ]);

    const triggerSession = openSession(reader, workspace, 69170558);
    const triggerDarkStrings = requireCard(triggerSession, darkStringsCode);
    const lowTarget = requireCard(triggerSession, lowTargetCode);
    const highTarget = requireCard(triggerSession, highTargetCode);
    moveFaceUpAttack(triggerSession, lowTarget, 1, 0);
    moveFaceUpAttack(triggerSession, highTarget, 1, 1);
    expect(addDuelCardCounter(lowTarget, stringCounter, 1)).toBe(true);
    expect(addDuelCardCounter(highTarget, stringCounter, 1)).toBe(true);
    registerDarkStrings(triggerSession, workspace);
    specialSummonDuelCard(triggerSession.state, triggerDarkStrings.uid, 0, 0, {}, undefined, true, true, undefined, 99);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(triggerSession), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === triggerDarkStrings.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestored(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === lowTarget.uid)).toMatchObject({ location: "graveyard", reason: duelReason.destroy | duelReason.effect });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === highTarget.uid)).toMatchObject({ location: "graveyard", reason: duelReason.destroy | duelReason.effect });
    expect(restoredTrigger.session.state.cards.find((card) => card.code === drawCode)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredTrigger.session.state.players[1].lifePoints).toBe(5200);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["specialSummoned", "destroyed", "cardsDrawn", "breakEffect", "damageDealt"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "specialSummoned", eventCardUid: triggerDarkStrings.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "destroyed", eventCardUid: lowTarget.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.destroy | duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: triggerDarkStrings.uid, eventReasonEffectId: 2 },
      { eventName: "destroyed", eventCardUid: highTarget.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.destroy | duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: triggerDarkStrings.uid, eventReasonEffectId: 2 },
      { eventName: "destroyed", eventCardUid: lowTarget.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.destroy | duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: triggerDarkStrings.uid, eventReasonEffectId: 2 },
      { eventName: "cardsDrawn", eventCardUid: expect.stringContaining(drawCode), eventPlayer: 0, eventValue: 1, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: triggerDarkStrings.uid, eventReasonEffectId: 2 },
      { eventName: "breakEffect", eventCardUid: undefined, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: triggerDarkStrings.uid, eventReasonEffectId: 2 },
      { eventName: "damageDealt", eventCardUid: undefined, eventPlayer: 1, eventValue: 2800, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: triggerDarkStrings.uid, eventReasonEffectId: 2 },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Number C40: Gimmick Puppet of Dark Strings");
  expect(script).toContain("Xyz.AddProcedure(c,nil,9,3)");
  expect(script).toContain("e1:SetCategory(CATEGORY_DESTROY+CATEGORY_DRAW+CATEGORY_DAMAGE)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,#g,0,0)");
  expect(script).toContain("Duel.GetOperatedGroup():Filter(Card.IsLocation,nil,LOCATION_GRAVE)");
  expect(script).toContain("Duel.Draw(tp,1,REASON_EFFECT)");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("og:GetMaxGroup(Card.GetBaseAttack)");
  expect(script).toContain("Duel.Damage(1-tp,matk,REASON_EFFECT)");
  expect(script).toContain("e2:SetCost(Cost.DetachFromSelf(1))");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("tc:AddCounter(0x1024,1)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === darkStringsCode),
    { code: materialCode, name: "Dark Strings Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeDark, level: 9, attack: 900, defense: 900 },
    { code: lowTargetCode, name: "Dark Strings Low Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeDark, level: 4, attack: 1600, defense: 1000 },
    { code: highTargetCode, name: "Dark Strings High Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeDark, level: 4, attack: 2800, defense: 1000 },
    { code: drawCode, name: "Dark Strings Draw Card", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeDark, level: 4, attack: 100, defense: 100 },
  ];
}

function openSession(reader: ReturnType<typeof createCardReader>, workspace: ReturnType<typeof createUpstreamNodeWorkspace>, seed: number): DuelSession {
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [materialCode, drawCode], extra: [darkStringsCode] }, 1: { main: [lowTargetCode, highTargetCode] } });
  startDuel(session);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return session;
}

function registerDarkStrings(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(darkStringsCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function attachMaterial(session: DuelSession, holder: DuelCardInstance, material: DuelCardInstance): void {
  moveDuelCard(session.state, material.uid, "overlay", holder.controller, duelReason.material | duelReason.xyz, holder.controller);
  holder.overlayUids.push(material.uid);
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

function applyRestored(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
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
    applyRestored(restored, pass!);
  }
}
