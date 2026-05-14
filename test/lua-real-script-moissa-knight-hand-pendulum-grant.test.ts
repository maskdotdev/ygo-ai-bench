import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, drawDuelCards, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const pendulumType = 0x1000001;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Moissa Knight hand Pendulum grant", () => {
  it("restores an additional Pendulum Summon restricted to hand monsters", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const moissaCode = "66736715";
    const lowScaleCode = "66736716";
    const highScaleCode = "66736717";
    const handCandidateCode = "66736718";
    const extraCandidateCode = "66736719";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === moissaCode),
      { code: lowScaleCode, name: "Moissa Knight Low Scale Fixture", kind: "monster", typeFlags: pendulumType, level: 4, leftScale: 1, rightScale: 1 },
      { code: highScaleCode, name: "Moissa Knight High Scale Fixture", kind: "monster", typeFlags: pendulumType, level: 4, leftScale: 8, rightScale: 8 },
      { code: handCandidateCode, name: "Moissa Knight Hand Candidate Fixture", kind: "monster", typeFlags: pendulumType, level: 4, attack: 1600, defense: 1000 },
      { code: extraCandidateCode, name: "Moissa Knight Extra Candidate Fixture", kind: "monster", typeFlags: pendulumType, level: 4, attack: 1700, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 667, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [moissaCode, lowScaleCode, highScaleCode, handCandidateCode], extra: [extraCandidateCode] }, 1: { main: [] } });
    startDuel(session);

    const moissa = session.state.cards.find((card) => card.code === moissaCode);
    const lowScale = session.state.cards.find((card) => card.code === lowScaleCode);
    const highScale = session.state.cards.find((card) => card.code === highScaleCode);
    const handCandidate = session.state.cards.find((card) => card.code === handCandidateCode);
    const extraCandidate = session.state.cards.find((card) => card.code === extraCandidateCode);
    expect(moissa).toBeDefined();
    expect(lowScale).toBeDefined();
    expect(highScale).toBeDefined();
    expect(handCandidate).toBeDefined();
    expect(extraCandidate).toBeDefined();

    moveDuelCard(session.state, lowScale!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, highScale!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, handCandidate!.uid, "hand", 0);
    moveDuelCard(session.state, extraCandidate!.uid, "extraDeck", 0);
    session.state.players[0].pendulumSummonAvailable = false;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(moissaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(drawDuelCards(session.state, 0, 1)).toBe(1);
    expect(session.state.cards.find((card) => card.uid === moissa!.uid)).toMatchObject({ location: "hand" });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    assertLegalActions(restored);
    const trigger = getLuaRestoreLegalActions(restored, 0).find((action): action is Extract<DuelAction, { type: "activateTrigger" }> => action.type === "activateTrigger" && action.uid === moissa!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, trigger!);
    resolveRestoredChain(restored);

    const restoredAfterGrant = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expect(restoredAfterGrant.restoreComplete, restoredAfterGrant.incompleteReasons.join("; ")).toBe(true);
    expect(restoredAfterGrant.missingRegistryKeys).toEqual([]);
    assertLegalActions(restoredAfterGrant);
    const pendulumSummon = findPendulumSummon(getLuaRestoreLegalActions(restoredAfterGrant, 0), handCandidate!.uid);
    expect(pendulumSummon, JSON.stringify(getLuaRestoreLegalActions(restoredAfterGrant, 0), null, 2)).toBeDefined();
    expect(pendulumSummon!.summonUids).toContain(handCandidate!.uid);
    expect(pendulumSummon!.summonUids).not.toContain(extraCandidate!.uid);

    applyLuaRestoreAndAssert(restoredAfterGrant, { ...pendulumSummon!, summonUids: [handCandidate!.uid] });
    expect(restoredAfterGrant.session.state.cards.find((card) => card.uid === handCandidate!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      summonType: "pendulum",
      faceUp: true,
    });
    expect(restoredAfterGrant.session.state.cards.find((card) => card.uid === extraCandidate!.uid)).toMatchObject({ location: "extraDeck", faceUp: true });
    expect(restoredAfterGrant.session.state.players[0].extraPendulumSummons).toBe(0);
  });
});

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
