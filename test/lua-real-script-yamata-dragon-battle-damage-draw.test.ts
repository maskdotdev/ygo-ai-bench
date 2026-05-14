import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Yamata Dragon battle-damage draw", () => {
  it("restores its battle-damage trigger and draws until 5 from CHAININFO_TARGET_PLAYER", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const yamataCode = "76862289";
    const defenderCode = "76862290";
    const handACode = "76862291";
    const handBCode = "76862292";
    const drawACode = "76862293";
    const drawBCode = "76862294";
    const drawCCode = "76862295";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === yamataCode),
      { code: defenderCode, name: "Yamata Battle Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: handACode, name: "Yamata Existing Hand A", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: handBCode, name: "Yamata Existing Hand B", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: drawACode, name: "Yamata Draw A", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: drawBCode, name: "Yamata Draw B", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: drawCCode, name: "Yamata Draw C", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 768, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [yamataCode, handACode, handBCode, drawACode, drawBCode, drawCCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const yamata = session.state.cards.find((card) => card.code === yamataCode);
    const defender = session.state.cards.find((card) => card.code === defenderCode);
    const handA = session.state.cards.find((card) => card.code === handACode);
    const handB = session.state.cards.find((card) => card.code === handBCode);
    const drawA = session.state.cards.find((card) => card.code === drawACode);
    const drawB = session.state.cards.find((card) => card.code === drawBCode);
    const drawC = session.state.cards.find((card) => card.code === drawCCode);
    expect(yamata).toBeDefined();
    expect(defender).toBeDefined();
    expect(handA).toBeDefined();
    expect(handB).toBeDefined();
    expect(drawA).toBeDefined();
    expect(drawB).toBeDefined();
    expect(drawC).toBeDefined();
    moveDuelCard(session.state, yamata!.uid, "monsterZone", 0);
    yamata!.position = "faceUpAttack";
    yamata!.faceUp = true;
    moveDuelCard(session.state, defender!.uid, "monsterZone", 1);
    defender!.position = "faceUpAttack";
    defender!.faceUp = true;
    moveDuelCard(session.state, handA!.uid, "hand", 0);
    moveDuelCard(session.state, handB!.uid, "hand", 0);
    drawA!.sequence = 0;
    drawB!.sequence = 1;
    drawC!.sequence = 2;
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(yamataCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredSetup = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredSetup.restoreComplete, restoredSetup.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSetup.missingRegistryKeys).toEqual([]);
    const attack = getLuaRestoreLegalActions(restoredSetup, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === yamata!.uid && action.targetUid === defender!.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredSetup, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSetup, attack!);
    passBattleUntilTrigger(restoredSetup);
    expect(restoredSetup.session.state.pendingTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceUid: yamata!.uid,
          eventName: "battleDamageDealt",
          eventCode: 1143,
          eventPlayer: 1,
          eventValue: 1600,
        }),
      ]),
    );

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSetup.session), workspace, reader);
    expect(restoredTrigger.restoreComplete, restoredTrigger.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTrigger.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredTrigger, 0)).toEqual(getGroupedDuelLegalActions(restoredTrigger.session, 0));
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === yamata!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);

    for (const card of [handA, handB, drawA, drawB, drawC]) {
      expect(restoredTrigger.session.state.cards.find((candidate) => candidate.uid === card!.uid)).toMatchObject({ location: "hand", controller: 0 });
    }
    expect(restoredTrigger.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventName: "cardsDrawn",
          eventCode: 1110,
          eventPlayer: 0,
          eventValue: 3,
          eventUids: [drawA!.uid, drawB!.uid, drawC!.uid],
        }),
      ]),
    );
  });
});

function passBattleUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
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
