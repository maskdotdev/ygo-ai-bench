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
const setSolfachord = 0x164;
const solfachordHappinessDescription = 93481594 * 16;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Solfachord Happiness filtered Pendulum grant", () => {
  it("restores a setcode-filtered additional Pendulum Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const happinessCode = "93481594";
    const lowScaleCode = "93481595";
    const highScaleCode = "93481596";
    const allowedCandidateCode = "93481597";
    const rejectedCandidateCode = "93481598";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === happinessCode),
      { code: lowScaleCode, name: "Solfachord Happiness Low Scale Fixture", kind: "monster", typeFlags: pendulumType, level: 4, leftScale: 1, rightScale: 1 },
      { code: highScaleCode, name: "Solfachord Happiness High Scale Fixture", kind: "monster", typeFlags: pendulumType, level: 4, leftScale: 8, rightScale: 8 },
      {
        code: allowedCandidateCode,
        name: "Solfachord Happiness Allowed Candidate Fixture",
        kind: "monster",
        typeFlags: pendulumType,
        level: 4,
        attack: 1700,
        defense: 1000,
        setcodes: [setSolfachord],
      },
      { code: rejectedCandidateCode, name: "Solfachord Happiness Rejected Candidate Fixture", kind: "monster", typeFlags: pendulumType, level: 4, attack: 1600, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 934, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [happinessCode, lowScaleCode, highScaleCode], extra: [allowedCandidateCode, rejectedCandidateCode] }, 1: { main: [] } });
    startDuel(session);

    const happiness = session.state.cards.find((card) => card.code === happinessCode);
    const lowScale = session.state.cards.find((card) => card.code === lowScaleCode);
    const highScale = session.state.cards.find((card) => card.code === highScaleCode);
    const allowedCandidate = session.state.cards.find((card) => card.code === allowedCandidateCode);
    const rejectedCandidate = session.state.cards.find((card) => card.code === rejectedCandidateCode);
    expect(happiness).toBeDefined();
    expect(lowScale).toBeDefined();
    expect(highScale).toBeDefined();
    expect(allowedCandidate).toBeDefined();
    expect(rejectedCandidate).toBeDefined();

    moveDuelCard(session.state, lowScale!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, highScale!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, happiness!.uid, "hand", 0);
    moveDuelCard(session.state, allowedCandidate!.uid, "extraDeck", 0);
    moveDuelCard(session.state, rejectedCandidate!.uid, "extraDeck", 0);
    session.state.players[0].pendulumSummonAvailable = false;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(happinessCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    assertLegalActions(restored);
    expect(findPendulumSummon(getLuaRestoreLegalActions(restored, 0), allowedCandidate!.uid)).toBeUndefined();
    expect(findPendulumSummon(getLuaRestoreLegalActions(restored, 0), rejectedCandidate!.uid)).toBeUndefined();

    const activation = findSolfachordHappinessActivation(restored.session, getLuaRestoreLegalActions(restored, 0), happiness!.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, activation!);
    resolveRestoredChain(restored);

    const restoredAfterGrant = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expect(restoredAfterGrant.restoreComplete, restoredAfterGrant.incompleteReasons.join("; ")).toBe(true);
    assertLegalActions(restoredAfterGrant);
    expect(restoredAfterGrant.session.state.players[0].extraPendulumSummonGrants).toEqual([expect.objectContaining({ setcode: setSolfachord })]);
    const pendulumSummon = findPendulumSummon(getLuaRestoreLegalActions(restoredAfterGrant, 0), allowedCandidate!.uid);
    expect(pendulumSummon, JSON.stringify(getLuaRestoreLegalActions(restoredAfterGrant, 0), null, 2)).toBeDefined();
    expect(pendulumSummon!.summonUids).toContain(allowedCandidate!.uid);
    expect(pendulumSummon!.summonUids).not.toContain(rejectedCandidate!.uid);

    applyLuaRestoreAndAssert(restoredAfterGrant, { ...pendulumSummon!, summonUids: [allowedCandidate!.uid] });
    expect(restoredAfterGrant.session.state.cards.find((card) => card.uid === allowedCandidate!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      summonType: "pendulum",
      faceUp: true,
    });
    expect(restoredAfterGrant.session.state.cards.find((card) => card.uid === rejectedCandidate!.uid)).toMatchObject({ location: "extraDeck", faceUp: true });
    expect(restoredAfterGrant.session.state.players[0].extraPendulumSummons).toBe(0);
  });
});

function findSolfachordHappinessActivation(session: DuelSession, actions: DuelAction[], uid: string): Extract<DuelAction, { type: "activateEffect" }> | undefined {
  return actions.find((action): action is Extract<DuelAction, { type: "activateEffect" }> => {
    if (action.type !== "activateEffect" || action.uid !== uid) return false;
    const effect = session.state.effects.find((candidate) => candidate.id === action.effectId && candidate.sourceUid === uid);
    return effect?.description === solfachordHappinessDescription && ((effect.luaTypeFlags ?? 0) & 0x10) !== 0;
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
