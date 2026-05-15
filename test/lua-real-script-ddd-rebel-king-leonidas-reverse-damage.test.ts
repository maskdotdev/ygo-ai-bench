import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script D/D/D Rebel King Leonidas reverse damage", () => {
  it("restores temporary effect-damage reversal from the Project Ignis script", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const leonidasCode = "92536468";
    const tremendousFireCode = "46918794";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => [leonidasCode, tremendousFireCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 92536, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [leonidasCode, tremendousFireCode, tremendousFireCode] }, 1: { main: [] } });
    startDuel(session);

    const leonidas = session.state.cards.find((card) => card.code === leonidasCode);
    const fires = session.state.cards.filter((card) => card.code === tremendousFireCode);
    expect(leonidas).toBeDefined();
    expect(fires).toHaveLength(2);
    moveDuelCard(session.state, leonidas!.uid, "spellTrapZone", 0).sequence = 0;
    leonidas!.faceUp = true;
    leonidas!.position = "faceUpAttack";
    for (const fire of fires) moveDuelCard(session.state, fire.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(leonidasCode), workspace).ok).toBe(true);
    expect(host.loadCardScript(Number(tremendousFireCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    activateAndResolveFire(session, fires[0]!.uid);
    expect(session.state.players[0].lifePoints).toBe(7500);
    expect(session.state.players[1].lifePoints).toBe(7000);

    const reverseDamageTrigger = getLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.uid === leonidas!.uid);
    expect(reverseDamageTrigger).toBeDefined();
    applyAndAssert(session, reverseDamageTrigger!);
    passPendingChainIfAny(session);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 80,
          controller: 0,
          luaValueDescriptor: "value-predicate:effect-reason",
          targetRange: [1, 1],
        }),
      ]),
    );

    const snapshot = serializeDuel(session);
    expect(snapshot.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 80,
          luaValueDescriptor: "value-predicate:effect-reason",
          targetRange: [1, 1],
        }),
      ]),
    );
    const restored = restoreDuelWithLuaScripts(snapshot, workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    const secondFire = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === fires[1]!.uid);
    expect(secondFire).toBeDefined();
    const activated = applyLuaRestoreResponse(restored, secondFire!);
    expect(activated.ok, activated.error).toBe(true);
    if (restored.session.state.chain.length > 0) {
      const player = restored.session.state.waitingFor;
      expect(player).toBeDefined();
      const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
      expect(pass).toBeDefined();
      const resolved = applyLuaRestoreResponse(restored, pass!);
      expect(resolved.ok, resolved.error).toBe(true);
    }

    expect(restored.session.state.players[0].lifePoints).toBe(8000);
    expect(restored.session.state.players[1].lifePoints).toBe(8000);
    expect(restored.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "recoveredLifePoints", eventCode: 1112, eventPlayer: 1, eventValue: 1000 }),
        expect.objectContaining({ eventName: "recoveredLifePoints", eventCode: 1112, eventPlayer: 0, eventValue: 500 }),
      ]),
    );
  });
});

function activateAndResolveFire(session: DuelSession, uid: string): void {
  const action = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === uid);
  expect(action).toBeDefined();
  applyAndAssert(session, action!);
  passPendingChainIfAny(session);
}

function passPendingChainIfAny(session: DuelSession): void {
  if (session.state.chain.length === 0) return;
  const player = session.state.waitingFor;
  expect(player).toBeDefined();
  const pass = getLegalActions(session, player!).find((candidate) => candidate.type === "passChain");
  expect(pass).toBeDefined();
  applyAndAssert(session, pass!);
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
