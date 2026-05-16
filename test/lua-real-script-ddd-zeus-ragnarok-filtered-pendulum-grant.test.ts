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
const setDD = 0xaf;
const zeusRagnarokDescription = 30998403 * 16;

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script D/D/D Sky King Zeus Ragnarok filtered Pendulum grant", () => {
  it("destroys a D/D card before granting a D/D-only additional Pendulum Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const zeusCode = "30998403";
    const lowScaleCode = "30998404";
    const highScaleCode = "30998405";
    const destroyTargetCode = "30998406";
    const allowedCandidateCode = "30998407";
    const rejectedCandidateCode = "30998408";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === zeusCode),
      { code: lowScaleCode, name: "Zeus Ragnarok Low Scale Fixture", kind: "monster", typeFlags: pendulumType, level: 4, leftScale: 1, rightScale: 1 },
      { code: highScaleCode, name: "Zeus Ragnarok High Scale Fixture", kind: "monster", typeFlags: pendulumType, level: 4, leftScale: 8, rightScale: 8 },
      { code: destroyTargetCode, name: "Zeus Ragnarok Destroy Target Fixture", kind: "monster", typeFlags: 0x1, level: 4, attack: 1500, defense: 1000, setcodes: [setDD] },
      { code: allowedCandidateCode, name: "Zeus Ragnarok D/D Candidate Fixture", kind: "monster", typeFlags: pendulumType, level: 4, attack: 1700, defense: 1000, setcodes: [setDD] },
      { code: rejectedCandidateCode, name: "Zeus Ragnarok Rejected Candidate Fixture", kind: "monster", typeFlags: pendulumType, level: 4, attack: 1600, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 309, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [lowScaleCode, highScaleCode, destroyTargetCode, allowedCandidateCode, rejectedCandidateCode], extra: [zeusCode] }, 1: { main: [] } });
    startDuel(session);

    const zeus = session.state.cards.find((card) => card.code === zeusCode);
    const lowScale = session.state.cards.find((card) => card.code === lowScaleCode);
    const highScale = session.state.cards.find((card) => card.code === highScaleCode);
    const destroyTarget = session.state.cards.find((card) => card.code === destroyTargetCode);
    const allowedCandidate = session.state.cards.find((card) => card.code === allowedCandidateCode);
    const rejectedCandidate = session.state.cards.find((card) => card.code === rejectedCandidateCode);
    expect(zeus).toBeDefined();
    expect(lowScale).toBeDefined();
    expect(highScale).toBeDefined();
    expect(destroyTarget).toBeDefined();
    expect(allowedCandidate).toBeDefined();
    expect(rejectedCandidate).toBeDefined();

    moveDuelCard(session.state, lowScale!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, highScale!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, destroyTarget!.uid, "monsterZone", 0);
    moveDuelCard(session.state, zeus!.uid, "monsterZone", 0);
    moveDuelCard(session.state, allowedCandidate!.uid, "hand", 0);
    moveDuelCard(session.state, rejectedCandidate!.uid, "hand", 0);
    session.state.players[0].pendulumSummonAvailable = false;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(zeusCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 0);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    assertLegalActions(restored);
    expect(findPendulumSummon(getLuaRestoreLegalActions(restored, 0), allowedCandidate!.uid)).toBeUndefined();

    const activation = findZeusRagnarokIgnition(restored.session, getLuaRestoreLegalActions(restored, 0), zeus!.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, activation!);
    resolveRestoredChain(restored);
    expect(restored.session.state.cards.find((card) => card.uid === destroyTarget!.uid)).toMatchObject({ location: "graveyard" });

    const restoredAfterGrant = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expect(restoredAfterGrant.restoreComplete, restoredAfterGrant.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restoredAfterGrant, 0);
    expect(restoredAfterGrant.missingRegistryKeys).toEqual([]);
    expect(restoredAfterGrant.missingChainLimitRegistryKeys).toEqual([]);
    assertLegalActions(restoredAfterGrant);
    expect(restoredAfterGrant.session.state.flagEffects).toEqual(expect.arrayContaining([expect.objectContaining({ ownerType: "player", ownerId: "0", code: Number(zeusCode) })]));
    expect(restoredAfterGrant.session.state.players[0].extraPendulumSummonGrants).toEqual([expect.objectContaining({ setcode: setDD })]);
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
    expect(restoredAfterGrant.session.state.cards.find((card) => card.uid === rejectedCandidate!.uid)).toMatchObject({ location: "hand" });
    expect(restoredAfterGrant.session.state.players[0].extraPendulumSummons).toBe(0);
  });
});

function findZeusRagnarokIgnition(session: DuelSession, actions: DuelAction[], uid: string): Extract<DuelAction, { type: "activateEffect" }> | undefined {
  return actions.find((action): action is Extract<DuelAction, { type: "activateEffect" }> => {
    if (action.type !== "activateEffect" || action.uid !== uid) return false;
    const effect = session.state.effects.find((candidate) => candidate.id === action.effectId && candidate.sourceUid === uid);
    return effect?.description === zeusRagnarokDescription && effect.range.includes("monsterZone");
  });
}

function findPendulumSummon(actions: DuelAction[], uid: string): Extract<DuelAction, { type: "pendulumSummon" }> | undefined {
  return actions.find((action): action is Extract<DuelAction, { type: "pendulumSummon" }> => action.type === "pendulumSummon" && action.summonUids.includes(uid));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  assertLegalActions(restored);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  }
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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
