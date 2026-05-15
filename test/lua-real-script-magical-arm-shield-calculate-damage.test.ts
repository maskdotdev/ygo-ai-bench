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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Magical Arm Shield CalculateDamage", () => {
  it("restores temporary control of an opponent monster and resolves CalculateDamage against it", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const shieldCode = "96008713";
    const attackerCode = "96008714";
    const stolenTargetCode = "96008715";
    const originalTargetCode = "96008716";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === shieldCode),
      { code: attackerCode, name: "Magical Arm Shield Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 2000, defense: 1000 },
      { code: stolenTargetCode, name: "Magical Arm Shield Stolen Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 500, defense: 500 },
      { code: originalTargetCode, name: "Magical Arm Shield Original Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1200, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 960, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [shieldCode, originalTargetCode] }, 1: { main: [attackerCode, stolenTargetCode] } });
    startDuel(session);

    const shield = session.state.cards.find((card) => card.code === shieldCode);
    const attacker = session.state.cards.find((card) => card.code === attackerCode);
    const stolenTarget = session.state.cards.find((card) => card.code === stolenTargetCode);
    const originalTarget = session.state.cards.find((card) => card.code === originalTargetCode);
    expect(shield).toBeDefined();
    expect(attacker).toBeDefined();
    expect(stolenTarget).toBeDefined();
    expect(originalTarget).toBeDefined();
    moveDuelCard(session.state, shield!.uid, "spellTrapZone", 0);
    shield!.position = "faceDown";
    shield!.faceUp = false;
    moveDuelCard(session.state, originalTarget!.uid, "monsterZone", 0);
    originalTarget!.position = "faceUpAttack";
    originalTarget!.faceUp = true;
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 1);
    attacker!.position = "faceUpAttack";
    attacker!.faceUp = true;
    moveDuelCard(session.state, stolenTarget!.uid, "monsterZone", 1);
    stolenTarget!.position = "faceUpAttack";
    stolenTarget!.faceUp = true;
    session.state.turnPlayer = 1;
    session.state.phase = "battle";
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(shieldCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 1).find(
      (action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === originalTarget!.uid,
    );
    expect(attack, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    if (session.state.waitingFor === 1) {
      const turnPlayerPass = getLegalActions(session, 1).find((action) => action.type === "passAttack");
      expect(turnPlayerPass, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
      applyAndAssert(session, turnPlayerPass!);
    }

    expect(session.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid, targetUid: originalTarget!.uid });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.battleWindow?.kind).toBe("attackNegationResponse");
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    const restoredActivation = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === shield!.uid);
    expect(restoredActivation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, restoredActivation!);
    expect(resolved.ok, resolved.error).toBe(true);
    resolveRestoredChain(restored);

    expect(restored.session.state.currentAttack).toBeUndefined();
    expect(restored.session.state.pendingBattle).toBeUndefined();
    expect(restored.session.state.cards.find((card) => card.uid === shield!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === originalTarget!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === attacker!.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restored.session.state.cards.find((card) => card.uid === stolenTarget!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.players[0].lifePoints).toBe(6500);
    expect(restored.session.state.players[1].lifePoints).toBe(8000);
    expect(restored.session.state.battleDamage).toEqual({ 0: 1500, 1: 0 });
    expect(restored.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "controlChanged", eventCardUid: stolenTarget!.uid }),
        expect.objectContaining({ eventName: "battleDamageDealt", eventPlayer: 0, eventValue: 1500 }),
        expect.objectContaining({ eventName: "destroyed", eventCardUid: stolenTarget!.uid }),
      ]),
    );
  });
});

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
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
    const result = applyLuaRestoreResponse(restored, pass!);
    expect(result.ok, result.error).toBe(true);
  }
}
