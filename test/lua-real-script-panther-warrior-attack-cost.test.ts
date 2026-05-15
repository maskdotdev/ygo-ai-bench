import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Panther Warrior attack cost", () => {
  it("restores Panther Warrior after releasing a monster for its attack cost", () => {
    const { session, reader, workspace, panther, release, target } = setupPantherWarriorFixture(true);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === panther.uid && action.targetUid === target.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);

    expect(session.state.attackCostPaid).toBe(1);
    expect(session.state.cards.find((card) => card.uid === release.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(session.state.cards.find((card) => card.uid === panther.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(session.state.battleWindow?.kind).toBe("attackNegationResponse");
    expect(session.state.eventHistory.filter((event) => event.eventName === "released" && event.eventCardUid === release.uid)).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: release.uid,
        eventReason: duelReason.release | duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: panther.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.attackCostPaid).toBe(1);
    expect(restored.session.state.cards.find((card) => card.uid === release.uid)).toMatchObject({ location: "graveyard", controller: 0 });

    passBattleResponses(restored.session);
    expect(restored.session.state.players[1].lifePoints).toBe(7500);
    expect(restored.session.state.cards.find((card) => card.uid === panther.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({ location: "graveyard", controller: 1 });
  });

  it("does not expose Panther Warrior attacks without a releasable monster", () => {
    const { session, reader, workspace, panther } = setupPantherWarriorFixture(false);

    expect(getLegalActions(session, 0).some((action) => action.type === "declareAttack" && action.attackerUid === panther.uid)).toBe(false);
    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 0).some((action) => action.type === "declareAttack" && action.attackerUid === panther.uid)).toBe(false);
  });
});

function setupPantherWarriorFixture(withRelease: boolean) {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  const pantherCode = "42035044";
  const releaseCode = "4203";
  const targetCode = "4204";
  const cards: DuelCardData[] = [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === pantherCode),
    { code: releaseCode, name: "Panther Warrior Cost Release", kind: "monster", typeFlags: 0x1, level: 4, attack: 800, defense: 800 },
    { code: targetCode, name: "Panther Warrior Fixture Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1500, defense: 1500 },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed: 420, startingHandSize: 0, cardReader: reader });
  loadDecks(session, { 0: { main: withRelease ? [pantherCode, releaseCode] : [pantherCode] }, 1: { main: [targetCode] } });
  startDuel(session);

  const panther = session.state.cards.find((card) => card.code === pantherCode);
  const release = session.state.cards.find((card) => card.code === releaseCode);
  const target = session.state.cards.find((card) => card.code === targetCode);
  expect(panther).toBeDefined();
  expect(target).toBeDefined();
  moveDuelCard(session.state, panther!.uid, "monsterZone", 0).position = "faceUpAttack";
  if (withRelease) {
    expect(release).toBeDefined();
    moveDuelCard(session.state, release!.uid, "monsterZone", 0).position = "faceUpAttack";
  }
  moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";
  session.state.phase = "battle";
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(pantherCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  expect(session.state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ event: "continuous", code: 96, sourceUid: panther!.uid })]));

  return { session, reader, workspace, panther: panther!, release: release!, target: target! };
}

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
