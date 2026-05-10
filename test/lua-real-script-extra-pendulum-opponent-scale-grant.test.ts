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
const pendulumType = 0x1000001;
const extraPendulumActivationDescription = 58308221 * 16;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Extra Pendulum opponent-scale grant", () => {
  it("restores the helper-created Harmonic path for Extra Deck Pendulum Summons using opponent scales", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const extraPendulumCode = "58308221";
    const opponentLowScaleCode = "58308231";
    const opponentHighScaleCode = "58308232";
    const extraCandidateCode = "58308233";
    const handCandidateCode = "58308234";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === extraPendulumCode),
      { code: opponentLowScaleCode, name: "Extra Pendulum Opponent Low Scale Fixture", kind: "monster", typeFlags: pendulumType, level: 4, leftScale: 1, rightScale: 1 },
      { code: opponentHighScaleCode, name: "Extra Pendulum Opponent High Scale Fixture", kind: "monster", typeFlags: pendulumType, level: 4, leftScale: 8, rightScale: 8 },
      { code: extraCandidateCode, name: "Extra Pendulum Opponent-Scale Extra Candidate Fixture", kind: "monster", typeFlags: pendulumType, level: 4, attack: 1700, defense: 1000 },
      { code: handCandidateCode, name: "Extra Pendulum Opponent-Scale Hand Candidate Fixture", kind: "monster", typeFlags: pendulumType, level: 4, attack: 1600, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 584, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [extraPendulumCode, handCandidateCode], extra: [extraCandidateCode] }, 1: { main: [opponentLowScaleCode, opponentHighScaleCode] } });
    startDuel(session);

    const extraPendulum = session.state.cards.find((card) => card.code === extraPendulumCode);
    const opponentLowScale = session.state.cards.find((card) => card.code === opponentLowScaleCode);
    const opponentHighScale = session.state.cards.find((card) => card.code === opponentHighScaleCode);
    const extraCandidate = session.state.cards.find((card) => card.code === extraCandidateCode);
    const handCandidate = session.state.cards.find((card) => card.code === handCandidateCode);
    expect(extraPendulum).toBeDefined();
    expect(opponentLowScale).toBeDefined();
    expect(opponentHighScale).toBeDefined();
    expect(extraCandidate).toBeDefined();
    expect(handCandidate).toBeDefined();

    moveDuelCard(session.state, extraPendulum!.uid, "hand", 0);
    moveDuelCard(session.state, opponentLowScale!.uid, "spellTrapZone", 1);
    moveDuelCard(session.state, opponentHighScale!.uid, "spellTrapZone", 1);
    moveDuelCard(session.state, extraCandidate!.uid, "extraDeck", 0);
    moveDuelCard(session.state, handCandidate!.uid, "hand", 0);
    session.state.players[0].pendulumSummonAvailable = false;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(extraPendulumCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    assertLegalActions(restored);
    expect(findPendulumSummon(getLuaRestoreLegalActions(restored, 0), extraCandidate!.uid)).toBeUndefined();

    const activation = findExtraPendulumActivation(restored.session, getLuaRestoreLegalActions(restored, 0), extraPendulum!.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, activation!);
    resolveRestoredChain(restored);

    const restoredAfterGrant = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expect(restoredAfterGrant.restoreComplete, restoredAfterGrant.incompleteReasons.join("; ")).toBe(true);
    assertLegalActions(restoredAfterGrant);
    expect(restoredAfterGrant.session.state.players[0].extraPendulumSummonGrants).toEqual([
      expect.objectContaining({ locationMask: 0x40, scaleAlternatives: [expect.objectContaining({ locationMask: 0x40, scalePlayer: 1 })] }),
    ]);
    const pendulumSummon = findPendulumSummon(getLuaRestoreLegalActions(restoredAfterGrant, 0), extraCandidate!.uid);
    expect(pendulumSummon, JSON.stringify(getLuaRestoreLegalActions(restoredAfterGrant, 0), null, 2)).toBeDefined();
    expect(pendulumSummon!.summonUids).toContain(extraCandidate!.uid);
    expect(pendulumSummon!.summonUids).not.toContain(handCandidate!.uid);

    applyLuaRestoreAndAssert(restoredAfterGrant, { ...pendulumSummon!, summonUids: [extraCandidate!.uid] });
    expect(restoredAfterGrant.session.state.cards.find((card) => card.uid === extraCandidate!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      summonType: "pendulum",
      faceUp: true,
    });
    expect(restoredAfterGrant.session.state.cards.find((card) => card.uid === handCandidate!.uid)).toMatchObject({ location: "hand" });
    expect(restoredAfterGrant.session.state.players[0].extraPendulumSummons).toBe(0);
  });
});

function findExtraPendulumActivation(session: DuelSession, actions: DuelAction[], uid: string): Extract<DuelAction, { type: "activateEffect" }> | undefined {
  return actions.find((action): action is Extract<DuelAction, { type: "activateEffect" }> => {
    if (action.type !== "activateEffect" || action.uid !== uid) return false;
    const effect = session.state.effects.find((candidate) => candidate.id === action.effectId && candidate.sourceUid === uid);
    return effect?.description === extraPendulumActivationDescription && ((effect.luaTypeFlags ?? 0) & 0x10) !== 0;
  });
}

function findPendulumSummon(actions: DuelAction[], uid: string): Extract<DuelAction, { type: "pendulumSummon" }> | undefined {
  return actions.find((action): action is Extract<DuelAction, { type: "pendulumSummon" }> => action.type === "pendulumSummon" && action.summonUids.includes(uid));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  assertLegalActions(restored);
  return response;
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

function assertLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(getLuaRestoreLegalActions(restored, waitingFor)).toEqual(getLegalActions(restored.session, waitingFor));
  expect(getLuaRestoreLegalActionGroups(restored, waitingFor)).toEqual(getGroupedDuelLegalActions(restored.session, waitingFor));
  expect(getLuaRestoreLegalActionGroups(restored, waitingFor).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
}
