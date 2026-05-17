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
import { registerDuelFlagEffect } from "#duel/flags.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typePendulumMonster = 0x1000001;
const pendulumEvolutionSummonDescription = 55795155 * 16 + 1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Pendulum Evolution direct Pendulum Summon", () => {
  it("restores an official effect operation that calls Duel.PendulumSummon(tp)", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const pendulumEvolutionCode = "55795155";
    const lowScaleCode = "55795156";
    const highScaleCode = "55795157";
    const candidateCode = "55795158";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === pendulumEvolutionCode),
      { code: lowScaleCode, name: "Pendulum Evolution Low Scale Fixture", kind: "monster", typeFlags: typePendulumMonster, level: 4, leftScale: 1, rightScale: 1 },
      { code: highScaleCode, name: "Pendulum Evolution High Scale Fixture", kind: "monster", typeFlags: typePendulumMonster, level: 4, leftScale: 8, rightScale: 8 },
      { code: candidateCode, name: "Pendulum Evolution Candidate Fixture", kind: "monster", typeFlags: typePendulumMonster, level: 4, attack: 1800, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 557, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [pendulumEvolutionCode, lowScaleCode, highScaleCode, candidateCode] }, 1: { main: [] } });
    startDuel(session);

    const pendulumEvolution = session.state.cards.find((card) => card.code === pendulumEvolutionCode);
    const lowScale = session.state.cards.find((card) => card.code === lowScaleCode);
    const highScale = session.state.cards.find((card) => card.code === highScaleCode);
    const candidate = session.state.cards.find((card) => card.code === candidateCode);
    expect(pendulumEvolution).toBeDefined();
    expect(lowScale).toBeDefined();
    expect(highScale).toBeDefined();
    expect(candidate).toBeDefined();

    moveDuelCard(session.state, lowScale!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, highScale!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, pendulumEvolution!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, candidate!.uid, "hand", 0);
    registerDuelFlagEffect(session.state, { ownerType: "player", ownerId: 0 }, Number(pendulumEvolutionCode), 0, 0, 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(pendulumEvolutionCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 0);
    assertLegalActions(restored);
    const activation = findPendulumEvolutionSummon(restored.session, getLuaRestoreLegalActions(restored, 0), pendulumEvolution!.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, activation!);
    resolveRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === candidate!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      summonType: "pendulum",
      faceUp: true,
    });
    expect(restored.session.state.players[0].pendulumSummonAvailable).toBe(false);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === candidate!.uid)).toMatchInlineSnapshot(`
      [
        {
          "eventCardUid": "p0-deck-55795158-3",
          "eventCode": 1102,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "specialSummoned",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "hand",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 2064,
          "eventReasonCardUid": "p0-deck-55795155-0",
          "eventReasonEffectId": 3,
          "eventReasonPlayer": 0,
          "eventUids": [
            "p0-deck-55795158-3",
          ],
        },
      ]
    `);

    const restoredAfterSummon = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expect(restoredAfterSummon.restoreComplete, restoredAfterSummon.incompleteReasons.join("; ")).toBe(true);
    expect(restoredAfterSummon.missingRegistryKeys).toEqual([]);
    expect(restoredAfterSummon.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredAfterSummon, 0);
    assertLegalActions(restoredAfterSummon);
    expect(restoredAfterSummon.session.state.cards.find((card) => card.uid === candidate!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "pendulum",
    });
  });
});

function findPendulumEvolutionSummon(session: DuelSession, actions: DuelAction[], uid: string): Extract<DuelAction, { type: "activateEffect" }> | undefined {
  return actions.find((action): action is Extract<DuelAction, { type: "activateEffect" }> => {
    if (action.type !== "activateEffect" || action.uid !== uid) return false;
    const effect = session.state.effects.find((candidate) => candidate.id === action.effectId && candidate.sourceUid === uid);
    return Boolean(effect?.description === pendulumEvolutionSummonDescription && effect.range.includes("spellTrapZone"));
  });
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
  expect(getLuaRestoreLegalActions(restored, waitingFor)).toEqual(getDuelLegalActions(restored.session, waitingFor));
  expect(getLuaRestoreLegalActionGroups(restored, waitingFor)).toEqual(getGroupedDuelLegalActions(restored.session, waitingFor));
  expect(getLuaRestoreLegalActionGroups(restored, waitingFor).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
