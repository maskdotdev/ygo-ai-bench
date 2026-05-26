import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const capapteraCode = "93507434";
const partnerCode = "935074340";
const linkCode = "935074341";
const opponentA = "935074342";
const opponentB = "935074343";
const opponentC = "935074344";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCapapteraScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${capapteraCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceDinosaur = 0x800;
const attributeEarth = 0x1;
const setDinowrestler = 0x11a;
const eventBeMaterial = 1108;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasCapapteraScript)("Lua real script Dinowrestler Capaptera target Link material stat", () => {
  it("restores opponent-count target send and Dinowrestler Link material ATK gain", () => {
    const { workspace, reader, session } = createCapapteraSession();
    const capaptera = requireCard(session, capapteraCode);
    const partner = requireCard(session, partnerCode);
    const link = requireCard(session, linkCode);
    const opponent = requireCard(session, opponentA);
    moveFaceUpAttack(session, capaptera, 0, 0);
    moveFaceUpAttack(session, partner, 0, 1);
    moveFaceUpAttack(session, opponent, 1, 0);
    moveFaceUpAttack(session, requireCard(session, opponentB), 1, 1);
    moveFaceUpAttack(session, requireCard(session, opponentC), 1, 2);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(capapteraCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === capaptera.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: 0x20, code: undefined, event: "ignition", id: "lua-1", property: 0x10, range: ["monsterZone"] },
      { category: 0x200000, code: eventBeMaterial, event: "trigger", id: "lua-2-1108", property: 0x10000, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"] },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const send = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === capaptera.uid && action.effectId === "lua-1");
    expect(send, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, send!);
    resolveRestoredChain(restoredOpen);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === opponent.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: capaptera.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["becameTarget", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      current: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { current: "monsterZone", eventCardUid: opponent.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "deck", relatedEffectId: 1 },
      { current: "graveyard", eventCardUid: opponent.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonCardUid: capaptera.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previous: "monsterZone", relatedEffectId: undefined },
    ]);

    const restoredLinkOpen = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredLinkOpen);
    expectRestoredLegalActions(restoredLinkOpen, 0);
    const linkSummon = getLuaRestoreLegalActions(restoredLinkOpen, 0).find(
      (action) => action.type === "linkSummon" && action.uid === link.uid && sameMembers(action.materialUids, [capaptera.uid, partner.uid]),
    );
    expect(linkSummon, JSON.stringify(getLuaRestoreLegalActions(restoredLinkOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredLinkOpen, linkSummon!);
    expect(restoredLinkOpen.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-7-1",
        effectId: "lua-2-1108",
        eventCardUid: capaptera.uid,
        eventCode: eventBeMaterial,
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
        eventName: "usedAsMaterial",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventReason: duelReason.link,
        eventReasonCardUid: link.uid,
        eventReasonPlayer: 0,
        eventTriggerTiming: "if",
        player: 0,
        sourceUid: capaptera.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredLinkOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const boost = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === capaptera.uid);
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, boost!);
    resolveRestoredChain(restoredTrigger);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === link.uid), restoredTrigger.session.state)).toBe(2800);
    expect(restoredTrigger.session.state.effects.find((effect) => effect.sourceUid === link.uid && effect.code === effectUpdateAttack)).toMatchObject({
      code: effectUpdateAttack,
      value: 1000,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["usedAsMaterial", "becameTarget"].includes(event.eventName)).map((event) => ({
      current: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { current: "monsterZone", eventCardUid: opponent.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonPlayer: 0, previous: "deck", relatedEffectId: 1 },
      { current: "graveyard", eventCardUid: capaptera.uid, eventCode: eventBeMaterial, eventName: "usedAsMaterial", eventReason: duelReason.link, eventReasonCardUid: link.uid, eventReasonPlayer: 0, previous: "monsterZone", relatedEffectId: undefined },
      { current: "graveyard", eventCardUid: partner.uid, eventCode: eventBeMaterial, eventName: "usedAsMaterial", eventReason: duelReason.link, eventReasonCardUid: link.uid, eventReasonPlayer: 0, previous: "monsterZone", relatedEffectId: undefined },
      { current: "monsterZone", eventCardUid: link.uid, eventCode: 1028, eventName: "becameTarget", eventReason: duelReason.summon | duelReason.specialSummon | duelReason.link, eventReasonCardUid: undefined, eventReasonPlayer: 0, previous: "extraDeck", relatedEffectId: 2 },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createCapapteraSession() {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  expectScriptShape(workspace.readScript(`official/c${capapteraCode}.lua`));
  const reader = createCardReader(cards());
  const session = createDuel({ seed: 93507434, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [capapteraCode, partnerCode], extra: [linkCode] },
    1: { main: [opponentA, opponentB, opponentC] },
  });
  startDuel(session);
  return { workspace, reader, session };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Dinowrestler Capaptera");
  expect(script).toContain("e1:SetCategory(CATEGORY_TOGRAVE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("return Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)>Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsAbleToGrave,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.SendtoGrave(tc,REASON_EFFECT)");
  expect(script).toContain("e2:SetCode(EVENT_BE_MATERIAL)");
  expect(script).toContain("return c:IsLocation(LOCATION_GRAVE) and r & REASON_LINK == REASON_LINK");
  expect(script).toContain("rc:IsSetCard(SET_DINOWRESTLER) and rc:IsLinkMonster()");
  expect(script).toContain("Duel.SetTargetCard(e:GetHandler():GetReasonCard())");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(1000)");
}

function cards(): DuelCardData[] {
  return [
    { code: capapteraCode, name: "Dinowrestler Capaptera", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDinosaur, attribute: attributeEarth, level: 3, attack: 1600, defense: 0, setcodes: [setDinowrestler] },
    { code: partnerCode, name: "Dinowrestler Capaptera Partner", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDinosaur, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000, setcodes: [setDinowrestler] },
    { code: linkCode, name: "Dinowrestler Capaptera Link", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceDinosaur, attribute: attributeEarth, level: 2, attack: 1800, defense: 0, linkMarkers: 0x3, linkMaterialMin: 2, linkMaterialMax: 2, setcodes: [setDinowrestler] },
    { code: opponentA, name: "Capaptera Opponent A", kind: "monster", typeFlags: typeMonster, race: raceDinosaur, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
    { code: opponentB, name: "Capaptera Opponent B", kind: "monster", typeFlags: typeMonster, race: raceDinosaur, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
    { code: opponentC, name: "Capaptera Opponent C", kind: "monster", typeFlags: typeMonster, race: raceDinosaur, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function sameMembers(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && expected.every((uid) => actual.includes(uid));
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
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
