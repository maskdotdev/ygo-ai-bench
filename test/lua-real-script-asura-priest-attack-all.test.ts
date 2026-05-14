import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Asura Priest attack all", () => {
  it("restores its Spirit attack-all effect and lets it attack each monster with battle damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const asuraCode = "2134346";
    const firstTargetCode = "2134347";
    const secondTargetCode = "2134348";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === asuraCode),
      { code: firstTargetCode, name: "First Asura Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: secondTargetCode, name: "Second Asura Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 213, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [asuraCode] }, 1: { main: [firstTargetCode, secondTargetCode] } });
    startDuel(session);

    const asura = session.state.cards.find((card) => card.code === asuraCode);
    const firstTarget = session.state.cards.find((card) => card.code === firstTargetCode);
    const secondTarget = session.state.cards.find((card) => card.code === secondTargetCode);
    expect(asura).toBeDefined();
    expect(firstTarget).toBeDefined();
    expect(secondTarget).toBeDefined();
    moveDuelCard(session.state, asura!.uid, "monsterZone", 0);
    asura!.position = "faceUpAttack";
    asura!.faceUp = true;
    moveDuelCard(session.state, firstTarget!.uid, "monsterZone", 1);
    firstTarget!.position = "faceUpAttack";
    firstTarget!.faceUp = true;
    moveDuelCard(session.state, secondTarget!.uid, "monsterZone", 1);
    secondTarget!.position = "faceUpAttack";
    secondTarget!.faceUp = true;
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(asuraCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredSetup = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredSetup.restoreComplete, restoredSetup.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSetup.missingRegistryKeys).toEqual([]);
    expect(restoredSetup.session.state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ event: "continuous", code: 193, sourceUid: asura!.uid })]));
    const openingActions = getLuaRestoreLegalActions(restoredSetup, 0);
    expect(hasAttack(openingActions, asura!.uid, firstTarget!.uid)).toBe(true);
    expect(hasAttack(openingActions, asura!.uid, secondTarget!.uid)).toBe(true);
    expect(hasDirectAttack(openingActions, asura!.uid)).toBe(false);

    const firstAttack = openingActions.find((action) => action.type === "declareAttack" && action.attackerUid === asura!.uid && action.targetUid === firstTarget!.uid);
    expect(firstAttack, JSON.stringify(openingActions, null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSetup, firstAttack!);
    passBattleResponses(restoredSetup);
    expect(restoredSetup.session.state.cards.find((card) => card.uid === firstTarget!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredSetup.session.state.cards.find((card) => card.uid === asura!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredSetup.session.state.players[1].lifePoints).toBe(7300);

    const restoredSecondAttack = restoreDuelWithLuaScripts(serializeDuel(restoredSetup.session), workspace, reader);
    expect(restoredSecondAttack.restoreComplete, restoredSecondAttack.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSecondAttack.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredSecondAttack, 0)).toEqual(getGroupedDuelLegalActions(restoredSecondAttack.session, 0));
    expect(getLuaRestoreLegalActions(restoredSecondAttack, 0)).toEqual(getDuelLegalActions(restoredSecondAttack.session, 0));
    const secondActions = getLuaRestoreLegalActions(restoredSecondAttack, 0);
    expect(hasAttack(secondActions, asura!.uid, firstTarget!.uid)).toBe(false);
    expect(hasAttack(secondActions, asura!.uid, secondTarget!.uid)).toBe(true);
    expect(hasDirectAttack(secondActions, asura!.uid)).toBe(false);

    const secondAttack = secondActions.find((action) => action.type === "declareAttack" && action.attackerUid === asura!.uid && action.targetUid === secondTarget!.uid);
    expect(secondAttack, JSON.stringify(secondActions, null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSecondAttack, secondAttack!);
    passBattleResponses(restoredSecondAttack);
    expect(restoredSecondAttack.session.state.cards.find((card) => card.uid === secondTarget!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredSecondAttack.session.state.cards.find((card) => card.uid === asura!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredSecondAttack.session.state.players[1].lifePoints).toBe(6600);
    expect(getLuaRestoreLegalActions(restoredSecondAttack, 0)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "declareAttack", attackerUid: asura!.uid })]),
    );
  });
});

function hasAttack(actions: DuelAction[], attackerUid: string, targetUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid);
}

function hasDirectAttack(actions: DuelAction[], attackerUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.directAttack === true && action.targetUid === undefined);
}

function passBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}
