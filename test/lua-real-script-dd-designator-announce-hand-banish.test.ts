import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const designatorCode = "33423043";
const declaredCode = "75505728";
const otherHandCode = "1002";
const fallbackHandCode = "1003";
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script D.D. Designator announce hand banish", () => {
  it("restores announced opponent hand confirmation into selected face-up banish", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`c${designatorCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_REMOVE)");
    expect(script).toContain("Duel.AnnounceCard(tp,table.unpack(s.announce_filter))");
    expect(script).toContain("Duel.ConfirmCards(tp,hg)");
    expect(script).toContain("Duel.GetMatchingGroup(Card.IsCode,tp,0,LOCATION_HAND,nil,ac)");
    expect(script).toContain("Duel.Remove(sg,POS_FACEUP,REASON_EFFECT)");
    expect(script).toContain("Duel.ShuffleHand(1-tp)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === designatorCode),
      { code: declaredCode, name: "Designated Opponent Hand Monster", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
      { code: otherHandCode, name: "Other Opponent Hand Monster", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1200, defense: 1000 },
      { code: fallbackHandCode, name: "Fallback Self Hand Monster", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1400, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 33423043, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [designatorCode, fallbackHandCode] }, 1: { main: [declaredCode, otherHandCode] } });
    startDuel(session);

    const designator = requireCard(session, designatorCode);
    const declared = requireCard(session, declaredCode);
    const otherHand = requireCard(session, otherHandCode);
    const fallbackHand = requireCard(session, fallbackHandCode);
    moveDuelCard(session.state, designator.uid, "spellTrapZone", 0);
    designator.position = "faceDown";
    designator.faceUp = false;
    moveDuelCard(session.state, declared.uid, "hand", 1);
    moveDuelCard(session.state, otherHand.uid, "hand", 1);
    moveDuelCard(session.state, fallbackHand.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(designatorCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const activation = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === designator.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, activation!);
    expect(restored.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);

    expect(restored.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "AnnounceCard", player: 0, options: [Number(declaredCode)], descriptions: [Number(declaredCode)], returned: Number(declaredCode) },
    ]);
    expect(restored.session.state.cards.find((card) => card.uid === declared.uid)).toMatchObject({
      location: "banished",
      controller: 1,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: designator.uid,
      reasonEffectId: 1,
    });
    expect(restored.session.state.cards.find((card) => card.uid === otherHand.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restored.session.state.cards.find((card) => card.uid === fallbackHand.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.eventHistory.filter((event) => ["confirmed", "banished", "sentToGraveyard"].includes(event.eventName))).toEqual([
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: declared.uid,
        eventPlayer: 0,
        eventValue: 2,
        eventUids: [declared.uid, otherHand.uid],
        eventReason: 0,
        eventReasonPlayer: 1,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 1, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: declared.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: designator.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 1, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "banished", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: designator.uid,
        eventReason: duelReason.rule,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
  });
});

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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}
