import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Berserk Gorilla must attack", () => {
  it("restores official EFFECT_MUST_ATTACK and locks battle progression while an attack is legal", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const gorillaCode = "39168895";
    const targetCode = "900000560";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === gorillaCode),
      { code: targetCode, name: "Must Attack Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 3916, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [gorillaCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const gorilla = session.state.cards.find((card) => card.code === gorillaCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(gorilla).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, gorilla!.uid, "monsterZone", 0);
    gorilla!.faceUp = true;
    gorilla!.position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);
    target!.faceUp = true;
    target!.position = "faceUpAttack";
    session.state.turnPlayer = 0;
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(gorillaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    expect(restored.session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 191 && effect.sourceUid === gorilla!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 191,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-1-191",
        "luaTypeFlags": 1,
        "oncePerTurn": false,
        "operation": [Function],
        "range": [
          "monsterZone",
        ],
        "registryKey": "lua:39168895:lua-1-191",
        "sourceUid": "p0-deck-39168895-0",
        "target": [Function],
      }
    `);
    const actions = getLuaRestoreLegalActions(restored, 0);
    expect(hasAttack(actions, gorilla!.uid, target!.uid)).toBe(true);
    expect(actions.some((action) => action.type === "changePhase")).toBe(false);
    expect(actions.some((action) => action.type === "endTurn")).toBe(false);
  });
});

function hasAttack(actions: DuelAction[], attackerUid: string, targetUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid);
}
