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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Decoyroid battle target selection lock", () => {
  it("restores its non-Decoyroid battle target selection lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const decoyroidCode = "25034083";
    const attackerCode = "25034084";
    const protectedTargetCode = "25034085";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === decoyroidCode),
      { code: attackerCode, name: "Decoyroid Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 1800, defense: 1000 },
      { code: protectedTargetCode, name: "Decoyroid Protected Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 2503, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [attackerCode] }, 1: { main: [decoyroidCode, protectedTargetCode] } });
    startDuel(session);

    const attacker = requireCard(session, attackerCode);
    const decoyroid = requireCard(session, decoyroidCode);
    const protectedTarget = requireCard(session, protectedTargetCode);
    moveFaceUpAttack(session, attacker, 0);
    moveFaceUpAttack(session, decoyroid, 1);
    moveFaceUpAttack(session, protectedTarget, 1);
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(decoyroidCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 332 && effect.sourceUid === decoyroid.uid)).toMatchInlineSnapshot(`
      {
        "battleDamageValue": [Function],
        "canActivate": [Function],
        "code": 332,
        "controller": 1,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-1-332",
        "lifePointValue": [Function],
        "luaTypeFlags": 2,
        "oncePerTurn": false,
        "operation": [Function],
        "range": [
          "monsterZone",
        ],
        "registryKey": "lua:25034083:lua-1-332",
        "sourceUid": "p1-deck-25034083-0",
        "statValue": [Function],
        "target": [Function],
        "targetRange": [
          0,
          4,
        ],
        "valueCardPredicate": [Function],
        "valuePredicate": [Function],
      }
    `);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const actions = getLuaRestoreLegalActions(restored, 0);
    expect(hasAttack(actions, attacker.uid, decoyroid.uid)).toBe(true);
    expect(hasAttack(actions, attacker.uid, protectedTarget.uid)).toBe(false);
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
