import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Negate Attack battle window", () => {
  it("restores and resolves Negate Attack from the Project Ignis attack-declaration script", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const negateAttackCode = "14315573";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === negateAttackCode),
      { code: "100", name: "First Real-Script Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "101", name: "Second Real-Script Attacker", kind: "monster", attack: 1700, defense: 1000 },
      { code: "200", name: "Real-Script Attack Target", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 451, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["100", "101"] }, 1: { main: [negateAttackCode, "200"] } });
    startDuel(session);

    const firstAttacker = session.state.cards.find((card) => card.code === "100");
    const secondAttacker = session.state.cards.find((card) => card.code === "101");
    const target = session.state.cards.find((card) => card.code === "200");
    const negateAttack = session.state.cards.find((card) => card.code === negateAttackCode);
    expect(firstAttacker).toBeDefined();
    expect(secondAttacker).toBeDefined();
    expect(target).toBeDefined();
    expect(negateAttack).toBeDefined();
    moveDuelCard(session.state, firstAttacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, secondAttacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, negateAttack!.uid, "spellTrapZone", 1);
    negateAttack!.position = "faceDown";
    negateAttack!.faceUp = false;
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(negateAttackCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === firstAttacker!.uid && action.targetUid === target!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    if (session.state.waitingFor === 0) {
      const turnPlayerPass = getLegalActions(session, 0).find((action) => action.type === "passAttack");
      expect(turnPlayerPass).toBeDefined();
      applyAndAssert(session, turnPlayerPass!);
    }
    expect(queryPublicState(session)).toMatchObject({ phase: "battle", waitingFor: 1, windowKind: "battle" });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    const negateAction = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "activateEffect" && action.uid === negateAttack!.uid);
    expect(negateAction, JSON.stringify(getLuaRestoreLegalActions(restored, 1), null, 2)).toBeDefined();

    const activated = applyLuaRestoreResponse(restored, negateAction!);
    expect(activated.ok, activated.error).toBe(true);
    expect(restored.session.state.currentAttack).toBeUndefined();
    expect(restored.session.state.pendingBattle).toBeUndefined();
    expect(restored.session.state.attackCanceledUids).toEqual([firstAttacker!.uid]);
    expect(restored.session.state.cards.find((card) => card.uid === negateAttack!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.skippedPhases).toEqual([{ player: 0, phase: "battle", remaining: 1 }]);
    expect(queryPublicState(restored.session)).toMatchObject({ phase: "battle", waitingFor: 0, windowKind: "open" });
    expect(getLuaRestoreLegalActions(restored, 0).some((action) => action.type === "declareAttack" && action.attackerUid === secondAttacker!.uid)).toBe(false);

    const main2 = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "changePhase" && action.phase === "main2");
    expect(main2).toBeDefined();
    const advanced = applyLuaRestoreResponse(restored, main2!);
    expect(advanced.ok, advanced.error).toBe(true);
    expect(restored.session.state.phase).toBe("main2");
    expect(restored.session.state.skippedPhases).toEqual([]);
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
