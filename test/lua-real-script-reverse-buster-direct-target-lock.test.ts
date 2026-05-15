import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Reverse Buster direct target lock", () => {
  it("restores cannot-direct and cannot-select face-up battle target locks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const busterCode = "90640901";
    const faceUpTargetCode = "900000590";
    const faceDownTargetCode = "900000591";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === busterCode),
      { code: faceUpTargetCode, name: "Reverse Buster Face-Up Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: faceDownTargetCode, name: "Reverse Buster Face-Down Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 9064, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [busterCode] }, 1: { main: [faceUpTargetCode, faceDownTargetCode] } });
    startDuel(session);

    const buster = requireCard(session, busterCode);
    const faceUpTarget = requireCard(session, faceUpTargetCode);
    const faceDownTarget = requireCard(session, faceDownTargetCode);
    moveFaceUpAttack(session, buster, 0);
    moveFaceUpAttack(session, faceUpTarget, 1);
    moveDuelCard(session.state, faceDownTarget.uid, "monsterZone", 1);
    faceDownTarget.faceUp = false;
    faceDownTarget.position = "faceDownDefense";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(busterCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === buster.uid && [73, 332].includes(effect.code ?? -1))).toMatchInlineSnapshot(`
      [
        {
          "battleDamageValue": [Function],
          "canActivate": [Function],
          "code": 332,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-1-332",
          "lifePointValue": [Function],
          "luaTypeFlags": 1,
          "luaValueDescriptor": "value-card:not-facedown",
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:90640901:lua-1-332",
          "sourceUid": "p0-deck-90640901-0",
          "statValue": [Function],
          "target": [Function],
          "valueCardPredicate": [Function],
          "valuePredicate": [Function],
        },
        {
          "canActivate": [Function],
          "code": 73,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-2-73",
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:90640901:lua-2-73",
          "sourceUid": "p0-deck-90640901-0",
          "target": [Function],
        },
      ]
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    expect(restored.session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 332 && effect.sourceUid === buster.uid)).toMatchObject({
      luaValueDescriptor: "value-card:not-facedown",
    });
    const actions = getLuaRestoreLegalActions(restored, 0);
    expect(hasDirectAttack(actions, buster.uid)).toBe(false);
    expect(hasAttack(actions, buster.uid, faceUpTarget.uid)).toBe(false);
    expect(hasAttack(actions, buster.uid, faceDownTarget.uid)).toBe(true);
  });
});

function moveFaceUpAttack(session: DuelSession, card: DuelSession["state"]["cards"][number], player: 0 | 1): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function hasAttack(actions: DuelAction[], attackerUid: string, targetUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid);
}

function hasDirectAttack(actions: DuelAction[], attackerUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.directAttack);
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
