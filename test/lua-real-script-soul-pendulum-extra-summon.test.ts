import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter } from "#duel/counters.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const soulPendulumCounter = 0x200;
const pendulumType = 0x1000001;
const soulPendulumExtraSummonDescription = 34884015 * 16 + 1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Soul Pendulum extra summon", () => {
  it("restores the additional Pendulum Summon granted after spending counters", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const soulPendulumCode = "34884015";
    const lowScaleCode = "34884016";
    const highScaleCode = "34884017";
    const candidateCode = "34884018";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === soulPendulumCode),
      { code: lowScaleCode, name: "Soul Pendulum Low Scale Fixture", kind: "monster", typeFlags: pendulumType, level: 4, leftScale: 1, rightScale: 1 },
      { code: highScaleCode, name: "Soul Pendulum High Scale Fixture", kind: "monster", typeFlags: pendulumType, level: 4, leftScale: 8, rightScale: 8 },
      { code: candidateCode, name: "Soul Pendulum Candidate Fixture", kind: "monster", typeFlags: pendulumType, level: 4, attack: 1800, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 348, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [soulPendulumCode, lowScaleCode, highScaleCode, candidateCode] }, 1: { main: [] } });
    startDuel(session);

    const soulPendulum = session.state.cards.find((card) => card.code === soulPendulumCode);
    const lowScale = session.state.cards.find((card) => card.code === lowScaleCode);
    const highScale = session.state.cards.find((card) => card.code === highScaleCode);
    const candidate = session.state.cards.find((card) => card.code === candidateCode);
    expect(soulPendulum).toBeDefined();
    expect(lowScale).toBeDefined();
    expect(highScale).toBeDefined();
    expect(candidate).toBeDefined();

    moveDuelCard(session.state, lowScale!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, highScale!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, soulPendulum!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, candidate!.uid, "hand", 0);
    addDuelCardCounter(soulPendulum, soulPendulumCounter, 3);
    session.state.players[0].pendulumSummonAvailable = false;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(soulPendulumCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored);
    expect(findPendulumSummon(restored.session, getLuaRestoreLegalActions(restored, 0), candidate!.uid)).toBeUndefined();

    const grantExtraSummon = findSoulPendulumExtraSummon(restored.session, getLuaRestoreLegalActions(restored, 0), soulPendulum!.uid);
    expect(grantExtraSummon, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, grantExtraSummon!);
    resolveRestoredChain(restored);
    expect(restored.session.state.cards.find((card) => card.uid === soulPendulum!.uid)?.counters?.[soulPendulumCounter] ?? 0).toBe(0);

    const restoredAfterGrant = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expect(restoredAfterGrant.restoreComplete, restoredAfterGrant.incompleteReasons.join("; ")).toBe(true);
    expect(restoredAfterGrant.missingRegistryKeys).toEqual([]);
    expect(restoredAfterGrant.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredAfterGrant);
    const pendulumSummon = findPendulumSummon(restoredAfterGrant.session, getLuaRestoreLegalActions(restoredAfterGrant, 0), candidate!.uid);
    expect(pendulumSummon, JSON.stringify(getLuaRestoreLegalActions(restoredAfterGrant, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredAfterGrant, { ...pendulumSummon!, summonUids: [candidate!.uid] });

    expect(restoredAfterGrant.session.state.cards.find((card) => card.uid === candidate!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      summonType: "pendulum",
      faceUp: true,
    });
    expect(restoredAfterGrant.session.state.players[0].pendulumSummonAvailable).toBe(false);
    expect(restoredAfterGrant.session.state.players[0].extraPendulumSummons).toBe(0);
  });
});

function findSoulPendulumExtraSummon(session: DuelSession, actions: DuelAction[], uid: string): Extract<DuelAction, { type: "activateEffect" }> | undefined {
  return actions.find((action): action is Extract<DuelAction, { type: "activateEffect" }> => {
    if (action.type !== "activateEffect" || action.uid !== uid) return false;
    const effect = session.state.effects.find((candidate) => candidate.id === action.effectId && candidate.sourceUid === uid);
    return Boolean(effect?.description === soulPendulumExtraSummonDescription && effect.range.includes("spellTrapZone"));
  });
}

function findPendulumSummon(session: DuelSession, actions: DuelAction[], uid: string): Extract<DuelAction, { type: "pendulumSummon" }> | undefined {
  return actions.find((action): action is Extract<DuelAction, { type: "pendulumSummon" }> => action.type === "pendulumSummon" && action.summonUids.includes(uid) && action.player === session.state.waitingFor);
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  expectRestoredLegalActions(restored);
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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(getLuaRestoreLegalActions(restored, waitingFor)).toEqual(getLegalActions(restored.session, waitingFor));
  expect(getLuaRestoreLegalActionGroups(restored, waitingFor)).toEqual(getGroupedDuelLegalActions(restored.session, waitingFor));
  expect(getLuaRestoreLegalActionGroups(restored, waitingFor).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
}
