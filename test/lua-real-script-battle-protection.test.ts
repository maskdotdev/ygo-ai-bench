import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script battle protection", () => {
  it("restores Pilgrim of the Ice Barrier and keeps it from battle destruction by a high-ATK monster", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const pilgrimCode = "20700531";
    const attackerCode = "2070";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === pilgrimCode),
      { code: attackerCode, name: "Pilgrim Battle Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 2000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 207, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [attackerCode] }, 1: { main: [pilgrimCode] } });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.code === attackerCode);
    const pilgrim = session.state.cards.find((card) => card.code === pilgrimCode);
    expect(attacker).toBeDefined();
    expect(pilgrim).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, pilgrim!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(pilgrimCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "continuous", code: 42, sourceUid: pilgrim!.uid }),
      ]),
    );

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === pilgrim!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    expect(session.state.battleWindow?.kind).toBe("attackNegationResponse");

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "continuous", code: 42, sourceUid: pilgrim!.uid }),
      ]),
    );

    passBattleResponses(restored.session);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 500 });
    expect(restored.session.state.players[0].lifePoints).toBe(8000);
    expect(restored.session.state.players[1].lifePoints).toBe(7500);
    expect(restored.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "battleDamageDealt", eventCode: 1143, eventPlayer: 1, eventValue: 500 }),
      ]),
    );
    expect(restored.session.state.cards.find((card) => card.uid === attacker!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.cards.find((card) => card.uid === pilgrim!.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
  });

  it("restores Machina Sniper and removes other Machina monsters from battle targets", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sniperCode = "23782705";
    const soldierCode = "60999392";
    const attackerCode = "2378";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sniperCode || card.code === soldierCode),
      { code: attackerCode, name: "Machina Targeting Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 2500, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 237, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [attackerCode] }, 1: { main: [sniperCode, soldierCode] } });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.code === attackerCode);
    const sniper = session.state.cards.find((card) => card.code === sniperCode);
    const soldier = session.state.cards.find((card) => card.code === soldierCode);
    expect(attacker).toBeDefined();
    expect(sniper).toBeDefined();
    expect(soldier).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, sniper!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, soldier!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sniperCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "continuous", code: 70, sourceUid: sniper!.uid }),
      ]),
    );
    expect(getLegalActions(session, 0)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "declareAttack", attackerUid: attacker!.uid, targetUid: sniper!.uid }),
      ]),
    );
    expect(getLegalActions(session, 0)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "declareAttack", attackerUid: attacker!.uid, targetUid: soldier!.uid }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "continuous", code: 70, sourceUid: sniper!.uid }),
      ]),
    );
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "declareAttack", attackerUid: attacker!.uid, targetUid: sniper!.uid }),
      ]),
    );
    expect(getLuaRestoreLegalActions(restored, 0)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "declareAttack", attackerUid: attacker!.uid, targetUid: soldier!.uid }),
      ]),
    );
  });

  it("restores Soul-Absorbing Bone Tower and keeps aux.imval2 battle targeting scoped to the attacker", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const boneTowerCode = "63012333";
    const zombieCode = "6301";
    const attackerCode = "6302";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === boneTowerCode),
      { code: zombieCode, name: "Bone Tower Zombie Fixture", kind: "monster", typeFlags: 0x1, level: 4, race: 0x10, attack: 1000, defense: 1000 },
      { code: attackerCode, name: "Bone Tower Attack Fixture", kind: "monster", typeFlags: 0x1, level: 4, attack: 2000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 630, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [attackerCode] }, 1: { main: [boneTowerCode, zombieCode] } });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.code === attackerCode);
    const boneTower = session.state.cards.find((card) => card.code === boneTowerCode);
    const zombie = session.state.cards.find((card) => card.code === zombieCode);
    expect(attacker).toBeDefined();
    expect(boneTower).toBeDefined();
    expect(zombie).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, boneTower!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, zombie!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(boneTowerCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "continuous", code: 70, sourceUid: boneTower!.uid }),
      ]),
    );
    expectAttackTarget(session, attacker!.uid, boneTower!.uid, false);
    expectAttackTarget(session, attacker!.uid, zombie!.uid, true);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "continuous", code: 70, sourceUid: boneTower!.uid }),
      ]),
    );
    expectAttackTarget(restored.session, attacker!.uid, boneTower!.uid, false);
    expectAttackTarget(restored.session, attacker!.uid, zombie!.uid, true);
  });
});

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function expectAttackTarget(session: DuelSession, attackerUid: string, targetUid: string, present: boolean): void {
  const attacks = getLegalActions(session, 0).filter((action) => action.type === "declareAttack");
  expect(attacks.some((action) => action.attackerUid === attackerUid && action.targetUid === targetUid), JSON.stringify(attacks)).toBe(present);
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
