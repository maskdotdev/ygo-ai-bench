import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Fruits of Kozaky's Studies deck-top sort", () => {
  it("restores GetFieldGroupCount-gated SortDecktop operation metadata and deck order", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const fruitsCode = "49998907";
    const topACode = "4999890701";
    const topBCode = "4999890702";
    const topCCode = "4999890703";
    const bottomCode = "4999890704";
    const script = workspace.readScript(`c${fruitsCode}.lua`);
    expect(script).toContain("Duel.GetFieldGroupCount(tp,LOCATION_DECK,0)>2");
    expect(script).toContain("Duel.SortDecktop(tp,tp,3)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === fruitsCode),
      { code: topACode, name: "Fruits Top A", kind: "monster" },
      { code: topBCode, name: "Fruits Top B", kind: "monster" },
      { code: topCCode, name: "Fruits Top C", kind: "monster" },
      { code: bottomCode, name: "Fruits Bottom", kind: "monster" },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 4999, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [fruitsCode, topACode, topBCode, topCCode, bottomCode] }, 1: { main: [] } });
    startDuel(session);

    const fruits = requireCard(session, fruitsCode);
    moveDuelCard(session.state, fruits.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;
    const initialDeckCodes = deckCodes(session);
    expect(initialDeckCodes).toHaveLength(4);

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(fruitsCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const setFruits = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "setSpellTrap" && action.uid === fruits.uid);
    expect(setFruits, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, setFruits!);

    const restoredSet = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredSet);
    expectRestoredLegalActions(restoredSet, 0);
    const activation = getLuaRestoreLegalActions(restoredSet, 0).find((action) => action.type === "activateEffect" && action.uid === fruits.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredSet, 0), null, 2)).toBeDefined();
    expect(("operationInfos" in activation! ? activation.operationInfos : []) ?? []).toEqual([]);
    applyRestoredActionAndAssert(restoredSet, activation!);

    expect(restoredSet.session.state.chain).toEqual([]);
    expect(deckCodes(restoredSet.session)).toEqual(initialDeckCodes);
    expect(restoredSet.session.state.cards.find((card) => card.uid === fruits.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredSet.session.state.eventHistory.some((event) => event.eventName === "cardsDrawn" || event.eventName === "sentToDeck")).toBe(false);

    const restoredSorted = restoreDuelWithLuaScripts(serializeDuel(restoredSet.session), workspace, reader);
    expectCleanRestore(restoredSorted);
    expectRestoredLegalActions(restoredSorted, 0);
    expect(deckCodes(restoredSorted.session)).toEqual(initialDeckCodes);
    expect(restoredSorted.host.messages).not.toContain("fruits sort restore failed");
  });

  it("does not expose the activation when fewer than three cards remain in Deck", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const fruitsCode = "49998907";
    const deckACode = "4999890711";
    const deckBCode = "4999890712";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === fruitsCode),
      { code: deckACode, name: "Fruits Short Deck A", kind: "monster" },
      { code: deckBCode, name: "Fruits Short Deck B", kind: "monster" },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 5000, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [fruitsCode, deckACode, deckBCode] }, 1: { main: [] } });
    startDuel(session);

    const fruits = requireCard(session, fruitsCode);
    moveDuelCard(session.state, fruits.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(fruitsCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    expect(getLuaRestoreLegalActions(restored, 0).some((action) => action.type === "activateEffect" && action.uid === fruits.uid)).toBe(false);
  });
});

function deckCodes(session: DuelSession): string[] {
  return session.state.cards
    .filter((card) => card.controller === 0 && card.location === "deck")
    .sort((a, b) => a.sequence - b.sequence)
    .map((card) => card.code);
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLegalActions(restored.session, waitingFor));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
