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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Ultimate Divine-Beast attack retarget", () => {
  it("restores its attack-announcement trigger and retargets to the summoned DIVINE monster", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const ultimateDivineBeastCode = "32247099";
    const attackerCode = "3224";
    const divineCode = "3225";
    const discardCode = "3226";
    const originalTargetCode = "3227";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === ultimateDivineBeastCode),
      { code: attackerCode, name: "Ultimate Divine-Beast Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 1800, defense: 1200 },
      { code: divineCode, name: "Ultimate Divine-Beast DIVINE Target", kind: "monster", typeFlags: 0x1, level: 4, race: 0x200000, attack: 500, defense: 500 },
      { code: discardCode, name: "Ultimate Divine-Beast Discard Cost", kind: "spell", typeFlags: 0x2 },
      { code: originalTargetCode, name: "Ultimate Divine-Beast Original Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 322, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [attackerCode] }, 1: { main: [ultimateDivineBeastCode, discardCode, divineCode, originalTargetCode] } });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.code === attackerCode);
    const ultimateDivineBeast = session.state.cards.find((card) => card.code === ultimateDivineBeastCode);
    const divine = session.state.cards.find((card) => card.code === divineCode);
    const discard = session.state.cards.find((card) => card.code === discardCode);
    const originalTarget = session.state.cards.find((card) => card.code === originalTargetCode);
    expect(attacker).toBeDefined();
    expect(ultimateDivineBeast).toBeDefined();
    expect(divine).toBeDefined();
    expect(discard).toBeDefined();
    expect(originalTarget).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, originalTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, ultimateDivineBeast!.uid, "spellTrapZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, discard!.uid, "hand", 1);
    moveDuelCard(session.state, divine!.uid, "graveyard", 1);
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(ultimateDivineBeastCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "trigger", code: 1130, sourceUid: ultimateDivineBeast!.uid }),
      ]),
    );

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === originalTarget!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    expect(session.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid, targetUid: originalTarget!.uid });
    expect(session.state.pendingTriggers).toEqual([
      expect.objectContaining({
        player: 1,
        triggerBucket: "opponentOptional",
        eventName: "attackDeclared",
        sourceUid: ultimateDivineBeast!.uid,
        eventCardUid: attacker!.uid,
      }),
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const trigger = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "activateTrigger" && action.uid === ultimateDivineBeast!.uid);
    expect(trigger).toBeDefined();
    const activated = applyLuaRestoreResponse(restored, trigger!);
    expect(activated.ok, activated.error).toBe(true);
    resolveChainIfNeeded(restored);

    expect(restored.session.state.currentAttack).toMatchObject({ attackerUid: attacker!.uid, targetUid: divine!.uid });
    expect(restored.session.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid, targetUid: divine!.uid });
    expect(restored.session.state.battleWindow?.kind).not.toBe("replayDecision");
    expect(restored.session.state.cards.find((card) => card.uid === discard!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restored.session.state.cards.find((card) => card.uid === originalTarget!.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restored.session.state.cards.find((card) => card.uid === divine!.uid)).toMatchObject({ location: "monsterZone", controller: 1, position: "faceUpDefense" });

    passBattleResponses(restored.session);
    expect(restored.session.state.cards.find((card) => card.uid === originalTarget!.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restored.session.state.cards.find((card) => card.uid === divine!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restored.session.state.players[1].lifePoints).toBe(8000);
  });
});

function resolveChainIfNeeded(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const response = applyLuaRestoreResponse(restored, pass!);
    expect(response.ok, response.error).toBe(true);
    expect(response.legalActions).toEqual(getLegalActions(restored.session, response.state.waitingFor!));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
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
