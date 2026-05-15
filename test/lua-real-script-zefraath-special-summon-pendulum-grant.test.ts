import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const pendulumType = 0x1000001;
const setZefra = 0xc4;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Zefraath special summon Pendulum grant", () => {
  it("restores the Zefra-only additional Pendulum Summon granted after Zefraath is Special Summoned", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const zefraathCode = "29432356";
    const lowScaleCode = "29432357";
    const highScaleCode = "29432358";
    const allowedCandidateCode = "29432359";
    const rejectedCandidateCode = "29432360";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === zefraathCode),
      { code: lowScaleCode, name: "Zefraath Low Scale Fixture", kind: "monster", typeFlags: pendulumType, level: 4, leftScale: 1, rightScale: 1 },
      { code: highScaleCode, name: "Zefraath High Scale Fixture", kind: "monster", typeFlags: pendulumType, level: 4, leftScale: 8, rightScale: 8 },
      { code: allowedCandidateCode, name: "Zefraath Zefra Candidate Fixture", kind: "monster", typeFlags: pendulumType, level: 4, attack: 1700, defense: 1000, setcodes: [setZefra] },
      { code: rejectedCandidateCode, name: "Zefraath Rejected Candidate Fixture", kind: "monster", typeFlags: pendulumType, level: 4, attack: 1600, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 294, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [lowScaleCode, highScaleCode, allowedCandidateCode, rejectedCandidateCode], extra: [zefraathCode] }, 1: { main: [] } });
    startDuel(session);

    const zefraath = session.state.cards.find((card) => card.code === zefraathCode);
    const lowScale = session.state.cards.find((card) => card.code === lowScaleCode);
    const highScale = session.state.cards.find((card) => card.code === highScaleCode);
    const allowedCandidate = session.state.cards.find((card) => card.code === allowedCandidateCode);
    const rejectedCandidate = session.state.cards.find((card) => card.code === rejectedCandidateCode);
    expect(zefraath).toBeDefined();
    expect(lowScale).toBeDefined();
    expect(highScale).toBeDefined();
    expect(allowedCandidate).toBeDefined();
    expect(rejectedCandidate).toBeDefined();

    moveDuelCard(session.state, lowScale!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, highScale!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, zefraath!.uid, "extraDeck", 0);
    moveDuelCard(session.state, allowedCandidate!.uid, "hand", 0);
    moveDuelCard(session.state, rejectedCandidate!.uid, "hand", 0);
    session.state.players[0].pendulumSummonAvailable = false;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(zefraathCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(findPendulumSummon(getLegalActions(session, 0), allowedCandidate!.uid)).toBeUndefined();
    specialSummonDuelCard(session.state, zefraath!.uid, 0, 0, {}, undefined, true, true);
    expect(session.state.players[0].extraPendulumSummonGrants).toEqual([expect.objectContaining({ setcode: setZefra })]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored);
    expect(restored.session.state.flagEffects).toEqual(expect.arrayContaining([expect.objectContaining({ ownerType: "player", ownerId: "0", code: Number(zefraathCode) })]));
    const pendulumSummon = findPendulumSummon(getLuaRestoreLegalActions(restored, 0), allowedCandidate!.uid);
    expect(pendulumSummon, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    expect(pendulumSummon!.summonUids).toContain(allowedCandidate!.uid);
    expect(pendulumSummon!.summonUids).not.toContain(rejectedCandidate!.uid);

    applyLuaRestoreAndAssert(restored, { ...pendulumSummon!, summonUids: [allowedCandidate!.uid] });
    expect(restored.session.state.cards.find((card) => card.uid === allowedCandidate!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      summonType: "pendulum",
      faceUp: true,
    });
    expect(restored.session.state.cards.find((card) => card.uid === rejectedCandidate!.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.players[0].extraPendulumSummons).toBe(0);
  });
});

function findPendulumSummon(actions: DuelAction[], uid: string): Extract<DuelAction, { type: "pendulumSummon" }> | undefined {
  return actions.find((action): action is Extract<DuelAction, { type: "pendulumSummon" }> => action.type === "pendulumSummon" && action.summonUids.includes(uid));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  expectRestoredLegalActions(restored);
  return response;
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(getLuaRestoreLegalActions(restored, waitingFor)).toEqual(getLegalActions(restored.session, waitingFor));
  expect(getLuaRestoreLegalActionGroups(restored, waitingFor)).toEqual(getGroupedDuelLegalActions(restored.session, waitingFor));
  expect(getLuaRestoreLegalActionGroups(restored, waitingFor).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
}
