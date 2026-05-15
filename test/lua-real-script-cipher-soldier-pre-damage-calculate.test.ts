import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { currentAttack } from "#duel/card-stats.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const raceWarrior = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Cipher Soldier pre-damage calculation", () => {
  it("restores its EVENT_PRE_DAMAGE_CALCULATE trigger and applies the Warrior battle stat boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const cipherSoldierCode = "79853073";
    const warriorTargetCode = "7985";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === cipherSoldierCode),
      { code: warriorTargetCode, name: "Cipher Soldier Warrior Target", kind: "monster", typeFlags: 0x1, level: 4, race: raceWarrior, attack: 2000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 798, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [cipherSoldierCode] }, 1: { main: [warriorTargetCode] } });
    startDuel(session);

    const cipherSoldier = session.state.cards.find((card) => card.code === cipherSoldierCode);
    const warriorTarget = session.state.cards.find((card) => card.code === warriorTargetCode);
    expect(cipherSoldier).toBeDefined();
    expect(warriorTarget).toBeDefined();
    moveDuelCard(session.state, cipherSoldier!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, warriorTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(cipherSoldierCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ event: "trigger", code: 1134, sourceUid: cipherSoldier!.uid })]));

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === cipherSoldier!.uid && action.targetUid === warriorTarget!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    passUntilPendingTrigger(session);

    expect(session.state.battleWindow?.kind).toBe("beforeDamageCalculation");
    expect(session.state.pendingBattle).toMatchObject({ attackerUid: cipherSoldier!.uid, targetUid: warriorTarget!.uid });
    expect(session.state.pendingTriggers).toEqual([
      expect.objectContaining({
        triggerBucket: "turnMandatory",
        eventName: "beforeDamageCalculation",
        eventCode: 1134,
        eventCardUid: cipherSoldier!.uid,
        sourceUid: cipherSoldier!.uid,
      }),
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);

    const trigger = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateTrigger" && action.uid === cipherSoldier!.uid);
    expect(trigger).toBeDefined();
    const triggered = applyLuaRestoreResponse(restored, trigger!);
    expect(triggered.ok, triggered.error).toBe(true);

    expect(restored.session.state.pendingTriggers).toEqual([]);
    expect(restored.session.state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ event: "continuous", code: 100, sourceUid: cipherSoldier!.uid, value: 2000 })]));
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === cipherSoldier!.uid), restored.session.state)).toBe(3350);
    expect(restored.session.state.cards.find((card) => card.uid === warriorTarget!.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restored.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "beforeDamageCalculation", eventCode: 1134, eventUids: [cipherSoldier!.uid, warriorTarget!.uid] }),
      ]),
    );

    finishBattle(restored.session);

    expect(restored.session.state.players[1].lifePoints).toBe(6650);
    expect(restored.session.state.battleDamage[1]).toBe(1350);
    expect(restored.session.state.cards.find((card) => card.uid === warriorTarget!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restored.session.state.pendingBattle).toBeUndefined();
    expect(restored.session.state.battleWindow).toBeUndefined();
  });
});

function passUntilPendingTrigger(session: DuelSession): void {
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
    passBattleResponse(session);
  }
}

function passBattleResponse(session: DuelSession): void {
  const player = session.state.waitingFor ?? session.state.turnPlayer;
  const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
  const pass = getLegalActions(session, player).find((action) => action.type === passType);
  expect(pass).toBeDefined();
  applyAndAssert(session, pass!);
}

function finishBattle(session: DuelSession): void {
  let guard = 0;
  while ((session.state.pendingBattle || session.state.chain.length > 0) && guard < 20) {
    guard += 1;
    if (session.state.chain.length > 0) {
      const player = session.state.waitingFor ?? session.state.turnPlayer;
      const pass = getLegalActions(session, player).find((action) => action.type === "passChain");
      if (!pass) break;
      applyAndAssert(session, pass);
      continue;
    }
    if (session.state.pendingTriggers.length > 0) break;
    passBattleResponse(session);
  }
  expect(guard).toBeLessThan(20);
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
