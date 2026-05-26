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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Primite Roar", () => {
  it("restores its announced battle protection, summon, and graveyard banish trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const roarCode = "92501449";
    const darkMagicianCode = "46986414";
    const opponentMonsterCode = "92509000";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [roarCode, darkMagicianCode].includes(card.code)),
      { code: opponentMonsterCode, name: "Primite Roar Banish Target", kind: "monster", typeFlags: 0x21, level: 4, attack: 1800, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 925, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [roarCode, darkMagicianCode] }, 1: { main: [opponentMonsterCode] } });
    startDuel(session);

    const roar = session.state.cards.find((card) => card.code === roarCode);
    const darkMagician = session.state.cards.find((card) => card.code === darkMagicianCode);
    const opponentMonster = session.state.cards.find((card) => card.code === opponentMonsterCode);
    expect(roar).toBeDefined();
    expect(darkMagician).toBeDefined();
    expect(opponentMonster).toBeDefined();
    moveDuelCard(session.state, roar!.uid, "spellTrapZone", 0).position = "faceDown";
    roar!.faceUp = false;
    moveDuelCard(session.state, opponentMonster!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(roarCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === roar!.uid);
    expect(activate).toBeDefined();
    applyAndAssert(session, activate!);
    drainDefaultLuaOperationPrompts(session);
    expect(session.state.players[0].lifePoints).toBe(6000);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredActivation.restoreComplete, restoredActivation.incompleteReasons.join("; ")).toBe(true);
    expect(restoredActivation.missingRegistryKeys).toEqual([]);
    expect(restoredActivation.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredActivation, 1)).toEqual(getGroupedDuelLegalActions(restoredActivation.session, 1));
    resolveOpenChain(restoredActivation.session);
    expect(restoredActivation.session.state.cards.find((card) => card.uid === darkMagician!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
    });
    expect(restoredActivation.session.state.cards.find((card) => card.uid === roar!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredActivation.session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 42 && effect.luaTargetDescriptor === "target:setcode-or-code-type:432:46986414:16")).toMatchInlineSnapshot(`
      {
        "code": 42,
        "controller": 0,
        "event": "continuous",
        "id": "lua-3-42",
        "luaTargetDescriptor": "target:setcode-or-code-type:432:46986414:16",
        "luaTypeFlags": 2,
        "oncePerTurn": false,
        "operation": [Function],
        "ownerPlayer": 0,
        "range": [
          "deck",
          "hand",
          "monsterZone",
          "spellTrapZone",
          "graveyard",
          "banished",
          "extraDeck",
          "overlay",
        ],
        "registryKey": "lua:92501449:lua-3-42",
        "reset": {
          "flags": 1610613248,
        },
        "sourceUid": "p0-deck-92501449-0",
        "targetCardPredicate": [Function],
        "targetRange": [
          4,
          0,
        ],
        "value": 1,
      }
    `);

    const restoredProtection = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), workspace, reader);
    expect(restoredProtection.restoreComplete, restoredProtection.incompleteReasons.join("; ")).toBe(true);
    expect(restoredProtection.missingRegistryKeys).toEqual([]);
    expect(restoredProtection.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredProtection, 0);
    expect(restoredProtection.session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 42 && effect.luaTargetDescriptor === "target:setcode-or-code-type:432:46986414:16")).toMatchInlineSnapshot(`
      {
        "code": 42,
        "controller": 0,
        "event": "continuous",
        "id": "lua-3-42",
        "luaTargetDescriptor": "target:setcode-or-code-type:432:46986414:16",
        "luaTypeFlags": 2,
        "oncePerTurn": false,
        "operation": [Function],
        "ownerPlayer": 0,
        "range": [
          "deck",
          "hand",
          "monsterZone",
          "spellTrapZone",
          "graveyard",
          "banished",
          "extraDeck",
          "overlay",
        ],
        "registryKey": "lua:92501449:lua-3-42",
        "reset": {
          "flags": 1610613248,
        },
        "sourceUid": "p0-deck-92501449-0",
        "targetCardPredicate": [Function],
        "targetRange": [
          4,
          0,
        ],
        "value": 1,
      }
    `);

    restoredProtection.session.state.turnPlayer = 1;
    restoredProtection.session.state.phase = "main1";
    restoredProtection.session.state.waitingFor = 1;
    const normalSummon = getLuaRestoreLegalActions(restoredProtection, 1).find((action) => action.type === "normalSummon" && action.uid === opponentMonster!.uid);
    expect(normalSummon).toBeDefined();
    expect(applyLuaRestoreResponse(restoredProtection, normalSummon!).ok).toBe(true);

    const graveyardTrigger = getLuaRestoreLegalActions(restoredProtection, 0).find((action) => action.type === "activateTrigger" && action.uid === roar!.uid);
    expect(graveyardTrigger).toBeDefined();
    expect(applyLuaRestoreResponse(restoredProtection, graveyardTrigger!).ok).toBe(true);
    expect(restoredProtection.session.state.cards.find((card) => card.uid === roar!.uid)).toMatchObject({ location: "banished" });

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredProtection.session), workspace, reader);
    expect(restoredTrigger.restoreComplete, restoredTrigger.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTrigger.missingRegistryKeys).toEqual([]);
    expect(restoredTrigger.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredTrigger, 1)).toEqual(getGroupedDuelLegalActions(restoredTrigger.session, 1));
    resolveOpenChain(restoredTrigger.session);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === opponentMonster!.uid)).toMatchObject({ location: "banished", faceUp: true });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === roar!.uid)).toMatchObject({ location: "banished" });
  });
});

function resolveOpenChain(session: DuelSession): void {
  for (let index = 0; index < 8 && session.state.chain.length > 0; index += 1) {
    const player = session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLegalActions(session, player!).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    applyAndAssert(session, pass!);
  }
  expect(session.state.chain).toHaveLength(0);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
}

function drainDefaultLuaOperationPrompts(session: DuelSession): void {
  for (let index = 0; index < 8 && session.state.prompt?.origin === "luaOperation"; index += 1) {
    const prompt = session.state.prompt;
    const response = getLegalActions(session, prompt.player).find((action) =>
      prompt.type === "selectOption" ? action.type === "selectOption" && action.option === (prompt.options[0] ?? 0) : action.type === "selectYesNo" && action.yes,
    );
    expect(response).toBeDefined();
    const result = applyResponse(session, response);
    expect(result.ok, result.error).toBe(true);
  }
  expect(session.state.prompt?.origin).not.toBe("luaOperation");
}
