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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Naturia Spiderfang attack announce lock", () => {
  it("restores its custom-activity conditioned attack-announcement lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const spiderfangCode = "25654671";
    const ordinaryCode = "25654672";
    const targetCode = "25654673";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === spiderfangCode),
      { code: ordinaryCode, name: "Spiderfang Ordinary Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 1600, defense: 1000 },
      { code: targetCode, name: "Spiderfang Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 2565, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [spiderfangCode, ordinaryCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const spiderfang = requireCard(session, spiderfangCode);
    const ordinary = requireCard(session, ordinaryCode);
    const target = requireCard(session, targetCode);
    moveFaceUpAttack(session, spiderfang, 0);
    moveFaceUpAttack(session, ordinary, 0);
    moveFaceUpAttack(session, target, 1);
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(spiderfangCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 86 && effect.sourceUid === spiderfang.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 86,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-1-86",
        "luaTypeFlags": 1,
        "oncePerTurn": false,
        "operation": [Function],
        "range": [
          "monsterZone",
        ],
        "registryKey": "lua:25654671:lua-1-86",
        "sourceUid": "p0-deck-25654671-0",
        "target": [Function],
      }
    `);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const actions = getLuaRestoreLegalActions(restored, 0);
    expect(hasAttack(actions, spiderfang.uid, target.uid)).toBe(false);
    expect(hasAttack(actions, ordinary.uid, target.uid)).toBe(true);
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

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
