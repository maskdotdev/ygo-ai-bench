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
const counterA = 0x100e;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Alien Hunter chain attack", () => {
  it("restores Alien Hunter's battle-destroying trigger and reopens its attack with Duel.ChainAttack", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const alienHunterCode = "62315111";
    const counterTargetCode = "6231";
    const followupTargetCode = "6232";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === alienHunterCode),
      { code: counterTargetCode, name: "Alien Hunter A-Counter Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: followupTargetCode, name: "Alien Hunter Followup Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 800, defense: 800 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 623, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [alienHunterCode] }, 1: { main: [counterTargetCode, followupTargetCode] } });
    startDuel(session);

    const alienHunter = session.state.cards.find((card) => card.code === alienHunterCode);
    const counterTarget = session.state.cards.find((card) => card.code === counterTargetCode);
    const followupTarget = session.state.cards.find((card) => card.code === followupTargetCode);
    expect(alienHunter).toBeDefined();
    expect(counterTarget).toBeDefined();
    expect(followupTarget).toBeDefined();
    moveDuelCard(session.state, alienHunter!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, counterTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, followupTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    expect(addDuelCardCounter(counterTarget, counterA, 1)).toBe(true);
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(alienHunterCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "continuous", code: 1138, sourceUid: alienHunter!.uid }),
        expect.objectContaining({ event: "trigger", code: 1139, sourceUid: alienHunter!.uid }),
      ]),
    );

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === alienHunter!.uid && action.targetUid === counterTarget!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    passBattleResponses(session);

    expect(session.state.cards.find((card) => card.uid === counterTarget!.uid)).toMatchObject({
      location: "graveyard",
      reasonCardUid: alienHunter!.uid,
    });
    expect(session.state.cards.find((card) => card.uid === alienHunter!.uid)).toMatchObject({ location: "monsterZone" });
    expect(session.state.cards.find((card) => card.uid === followupTarget!.uid)).toMatchObject({ location: "monsterZone" });
    expect(session.state.pendingTriggers).toEqual([
      expect.objectContaining({
        player: 0,
        triggerBucket: "turnOptional",
        eventName: "battleDestroyed",
        eventCardUid: alienHunter!.uid,
        eventPlayer: 1,
        sourceUid: alienHunter!.uid,
      }),
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);

    const trigger = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateTrigger" && action.uid === alienHunter!.uid);
    expect(trigger).toBeDefined();
    const triggered = applyLuaRestoreResponse(restored, trigger!);
    expect(triggered.ok, triggered.error).toBe(true);

    expect(restored.session.state.pendingTriggers).toEqual([]);
    expect(restored.session.state.currentAttack).toBeUndefined();
    expect(restored.session.state.pendingBattle).toBeUndefined();
    expect(restored.session.state.attacksDeclared).not.toContain(alienHunter!.uid);
    expect(restored.session.state.waitingFor).toBe(0);
    expect(restored.session.state.cards.find((card) => card.uid === alienHunter!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === counterTarget!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restored.session.state.cards.find((card) => card.uid === followupTarget!.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "declareAttack", attackerUid: alienHunter!.uid, targetUid: followupTarget!.uid }),
      ]),
    );
  });
});

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
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
