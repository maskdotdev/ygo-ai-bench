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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Pendulum procedure actions", () => {
  it("restores real Pendulum scale activations, Pendulum Summon, and summon-success trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const lowScaleCode = "7868571";
    const highScaleCode = "14105623";
    const candidateCode = "64207696";
    const cards = workspace.readDatabaseCards("cards.cdb").filter((card) => [lowScaleCode, highScaleCode, candidateCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 296, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [lowScaleCode, highScaleCode, candidateCode] }, 1: { main: [] } });
    startDuel(session);

    const lowScale = session.state.cards.find((card) => card.code === lowScaleCode);
    const highScale = session.state.cards.find((card) => card.code === highScaleCode);
    const candidate = session.state.cards.find((card) => card.code === candidateCode);
    expect(lowScale).toBeDefined();
    expect(highScale).toBeDefined();
    expect(candidate).toBeDefined();
    moveDuelCard(session.state, lowScale!.uid, "hand", 0);
    moveDuelCard(session.state, highScale!.uid, "hand", 0);
    moveDuelCard(session.state, candidate!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(lowScaleCode), workspace).ok).toBe(true);
    expect(host.loadCardScript(Number(highScaleCode), workspace).ok).toBe(true);
    expect(host.loadCardScript(Number(candidateCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const restoredLowScaleWindow = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredLowScaleWindow.restoreComplete, restoredLowScaleWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredLowScaleWindow.missingRegistryKeys).toEqual([]);
    expect(restoredLowScaleWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredLowScaleWindow, 0);
    assertLegalActions(restoredLowScaleWindow);
    const lowScaleActivation = findPendulumActivation(restoredLowScaleWindow.session, getLuaRestoreLegalActions(restoredLowScaleWindow, 0), lowScale!.uid);
    expect(lowScaleActivation, JSON.stringify(getLuaRestoreLegalActions(restoredLowScaleWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredLowScaleWindow, lowScaleActivation!);
    resolveRestoredChain(restoredLowScaleWindow);
    expect(restoredLowScaleWindow.session.state.cards.find((card) => card.uid === lowScale!.uid)).toMatchObject({ location: "spellTrapZone", sequence: 0 });

    const restoredHighScaleWindow = restoreDuelWithLuaScripts(serializeDuel(restoredLowScaleWindow.session), workspace, reader);
    expect(restoredHighScaleWindow.restoreComplete, restoredHighScaleWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredHighScaleWindow.missingRegistryKeys).toEqual([]);
    expect(restoredHighScaleWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredHighScaleWindow, 0);
    assertLegalActions(restoredHighScaleWindow);
    const highScaleActivation = findPendulumActivation(restoredHighScaleWindow.session, getLuaRestoreLegalActions(restoredHighScaleWindow, 0), highScale!.uid);
    expect(highScaleActivation, JSON.stringify(getLuaRestoreLegalActions(restoredHighScaleWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredHighScaleWindow, highScaleActivation!);
    resolveRestoredChain(restoredHighScaleWindow);
    expect(restoredHighScaleWindow.session.state.cards.find((card) => card.uid === highScale!.uid)).toMatchObject({ location: "spellTrapZone", sequence: 1 });

    const restoredPendulumWindow = restoreDuelWithLuaScripts(serializeDuel(restoredHighScaleWindow.session), workspace, reader);
    expect(restoredPendulumWindow.restoreComplete, restoredPendulumWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredPendulumWindow.missingRegistryKeys).toEqual([]);
    expect(restoredPendulumWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredPendulumWindow, 0);
    assertLegalActions(restoredPendulumWindow);
    const pendulumSummon = getLuaRestoreLegalActions(restoredPendulumWindow, 0).find(
      (action): action is Extract<DuelAction, { type: "pendulumSummon" }> => action.type === "pendulumSummon" && action.summonUids.includes(candidate!.uid),
    );
    expect(pendulumSummon, JSON.stringify(getLuaRestoreLegalActions(restoredPendulumWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredPendulumWindow, { ...pendulumSummon!, summonUids: [candidate!.uid] });

    expect(restoredPendulumWindow.session.state.cards.find((card) => card.uid === candidate!.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "pendulum",
    });
    expect(restoredPendulumWindow.session.state.players[0].pendulumSummonAvailable).toBe(false);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredPendulumWindow.session), workspace, reader);
    expect(restoredTriggerWindow.restoreComplete, restoredTriggerWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTriggerWindow.missingRegistryKeys).toEqual([]);
    expect(restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    assertLegalActions(restoredTriggerWindow);
    expect(restoredTriggerWindow.session.state.pendingTriggers).toMatchInlineSnapshot(`
      [
        {
          "effectId": "lua-11-1102",
          "eventCardUid": "p0-deck-64207696-2",
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
            "sequence": 2,
          },
          "eventReason": 2064,
          "eventReasonPlayer": 0,
          "eventTriggerTiming": "when",
          "id": "trigger-8-1",
          "player": 0,
          "sourceUid": "p0-deck-64207696-2",
          "triggerBucket": "turnMandatory",
        },
      ]
    `);
    const summonSuccessTrigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find(
      (action): action is Extract<DuelAction, { type: "activateTrigger" }> => action.type === "activateTrigger" && action.uid === candidate!.uid,
    );
    expect(summonSuccessTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTriggerWindow, summonSuccessTrigger!);
    resolveRestoredChain(restoredTriggerWindow);

    const attackBoosts = restoredTriggerWindow.session.state.effects.filter((effect) => effect.sourceUid === candidate!.uid && effect.event === "continuous" && effect.code === 100);
    expect(attackBoosts).toEqual([
      expect.objectContaining({
        value: 200,
        range: ["monsterZone"],
      }),
    ]);
    const attackProbe = restoredTriggerWindow.host.loadScript(
      `
      local c=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode, ${candidateCode}),0,LOCATION_MZONE,0,nil)
      Debug.Message("gold fang restored attack " .. (c and c:GetAttack() or -1))
      `,
      "gold-fang-restored-attack-probe.lua",
    );
    expect(attackProbe.ok, attackProbe.error).toBe(true);
    expect(restoredTriggerWindow.host.messages).toContain("gold fang restored attack 2000");
  });
});

function findPendulumActivation(session: DuelSession, actions: DuelAction[], uid: string): Extract<DuelAction, { type: "activateEffect" }> | undefined {
  return actions.find((action): action is Extract<DuelAction, { type: "activateEffect" }> => {
    if (action.type !== "activateEffect" || action.uid !== uid) return false;
    const effect = session.state.effects.find((candidate) => candidate.id === action.effectId && candidate.sourceUid === uid);
    return effect?.description === 1160 && ((effect.luaTypeFlags ?? 0) & 0x10) !== 0;
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
