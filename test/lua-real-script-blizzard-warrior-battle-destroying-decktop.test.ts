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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Blizzard Warrior battle-destroying Deck-top confirm", () => {
  it("restores its battle-destroying trigger through Deck-top confirmation and SelectOption", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const blizzardWarriorCode = "96565487";
    const battleTargetCode = "96565488";
    const topDeckCode = "96565489";
    const bottomDeckCode = "96565490";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === blizzardWarriorCode),
      { code: battleTargetCode, name: "Blizzard Warrior Battle Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: topDeckCode, name: "Blizzard Warrior Confirmed Top", kind: "monster", typeFlags: 0x1, level: 4, attack: 900, defense: 900 },
      { code: bottomDeckCode, name: "Blizzard Warrior Deck Bottom", kind: "monster", typeFlags: 0x1, level: 4, attack: 800, defense: 800 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 965, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [blizzardWarriorCode] }, 1: { main: [battleTargetCode, topDeckCode, bottomDeckCode] } });
    startDuel(session);

    const blizzardWarrior = session.state.cards.find((card) => card.code === blizzardWarriorCode);
    const battleTarget = session.state.cards.find((card) => card.code === battleTargetCode);
    expect(blizzardWarrior).toBeDefined();
    expect(battleTarget).toBeDefined();
    moveDuelCard(session.state, blizzardWarrior!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, battleTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    const expectedTopDeck = session.state.cards
      .filter((card) => card.controller === 1 && card.location === "deck")
      .sort((left, right) => left.sequence - right.sequence)
      .map((card) => card.code);
    expect(expectedTopDeck).toHaveLength(2);
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(blizzardWarriorCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === blizzardWarrior!.uid && action.targetUid === battleTarget!.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    passBattleResponses(session);

    expect(session.state.cards.find((card) => card.uid === battleTarget!.uid)).toMatchObject({ location: "graveyard", controller: 1, reasonCardUid: blizzardWarrior!.uid });
    expect(session.state.pendingTriggers).toEqual([
      {
        effectId: "lua-1-1139",
        eventCardUid: blizzardWarrior!.uid,
        eventCode: 1140,
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventName: "battleDestroyed",
        eventPlayer: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventReason: 33,
        eventReasonCardUid: blizzardWarrior!.uid,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        id: "trigger-6-1",
        player: 0,
        sourceUid: blizzardWarrior!.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);

    const trigger = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateTrigger" && action.uid === blizzardWarrior!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    const activated = applyLuaRestoreResponse(restored, trigger!);
    expect(activated.ok, activated.error).toBe(true);
    resolveRestoredChain(restored);

    expect(restored.host.messages).toContain(`confirmed 0: ${expectedTopDeck[0]}`);
    expect(restored.host.promptDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        api: "SelectOption",
        player: 0,
        options: [0, 1],
        returned: 0,
      }),
    ]));
    expect(restored.session.state.pendingTriggers).toEqual([]);
    expect(restored.session.state.currentAttack).toBeUndefined();
    expect(restored.session.state.pendingBattle).toBeUndefined();
    expect(
      restored.session.state.cards
        .filter((card) => card.controller === 1 && card.location === "deck")
        .sort((left, right) => left.sequence - right.sequence)
        .map((card) => card.code),
    ).toEqual(expectedTopDeck);
    const confirmedCard = restored.session.state.cards.find((card) => card.code === expectedTopDeck[0]);
    expect(confirmedCard).toBeDefined();
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "confirmed")).toEqual([
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventCardUid: confirmedCard!.uid,
        eventPreviousState: {
          controller: 1,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: confirmedCard!.sequence,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: confirmedCard!.sequence,
        },
        eventPlayer: 0,
        eventValue: 1,
        eventUids: [confirmedCard!.uid],
      },
    ]);
  });
});

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
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

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
