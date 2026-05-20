import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Peeking Goblin opponent deck-top bottom sort", () => {
  it("restores player target, opponent deck-top confirmation, bottom move, reveal, and opponent top sort", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const peekingCode = "52263685";
    const topACode = "5226368501";
    const topBCode = "5226368502";
    const topCCode = "5226368503";
    const bottomCode = "5226368504";
    const script = workspace.readScript(`c${peekingCode}.lua`);
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)");
    expect(script).toContain("Duel.SetTargetPlayer(tp)");
    expect(script).toContain("Duel.ConfirmDecktop(1-p,3)");
    expect(script).toContain("local sg=g:Select(p,1,1,nil)");
    expect(script).toContain("Duel.MoveToDeckBottom(sg)");
    expect(script).toContain("Duel.ConfirmCards(1-p,sg)");
    expect(script).toContain("Duel.SortDecktop(p,1-p,2)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === peekingCode),
      { code: topACode, name: "Peeking Opponent Top A", kind: "monster" },
      { code: topBCode, name: "Peeking Opponent Top B", kind: "monster" },
      { code: topCCode, name: "Peeking Opponent Top C", kind: "monster" },
      { code: bottomCode, name: "Peeking Opponent Bottom", kind: "monster" },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 52263685, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [peekingCode] }, 1: { main: [topACode, topBCode, topCCode, bottomCode] } });
    startDuel(session);

    const peeking = requireCard(session, peekingCode);
    moveDuelCard(session.state, peeking.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;
    const initialOpponentDeck = deckCodes(session, 1);
    expect(initialOpponentDeck).toHaveLength(4);
    const revealedCodes = initialOpponentDeck.slice(0, 3);
    const selectedBottomCode = revealedCodes[0]!;
    const expectedOpponentDeck = [...initialOpponentDeck.slice(1), selectedBottomCode];

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(peekingCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const setPeeking = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "setSpellTrap" && action.uid === peeking.uid);
    expect(setPeeking, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, setPeeking!);

    const restoredSet = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredSet);
    expectRestoredLegalActions(restoredSet, 0);
    const activation = getLuaRestoreLegalActions(restoredSet, 0).find((action) => action.type === "activateEffect" && action.uid === peeking.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredSet, 0), null, 2)).toBeDefined();
    expect(("operationInfos" in activation! ? activation.operationInfos : []) ?? []).toEqual([]);
    applyRestoredActionAndAssert(restoredSet, activation!);

    expect(deckCodes(restoredSet.session, 1)).toEqual(expectedOpponentDeck);
    const selectedBottom = requireCard(restoredSet.session, selectedBottomCode);
    const revealedCards = revealedCodes.map((code) => requireCard(restoredSet.session, code));
    expect(restoredSet.session.state.cards.find((card) => card.uid === peeking.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredSet.session.state.eventHistory.filter((event) => event.eventName === "confirmed").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventUids: event.eventUids,
    }))).toEqual([
      {
        eventCardUid: selectedBottom.uid,
        eventPlayer: 1,
        eventValue: 3,
        eventUids: revealedCards.map((card) => card.uid),
      },
      {
        eventCardUid: selectedBottom.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [selectedBottom.uid],
      },
    ]);

    const restoredSorted = restoreDuelWithLuaScripts(serializeDuel(restoredSet.session), workspace, reader);
    expectCleanRestore(restoredSorted);
    expectRestoredLegalActions(restoredSorted, 0);
    expect(deckCodes(restoredSorted.session, 1)).toEqual(expectedOpponentDeck);
    expect(restoredSorted.host.messages).not.toContain("peeking goblin restore failed");
  });
});

function deckCodes(session: DuelSession, player: PlayerId): string[] {
  return session.state.cards
    .filter((card) => card.controller === player && card.location === "deck")
    .sort((a, b) => a.sequence - b.sequence)
    .map((card) => card.code);
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(result.legalActions).toEqual(getLegalActions(restored.session, waitingFor));
  expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, waitingFor));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
