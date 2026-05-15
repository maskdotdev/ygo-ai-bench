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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Dark Elf attack cost", () => {
  it("restores Dark Elf after its attack cost is paid", () => {
    const { session, reader, workspace, darkElf, target } = setupDarkElfFixture();

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === darkElf.uid && action.targetUid === target.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    expect(session.state.attackCostPaid).toBe(1);
    expect(session.state.players[0].lifePoints).toBe(7000);
    expect(session.state.battleWindow?.kind).toBe("attackNegationResponse");
    expect(session.state.eventHistory.filter((event) => event.eventName === "lifePointCostPaid")).toEqual([
      {
        eventName: "lifePointCostPaid",
        eventCode: 1201,
        eventPlayer: 0,
        eventValue: 1000,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: darkElf.uid,
        eventReasonEffectId: 1,
      },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.attackCostPaid).toBe(1);
    expect(restored.session.state.players[0].lifePoints).toBe(7000);

    passBattleResponses(restored.session);
    expect(restored.session.state.players[0].lifePoints).toBe(7000);
    expect(restored.session.state.players[1].lifePoints).toBe(7500);
    expect(restored.session.state.cards.find((card) => card.uid === darkElf.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({ location: "graveyard", controller: 1 });
  });

  it("does not expose Dark Elf attacks when the LP attack cost cannot be paid", () => {
    const { session, reader, workspace, darkElf } = setupDarkElfFixture();
    session.state.players[0].lifePoints = 1000;

    expect(getLegalActions(session, 0).some((action) => action.type === "declareAttack" && action.attackerUid === darkElf.uid)).toBe(false);
    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 0).some((action) => action.type === "declareAttack" && action.attackerUid === darkElf.uid)).toBe(false);
  });
});

function setupDarkElfFixture() {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  const darkElfCode = "21417692";
  const targetCode = "2141";
  const cards: DuelCardData[] = [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === darkElfCode),
    { code: targetCode, name: "Dark Elf Fixture Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1500, defense: 1500 },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed: 214, startingHandSize: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [darkElfCode] }, 1: { main: [targetCode] } });
  startDuel(session);

  const darkElf = session.state.cards.find((card) => card.code === darkElfCode);
  const target = session.state.cards.find((card) => card.code === targetCode);
  expect(darkElf).toBeDefined();
  expect(target).toBeDefined();
  moveDuelCard(session.state, darkElf!.uid, "monsterZone", 0).position = "faceUpAttack";
  moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";
  session.state.phase = "battle";
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(darkElfCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  expect(session.state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ event: "continuous", code: 96, sourceUid: darkElf!.uid })]));

  return { session, reader, workspace, darkElf: darkElf!, target: target! };
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
