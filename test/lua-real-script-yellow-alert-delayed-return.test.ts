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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Intruder Alarm - Yellow Alert delayed return", () => {
  it("restores the temporary battle target lock and returns the summoned monster at the end of the Battle Phase", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const yellowAlertCode = "59277750";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === yellowAlertCode),
      { code: "100", name: "Yellow Alert First Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 500, defense: 500 },
      { code: "101", name: "Yellow Alert Second Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 1500, defense: 1000 },
      { code: "200", name: "Yellow Alert Original Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 2000, defense: 2000 },
      { code: "300", name: "Yellow Alert Hand Summon", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 592, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["100", "101"] }, 1: { main: [yellowAlertCode, "200", "300"] } });
    startDuel(session);

    const firstAttacker = session.state.cards.find((card) => card.code === "100");
    const secondAttacker = session.state.cards.find((card) => card.code === "101");
    const originalTarget = session.state.cards.find((card) => card.code === "200");
    const summonedTarget = session.state.cards.find((card) => card.code === "300");
    const yellowAlert = session.state.cards.find((card) => card.code === yellowAlertCode);
    expect(firstAttacker).toBeDefined();
    expect(secondAttacker).toBeDefined();
    expect(originalTarget).toBeDefined();
    expect(summonedTarget).toBeDefined();
    expect(yellowAlert).toBeDefined();
    for (const attacker of [firstAttacker!, secondAttacker!]) moveDuelCard(session.state, attacker.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, originalTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, summonedTarget!.uid, "hand", 1);
    moveDuelCard(session.state, yellowAlert!.uid, "spellTrapZone", 1);
    yellowAlert!.position = "faceDown";
    yellowAlert!.faceUp = false;
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(yellowAlertCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === firstAttacker!.uid && action.targetUid === originalTarget!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    if (session.state.waitingFor === 0) {
      const turnPlayerPass = getLegalActions(session, 0).find((action) => action.type === "passAttack");
      expect(turnPlayerPass).toBeDefined();
      applyAndAssert(session, turnPlayerPass!);
    }
    const yellowAlertAction = getLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.uid === yellowAlert!.uid);
    expect(yellowAlertAction).toBeDefined();
    if (!yellowAlertAction || yellowAlertAction.type !== "activateEffect") throw new Error("Expected Yellow Alert activation action");
    const delayedFieldId = 1;
    applyAndAssert(session, yellowAlertAction!);
    const passChain = getLegalActions(session, 0).find((action) => action.type === "passChain");
    if (passChain) applyAndAssert(session, passChain);
    passBattleResponses(session);

    expect(session.state.cards.find((card) => card.uid === summonedTarget!.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(session.state.cards.find((card) => card.uid === yellowAlert!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 0x1080,
          sourceUid: yellowAlert!.uid,
          label: delayedFieldId,
        }),
        expect.objectContaining({ event: "continuous", code: 332, sourceUid: summonedTarget!.uid, luaValueDescriptor: "value-card:not-handler" }),
      ]),
    );
    expectAttackTarget(session, secondAttacker!.uid, summonedTarget!.uid, true);
    expectAttackTarget(session, secondAttacker!.uid, originalTarget!.uid, false);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 0x1080,
          sourceUid: yellowAlert!.uid,
          label: delayedFieldId,
        }),
      ]),
    );
    expectAttackTarget(restored.session, secondAttacker!.uid, summonedTarget!.uid, true);
    expectAttackTarget(restored.session, secondAttacker!.uid, originalTarget!.uid, false);

    const main2 = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "changePhase" && action.phase === "main2");
    expect(main2).toBeDefined();
    const phaseChanged = applyLuaRestoreResponse(restored, main2!);
    expect(phaseChanged.ok, phaseChanged.error).toBe(true);
    expect(restored.session.state.cards.find((card) => card.uid === summonedTarget!.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restored.session.state.effects).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ event: "continuous", code: 332, sourceUid: summonedTarget!.uid })]),
    );
  });
});

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const actions = getLegalActions(session, player);
    const action = actions.find((candidate) => candidate.type === passType) ?? actions.find((candidate) => candidate.type === "cancelAttack");
    expect(action, JSON.stringify({ player, battleStep: session.state.battleStep, actions })).toBeDefined();
    applyAndAssert(session, action!);
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
