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
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Super Junior Confrontation CalculateDamage", () => {
  it("restores attack negation into script-selected CalculateDamage and Battle Phase skip", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const confrontationCode = "29590905";
    const attackerCode = "29590906";
    const opponentAttackCode = "29590907";
    const defenderCode = "29590908";
    const originalTargetCode = "29590909";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === confrontationCode),
      { code: attackerCode, name: "Super Junior Original Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 2100, defense: 1000 },
      { code: opponentAttackCode, name: "Super Junior Selected Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 1400, defense: 1000 },
      { code: defenderCode, name: "Super Junior Defense Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 500, defense: 900 },
      { code: originalTargetCode, name: "Super Junior Original Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 295, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [confrontationCode, defenderCode, originalTargetCode] }, 1: { main: [attackerCode, opponentAttackCode] } });
    startDuel(session);

    const confrontation = session.state.cards.find((card) => card.code === confrontationCode);
    const attacker = session.state.cards.find((card) => card.code === attackerCode);
    const opponentAttack = session.state.cards.find((card) => card.code === opponentAttackCode);
    const defender = session.state.cards.find((card) => card.code === defenderCode);
    const originalTarget = session.state.cards.find((card) => card.code === originalTargetCode);
    expect(confrontation).toBeDefined();
    expect(attacker).toBeDefined();
    expect(opponentAttack).toBeDefined();
    expect(defender).toBeDefined();
    expect(originalTarget).toBeDefined();
    moveDuelCard(session.state, confrontation!.uid, "spellTrapZone", 0);
    confrontation!.position = "faceDown";
    confrontation!.faceUp = false;
    moveDuelCard(session.state, defender!.uid, "monsterZone", 0);
    defender!.position = "faceUpDefense";
    defender!.faceUp = true;
    moveDuelCard(session.state, originalTarget!.uid, "monsterZone", 0);
    originalTarget!.position = "faceUpAttack";
    originalTarget!.faceUp = true;
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 1);
    attacker!.position = "faceUpAttack";
    attacker!.faceUp = true;
    moveDuelCard(session.state, opponentAttack!.uid, "monsterZone", 1);
    opponentAttack!.position = "faceUpAttack";
    opponentAttack!.faceUp = true;
    session.state.turnPlayer = 1;
    session.state.phase = "battle";
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(confrontationCode), workspace).ok).toBe(true);
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

    const activation = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === confrontation!.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    const activated = applyLuaRestoreResponse(restored, activation!);
    expect(activated.ok, activated.error).toBe(true);
    resolveRestoredChain(restored);

    expect(restored.session.state.currentAttack).toBeUndefined();
    expect(restored.session.state.pendingBattle).toBeUndefined();
    expect(restored.session.state.attackCanceledUids).toEqual([attacker!.uid]);
    expect(restored.session.state.skippedPhases).toEqual([{ player: 1, phase: "battle", remaining: 1 }]);
    expect(restored.session.state.cards.find((card) => card.uid === confrontation!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === defender!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === originalTarget!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === attacker!.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restored.session.state.cards.find((card) => card.uid === opponentAttack!.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restored.session.state.players[0].lifePoints).toBe(8000);
    expect(restored.session.state.players[1].lifePoints).toBe(8000);
    expect(restored.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "attackDeclared", eventCardUid: attacker!.uid }),
        expect.objectContaining({ eventName: "attackDisabled", eventCardUid: attacker!.uid }),
      ]),
    );
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === defender!.uid)).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: defender!.uid,
        eventPreviousState: {
          location: "monsterZone",
          controller: 0,
          sequence: 0,
          position: "faceUpDefense",
          faceUp: true,
        },
        eventCurrentState: {
          location: "graveyard",
          controller: 0,
          sequence: 0,
          position: "faceUpDefense",
          faceUp: true,
        },
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: opponentAttack!.uid,
      },
    ]);
  });
});

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

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
