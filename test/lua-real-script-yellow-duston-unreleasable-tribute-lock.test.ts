import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel, tributeSummonDuelCard } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Yellow Duston unreleasable tribute lock", () => {
  it("restores official unreleasable summon lock and removes Tribute Summon actions", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const dustonCode = "16366810";
    const tributeTargetCode = "900000249";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === dustonCode),
      { code: tributeTargetCode, name: "Yellow Duston Tribute Check", kind: "monster", typeFlags: 0x1, level: 5, attack: 2000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 163, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [dustonCode, tributeTargetCode] }, 1: { main: [] } });
    startDuel(session);

    const duston = session.state.cards.find((card) => card.code === dustonCode);
    const tributeTarget = session.state.cards.find((card) => card.code === tributeTargetCode);
    expect(duston).toBeDefined();
    expect(tributeTarget).toBeDefined();
    moveDuelCard(session.state, duston!.uid, "monsterZone", 0);
    duston!.position = "faceUpAttack";
    duston!.faceUp = true;
    moveDuelCard(session.state, tributeTarget!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(dustonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.event === "continuous" && effect.sourceUid === duston!.uid && [43, 44].includes(effect.code ?? -1))).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "code": 43,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-1-43",
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "property": 131072,
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:16366810:lua-1-43",
          "sourceUid": "p0-deck-16366810-0",
          "target": [Function],
          "value": 1,
        },
        {
          "canActivate": [Function],
          "code": 44,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-2-44",
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "property": 131072,
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:16366810:lua-2-44",
          "sourceUid": "p0-deck-16366810-0",
          "target": [Function],
          "value": 1,
        },
      ]
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLegalActions(restored.session, 0).some((action) => action.type === "tributeSummon" && action.uid === tributeTarget!.uid)).toBe(false);
    expect(() => tributeSummonDuelCard(restored.session.state, 0, tributeTarget!.uid, [duston!.uid])).toThrow("cannot be released");
    expect(restored.session.state.cards.find((card) => card.uid === tributeTarget!.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.cards.find((card) => card.uid === duston!.uid)).toMatchObject({ location: "monsterZone" });
  });
});
