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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Extra Pendulum location grant", () => {
  it("restores an additional Pendulum Summon restricted to face-up Extra Deck monsters", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const extraPendulumCode = "58308221";
    const lowScaleCode = "58308222";
    const highScaleCode = "58308223";
    const handCandidateCode = "58308224";
    const extraCandidateCode = "58308225";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === extraPendulumCode),
      { code: lowScaleCode, name: "Extra Pendulum Low Scale Fixture", kind: "monster", typeFlags: pendulumType, level: 4, leftScale: 1, rightScale: 1 },
      { code: highScaleCode, name: "Extra Pendulum High Scale Fixture", kind: "monster", typeFlags: pendulumType, level: 4, leftScale: 8, rightScale: 8 },
      { code: handCandidateCode, name: "Extra Pendulum Hand Candidate Fixture", kind: "monster", typeFlags: pendulumType, level: 4, attack: 1600, defense: 1000 },
      { code: extraCandidateCode, name: "Extra Pendulum Extra Candidate Fixture", kind: "monster", typeFlags: pendulumType, level: 4, attack: 1700, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 583, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [extraPendulumCode, extraPendulumCode, lowScaleCode, highScaleCode, handCandidateCode], extra: [extraCandidateCode] }, 1: { main: [] } });
    startDuel(session);

    const [extraPendulum, secondExtraPendulum] = session.state.cards.filter((card) => card.code === extraPendulumCode);
    const lowScale = session.state.cards.find((card) => card.code === lowScaleCode);
    const highScale = session.state.cards.find((card) => card.code === highScaleCode);
    const handCandidate = session.state.cards.find((card) => card.code === handCandidateCode);
    const extraCandidate = session.state.cards.find((card) => card.code === extraCandidateCode);
    expect(extraPendulum).toBeDefined();
    expect(secondExtraPendulum).toBeDefined();
    expect(lowScale).toBeDefined();
    expect(highScale).toBeDefined();
    expect(handCandidate).toBeDefined();
    expect(extraCandidate).toBeDefined();

    moveDuelCard(session.state, lowScale!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, highScale!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, extraPendulum!.uid, "hand", 0);
    moveDuelCard(session.state, secondExtraPendulum!.uid, "hand", 0);
    moveDuelCard(session.state, handCandidate!.uid, "hand", 0);
    moveDuelCard(session.state, extraCandidate!.uid, "extraDeck", 0);
    session.state.players[0].pendulumSummonAvailable = false;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(extraPendulumCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 0);
    assertLegalActions(restored);
    expect(findPendulumSummon(getLuaRestoreLegalActions(restored, 0), extraCandidate!.uid)).toBeUndefined();
    expect(findPendulumSummon(getLuaRestoreLegalActions(restored, 0), handCandidate!.uid)).toBeUndefined();

    const activation = findExtraPendulumActivation(restored.session, getLuaRestoreLegalActions(restored, 0), extraPendulum!.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, activation!);
    resolveRestoredChain(restored);

    const restoredAfterGrant = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expect(restoredAfterGrant.restoreComplete, restoredAfterGrant.incompleteReasons.join("; ")).toBe(true);
    expect(restoredAfterGrant.missingRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredAfterGrant, 0);
    assertLegalActions(restoredAfterGrant);
    expect(restoredAfterGrant.session.state.flagEffects).toEqual(expect.arrayContaining([expect.objectContaining({ ownerType: "player", ownerId: "0", code: Number(extraPendulumCode) })]));
    expect(findExtraPendulumActivation(restoredAfterGrant.session, getLuaRestoreLegalActions(restoredAfterGrant, 0), secondExtraPendulum!.uid)).toBeUndefined();
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
    expect(restoredAfterGrant.session.state.players[0].pendulumSummonAvailable).toBe(false);
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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
