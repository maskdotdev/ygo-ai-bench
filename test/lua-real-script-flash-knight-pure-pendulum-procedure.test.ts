import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import {
  createDuel,
  getGroupedDuelLegalActions,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
import type { DuelAction, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const effectTypeActivate = 0x10;
const effectSummonProcedureGroup = 320;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script pure Pendulum AddProcedure", () => {
  it("restores vanilla Pendulum scale activations and Pendulum Summon procedure actions", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const flashKnightCode = "17390179";
    const mandragonCode = "19474136";
    const fireOpalHeadCode = "28363749";
    const cards = workspace.readDatabaseCards("cards.cdb").filter((card) => [flashKnightCode, mandragonCode, fireOpalHeadCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1739, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [flashKnightCode, mandragonCode, fireOpalHeadCode] }, 1: { main: [] } });
    startDuel(session);

    const flashKnight = session.state.cards.find((card) => card.code === flashKnightCode);
    const mandragon = session.state.cards.find((card) => card.code === mandragonCode);
    const fireOpalHead = session.state.cards.find((card) => card.code === fireOpalHeadCode);
    expect(flashKnight).toBeDefined();
    expect(mandragon).toBeDefined();
    expect(fireOpalHead).toBeDefined();
    moveDuelCard(session.state, flashKnight!.uid, "hand", 0);
    moveDuelCard(session.state, mandragon!.uid, "hand", 0);
    moveDuelCard(session.state, fireOpalHead!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(flashKnightCode), workspace).ok).toBe(true);
    expect(host.loadCardScript(Number(mandragonCode), workspace).ok).toBe(true);
    expect(host.loadCardScript(Number(fireOpalHeadCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const restoredLowScaleWindow = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredLowScaleWindow.restoreComplete, restoredLowScaleWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredLowScaleWindow.missingRegistryKeys).toEqual([]);
    expect(restoredLowScaleWindow.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActions(restoredLowScaleWindow, 0)).toEqual(getDuelLegalActions(restoredLowScaleWindow.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredLowScaleWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredLowScaleWindow.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredLowScaleWindow, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredLowScaleWindow, 0));
    expect(pendulumProcedureEffects(restoredLowScaleWindow.session, mandragon!.uid)).toEqual([
      expect.objectContaining({ code: effectSummonProcedureGroup, description: 1163, sourceUid: mandragon!.uid }),
    ]);

    const lowScaleActivation = findPendulumScaleActivation(restoredLowScaleWindow.session, getLuaRestoreLegalActions(restoredLowScaleWindow, 0), mandragon!.uid);
    expect(lowScaleActivation, JSON.stringify(getLuaRestoreLegalActions(restoredLowScaleWindow, 0), null, 2)).toBeDefined();
    const lowScaleActivated = applyLuaRestoreResponse(restoredLowScaleWindow, lowScaleActivation!);
    expect(lowScaleActivated.ok, lowScaleActivated.error).toBe(true);
    expect(lowScaleActivated.legalActionGroups.flatMap((group) => group.actions)).toEqual(lowScaleActivated.legalActions);
    resolveRestoredChain(restoredLowScaleWindow);
    expect(restoredLowScaleWindow.session.state.cards.find((card) => card.uid === mandragon!.uid)).toMatchObject({ location: "spellTrapZone", sequence: 0 });

    const restoredHighScaleWindow = restoreDuelWithLuaScripts(serializeDuel(restoredLowScaleWindow.session), workspace, reader);
    expect(restoredHighScaleWindow.restoreComplete, restoredHighScaleWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredHighScaleWindow.missingRegistryKeys).toEqual([]);
    expect(restoredHighScaleWindow.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActions(restoredHighScaleWindow, 0)).toEqual(getDuelLegalActions(restoredHighScaleWindow.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredHighScaleWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredHighScaleWindow.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredHighScaleWindow, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredHighScaleWindow, 0));

    const highScaleActivation = findPendulumScaleActivation(restoredHighScaleWindow.session, getLuaRestoreLegalActions(restoredHighScaleWindow, 0), flashKnight!.uid);
    expect(highScaleActivation, JSON.stringify(getLuaRestoreLegalActions(restoredHighScaleWindow, 0), null, 2)).toBeDefined();
    const highScaleActivated = applyLuaRestoreResponse(restoredHighScaleWindow, highScaleActivation!);
    expect(highScaleActivated.ok, highScaleActivated.error).toBe(true);
    expect(highScaleActivated.legalActionGroups.flatMap((group) => group.actions)).toEqual(highScaleActivated.legalActions);
    resolveRestoredChain(restoredHighScaleWindow);
    expect(restoredHighScaleWindow.session.state.cards.find((card) => card.uid === flashKnight!.uid)).toMatchObject({ location: "spellTrapZone", sequence: 1 });

    const restoredPendulumWindow = restoreDuelWithLuaScripts(serializeDuel(restoredHighScaleWindow.session), workspace, reader);
    expect(restoredPendulumWindow.restoreComplete, restoredPendulumWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredPendulumWindow.missingRegistryKeys).toEqual([]);
    expect(restoredPendulumWindow.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActions(restoredPendulumWindow, 0)).toEqual(getDuelLegalActions(restoredPendulumWindow.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredPendulumWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredPendulumWindow.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredPendulumWindow, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredPendulumWindow, 0));

    const pendulumSummon = getLuaRestoreLegalActions(restoredPendulumWindow, 0).find(
      (action): action is Extract<DuelAction, { type: "pendulumSummon" }> => action.type === "pendulumSummon" && action.summonUids.includes(fireOpalHead!.uid),
    );
    expect(pendulumSummon, JSON.stringify(getLuaRestoreLegalActions(restoredPendulumWindow, 0), null, 2)).toBeDefined();
    expect(pendulumSummon).toMatchObject({ player: 0, maxSummons: 5, label: "Pendulum Summon Fire Opal Head" });
    const summoned = applyLuaRestoreResponse(restoredPendulumWindow, { ...pendulumSummon!, summonUids: [fireOpalHead!.uid] });
    expect(summoned.ok, summoned.error).toBe(true);
    expect(summoned.legalActionGroups.flatMap((group) => group.actions)).toEqual(summoned.legalActions);
    expect(restoredPendulumWindow.session.state.cards.find((card) => card.uid === fireOpalHead!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "pendulum",
    });
    expect(restoredPendulumWindow.session.state.players[0].pendulumSummonAvailable).toBe(false);
  });
});

function findPendulumScaleActivation(session: DuelSession, actions: DuelAction[], uid: string): Extract<DuelAction, { type: "activateEffect" }> | undefined {
  return actions.find((action): action is Extract<DuelAction, { type: "activateEffect" }> => {
    if (action.type !== "activateEffect" || action.uid !== uid) return false;
    const effect = session.state.effects.find((candidate) => candidate.id === action.effectId && candidate.sourceUid === uid);
    return effect?.description === 1160 && ((effect.luaTypeFlags ?? 0) & effectTypeActivate) !== 0;
  });
}

function pendulumProcedureEffects(session: DuelSession, uid: string) {
  return session.state.effects.filter((effect) => effect.sourceUid === uid && effect.code === effectSummonProcedureGroup);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    const result = applyLuaRestoreResponse(restored, pass!);
    expect(result.ok, result.error).toBe(true);
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}
