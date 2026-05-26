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
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Enraged Battle Ox pierce", () => {
  it("restores Enraged Battle Ox's field piercing effect and applies it only to matching attackers", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const oxCode = "76909279";
    const beastCode = "7690";
    const spellcasterCode = "7691";
    const beastTargetCode = "7692";
    const spellcasterTargetCode = "7693";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === oxCode),
      { code: beastCode, name: "Enraged Battle Ox Fixture Beast", kind: "monster", typeFlags: 0x1, level: 4, race: 0x4000, attack: 2200, defense: 1200 },
      { code: spellcasterCode, name: "Enraged Battle Ox Fixture Spellcaster", kind: "monster", typeFlags: 0x1, level: 4, race: 0x2, attack: 2200, defense: 1200 },
      { code: beastTargetCode, name: "Enraged Battle Ox Beast Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 900, defense: 1500 },
      { code: spellcasterTargetCode, name: "Enraged Battle Ox Spellcaster Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 900, defense: 1500 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 769, startingHandSize: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [oxCode, beastCode, spellcasterCode] },
      1: { main: [beastTargetCode, spellcasterTargetCode] },
    });
    startDuel(session);

    const ox = session.state.cards.find((card) => card.code === oxCode);
    const beast = session.state.cards.find((card) => card.code === beastCode);
    const spellcaster = session.state.cards.find((card) => card.code === spellcasterCode);
    const beastTarget = session.state.cards.find((card) => card.code === beastTargetCode);
    const spellcasterTarget = session.state.cards.find((card) => card.code === spellcasterTargetCode);
    expect(ox).toBeDefined();
    expect(beast).toBeDefined();
    expect(spellcaster).toBeDefined();
    expect(beastTarget).toBeDefined();
    expect(spellcasterTarget).toBeDefined();
    moveDuelCard(session.state, ox!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, beast!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, spellcaster!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, beastTarget!.uid, "monsterZone", 1).position = "faceUpDefense";
    moveDuelCard(session.state, spellcasterTarget!.uid, "monsterZone", 1).position = "faceUpDefense";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(oxCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 203 && effect.sourceUid === ox!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 203,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-1-203",
        "luaTargetDescriptor": "target:race:49664",
        "luaTypeFlags": 2,
        "oncePerTurn": false,
        "operation": [Function],
        "promptOperation": [Function],
        "range": [
          "monsterZone",
        ],
        "registryKey": "lua:76909279:lua-1-203",
        "sourceUid": "p0-deck-76909279-0",
        "target": [Function],
        "targetCardPredicate": [Function],
        "targetRange": [
          4,
          0,
        ],
      }
    `);

    const beastAttack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === beast!.uid && action.targetUid === beastTarget!.uid);
    expect(beastAttack).toBeDefined();
    applyAndAssert(session, beastAttack!);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 203 && effect.sourceUid === ox!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 203,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-1-203",
        "luaTargetDescriptor": "target:race:49664",
        "luaTypeFlags": 2,
        "oncePerTurn": false,
        "operation": [Function],
        "range": [
          "monsterZone",
        ],
        "registryKey": "lua:76909279:lua-1-203",
        "sourceUid": "p0-deck-76909279-0",
        "target": [Function],
        "targetCardPredicate": [Function],
        "targetRange": [
          4,
          0,
        ],
      }
    `);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    passBattleResponses(restored.session);
    expect(restored.session.state.battleDamage[1]).toBe(700);
    expect(restored.session.state.players[1].lifePoints).toBe(7300);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: beast!.uid,
        eventPlayer: 1,
        eventValue: 700,
        eventReason: duelReason.battle,
        eventReasonCardUid: beast!.uid,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 2,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 1,
        },
      },
    ]);
    expect(restored.session.state.cards.find((card) => card.uid === beastTarget!.uid)).toMatchObject({ location: "graveyard", controller: 1 });

    const spellcasterAttack = getLegalActions(restored.session, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === spellcaster!.uid && action.targetUid === spellcasterTarget!.uid,
    );
    expect(spellcasterAttack).toBeDefined();
    applyAndAssert(restored.session, spellcasterAttack!);
    passBattleResponses(restored.session);
    expect(restored.session.state.battleDamage[1]).toBe(0);
    expect(restored.session.state.players[1].lifePoints).toBe(7300);
    expect(restored.session.state.cards.find((card) => card.uid === spellcasterTarget!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
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

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
