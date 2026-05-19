import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelResponse } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Finite Cards hand limit", () => {
  it("restores EFFECT_HAND_LIMIT and discards excess hand cards at End Phase", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const finiteCardsCode = "48310593";
    const fillerCodes = ["48310594", "48310595", "48310596", "48310597", "48310598", "48310599"];
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === finiteCardsCode),
      ...fillerCodes.map((code, index) => ({
        code,
        name: `Finite Cards Filler ${index + 1}`,
        kind: "monster" as const,
        typeFlags: typeMonster,
        level: 4,
        attack: 1000,
        defense: 1000,
      })),
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 4831, startingHandSize: 6, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [finiteCardsCode, ...fillerCodes] },
      1: { main: [...fillerCodes] },
    });
    startDuel(session);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const finiteCards = session.state.cards.find((card) => card.code === finiteCardsCode);
    expect(finiteCards).toBeDefined();
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(finiteCardsCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.sourceUid === finiteCards!.uid && effect.code === 270)).toMatchObject({
      code: 270,
      range: ["spellTrapZone"],
      targetRange: [1, 1],
      value: 3,
    });

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredActivation.restoreComplete, restoredActivation.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredActivation, 0);
    expect(restoredActivation.missingRegistryKeys).toEqual([]);
    expect(restoredActivation.missingChainLimitRegistryKeys).toEqual([]);
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find(
      (action) => action.type === "activateEffect" && action.uid === finiteCards!.uid,
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activation!);
    resolveRestoredChain(restoredActivation);
    expect(restoredActivation.session.state.cards.find((card) => card.uid === finiteCards!.uid)).toMatchObject({
      location: "spellTrapZone",
      faceUp: true,
    });
    expect(restoredActivation.session.state.cards.filter((card) => card.controller === 0 && card.location === "hand")).toHaveLength(5);

    const restoredEndTurn = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), workspace, reader);
    expect(restoredEndTurn.restoreComplete, restoredEndTurn.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredEndTurn, 0);
    expect(restoredEndTurn.missingRegistryKeys).toEqual([]);
    expect(restoredEndTurn.missingChainLimitRegistryKeys).toEqual([]);
    const endTurn = getLuaRestoreLegalActions(restoredEndTurn, 0).find((action) => action.type === "endTurn");
    expect(endTurn, JSON.stringify(getLuaRestoreLegalActions(restoredEndTurn, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEndTurn, endTurn!);

    expect(restoredEndTurn.session.state.turnPlayer).toBe(1);
    expect(restoredEndTurn.session.state.cards.filter((card) => card.controller === 0 && card.location === "hand")).toHaveLength(3);
    expect(restoredEndTurn.session.state.cards.filter((card) => card.controller === 0 && card.location === "graveyard")).toHaveLength(2);
  });
});

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
