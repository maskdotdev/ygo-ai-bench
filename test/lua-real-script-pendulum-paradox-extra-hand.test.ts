import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const paradoxCode = "38203732";
const hasParadoxScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${paradoxCode}.lua`));
const pendulumOneCode = "38203733";
const pendulumTwoCode = "38203734";
const differentScaleCode = "38203735";
const nonPendulumCode = "38203736";
const typeMonster = 0x1;
const typeSpell = 0x2;
const typePendulum = 0x1000000;
const pendulumMonsterType = typeMonster | typePendulum;

describe.skipIf(!hasUpstreamScripts || !hasParadoxScript)("Lua real script Pendulum Paradox extra hand", () => {
  it("restores face-up Extra Deck Pendulum scale matching into paired to-hand confirmation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${paradoxCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_TOHAND)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
    expect(script).toContain("c:IsFaceup() and c:IsType(TYPE_PENDULUM) and c:IsAbleToHand()");
    expect(script).toContain("c:GetLeftScale()==sc and not c:IsCode(cd)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,2,tp,LOCATION_EXTRA)");
    expect(script).toContain("Duel.SendtoHand(Group.FromCards(tc1,tc2),nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,Group.FromCards(tc1,tc2))");

    const cards: DuelCardData[] = [
      { code: paradoxCode, name: "Pendulum Paradox", kind: "spell", typeFlags: typeSpell },
      { code: pendulumOneCode, name: "Pendulum Paradox Scale Pair A", kind: "monster", typeFlags: pendulumMonsterType, level: 4, leftScale: 3, rightScale: 3 },
      { code: pendulumTwoCode, name: "Pendulum Paradox Scale Pair B", kind: "monster", typeFlags: pendulumMonsterType, level: 4, leftScale: 3, rightScale: 3 },
      { code: differentScaleCode, name: "Pendulum Paradox Different Scale", kind: "monster", typeFlags: pendulumMonsterType, level: 4, leftScale: 5, rightScale: 5 },
      { code: nonPendulumCode, name: "Pendulum Paradox Non-Pendulum", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 38203732, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [paradoxCode], extra: [pendulumOneCode, pendulumTwoCode, differentScaleCode, nonPendulumCode] }, 1: { main: [] } });
    startDuel(session);

    const paradox = requireCard(session, paradoxCode);
    const pendulumOne = requireCard(session, pendulumOneCode);
    const pendulumTwo = requireCard(session, pendulumTwoCode);
    const differentScale = requireCard(session, differentScaleCode);
    const nonPendulum = requireCard(session, nonPendulumCode);
    moveDuelCard(session.state, paradox.uid, "hand", 0);
    for (const card of [pendulumOne, pendulumTwo, differentScale, nonPendulum]) {
      const moved = moveDuelCard(session.state, card.uid, "extraDeck", 0);
      moved.faceUp = true;
    }
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(paradoxCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === paradox.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, activate!);

    expect(restoredOpen.session.state.chain).toEqual([]);
    expect(restoredOpen.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === paradox.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === pendulumOne.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonCardUid: paradox.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === pendulumTwo.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonCardUid: paradox.uid,
      reasonEffectId: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === differentScale.uid)).toMatchObject({ location: "extraDeck", controller: 0, faceUp: true });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === nonPendulum.uid)).toMatchObject({ location: "extraDeck", controller: 0, faceUp: true });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: pendulumOne.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: paradox.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: pendulumTwo.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: paradox.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 1 },
      },
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: pendulumOne.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: paradox.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventUids: [pendulumOne.uid, pendulumTwo.uid],
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventPlayer: 1,
        eventUids: [pendulumOne.uid, pendulumTwo.uid],
        eventValue: 2,
        eventCardUid: pendulumOne.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: paradox.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToHandConfirmed",
        eventCode: 1212,
        eventPlayer: 1,
        eventUids: [pendulumOne.uid, pendulumTwo.uid],
        eventValue: 2,
        eventCardUid: pendulumOne.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: paradox.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}
