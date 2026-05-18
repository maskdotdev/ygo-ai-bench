import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Gyroid indestructible count", () => {
  it("restores Gyroid's once-per-turn battle destruction count", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const gyroidCode = "18325492";
    const script = workspace.readScript(`c${gyroidCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_COUNT)");
    expect(script).toContain("e1:SetCountLimit(1)");
    expect(script).toContain("e1:SetValue(s.valcon)");
    expect(script).toContain("return (r&REASON_BATTLE)~=0");

    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === gyroidCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1832, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [gyroidCode] }, 1: { main: [] } });
    startDuel(session);

    const gyroid = session.state.cards.find((card) => card.code === gyroidCode);
    expect(gyroid).toBeDefined();
    moveDuelCard(session.state, gyroid!.uid, "monsterZone", 0);
    gyroid!.faceUp = true;
    gyroid!.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(gyroidCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.sourceUid === gyroid!.uid && effect.code === 47)).toMatchInlineSnapshot(`
      {
        "battleDamageValue": [Function],
        "canActivate": [Function],
        "code": 47,
        "controller": 0,
        "cost": [Function],
        "countLimit": 1,
        "event": "continuous",
        "id": "lua-1-47",
        "lifePointValue": [Function],
        "luaTypeFlags": 1,
        "luaValueDescriptor": "value-predicate:reason-mask:32",
        "oncePerTurn": true,
        "operation": [Function],
        "promptOperation": [Function],
        "property": 131072,
        "range": [
          "monsterZone",
        ],
        "registryKey": "lua:18325492:lua-1-47",
        "sourceUid": "p0-deck-18325492-0",
        "statValue": [Function],
        "target": [Function],
        "valueCardPredicate": [Function],
        "valuePredicate": [Function],
      }
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.effects.find((effect) => effect.sourceUid === gyroid!.uid && effect.code === 47)).toMatchObject({
      countLimit: 1,
      event: "continuous",
      luaValueDescriptor: "value-predicate:reason-mask:32",
      oncePerTurn: true,
      property: 0x20000,
      range: ["monsterZone"],
      registryKey: "lua:18325492:lua-1-47",
    });

    const battleDestroy = destroyDuelCard(restored.session.state, gyroid!.uid, 0, duelReason.battle | duelReason.destroy, 1);
    expect(battleDestroy).toMatchObject({ uid: gyroid!.uid, location: "monsterZone" });
    const secondBattleDestroy = destroyDuelCard(restored.session.state, gyroid!.uid, 0, duelReason.battle | duelReason.destroy, 1);
    expect(secondBattleDestroy).toMatchObject({ uid: gyroid!.uid, location: "graveyard", reason: duelReason.battle | duelReason.destroy });
  });
});
