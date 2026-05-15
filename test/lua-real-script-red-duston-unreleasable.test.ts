import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Red Duston unreleasable", () => {
  it("restores official EFFECT_UNRELEASABLE_SUM and EFFECT_UNRELEASABLE_NONSUM release locks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const redDustonCode = "61019812";
    const reader = createCardReader(workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === redDustonCode));
    const session = createDuel({ seed: 610, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [redDustonCode] }, 1: { main: [] } });
    startDuel(session);

    const redDuston = session.state.cards.find((card) => card.code === redDustonCode);
    expect(redDuston).toBeDefined();
    moveDuelCard(session.state, redDuston!.uid, "monsterZone", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(redDustonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === redDuston!.uid && effect.code === 43)).toMatchInlineSnapshot(`
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
          "registryKey": "lua:61019812:lua-1-43",
          "sourceUid": "p0-deck-61019812-0",
          "target": [Function],
          "value": 1,
        },
      ]
    `);
    expect(session.state.effects.filter((effect) => effect.sourceUid === redDuston!.uid && effect.code === 44)).toMatchInlineSnapshot(`
      [
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
          "registryKey": "lua:61019812:lua-2-44",
          "sourceUid": "p0-deck-61019812-0",
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
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );

    const probe = restored.host.loadScript(
      `
      local red=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${redDustonCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Debug.Message("red duston release predicates " .. tostring(Duel.IsPlayerCanRelease(0)) .. "/" .. tostring(Duel.IsPlayerCanRelease(0,red)) .. "/" .. tostring(red:IsReleasable()) .. "/" .. tostring(red:IsReleasableByEffect()))
      Debug.Message("red duston release result " .. Duel.Release(red,REASON_COST))
      `,
      "red-duston-unreleasable-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toContain("red duston release predicates false/false/false/false");
    expect(restored.host.messages).toContain("red duston release result 0");
    expect(restored.session.state.cards.find((card) => card.uid === redDuston!.uid)).toMatchObject({
      location: "monsterZone",
    });
  });
});
