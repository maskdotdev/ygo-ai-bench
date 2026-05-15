import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const statusSpecialSummonTurn = 0x40000000;
const locationExtra = 0x40;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script target status and summon location", () => {
  it("restores target predicates combining IsStatus and IsSummonLocation", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const legacyCode = "88851326";
    const sprindCode = "72329844";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => [legacyCode, sprindCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7661, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [legacyCode], extra: [sprindCode] }, 1: { main: [] } });
    startDuel(session);

    const legacy = session.state.cards.find((card) => card.code === legacyCode);
    const sprind = session.state.cards.find((card) => card.code === sprindCode);
    expect(legacy).toBeDefined();
    expect(sprind).toBeDefined();
    moveDuelCard(session.state, legacy!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, sprind!.uid, "monsterZone", 0);
    sprind!.summonType = "link";
    sprind!.previousLocation = "extraDeck";

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(legacyCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(
      session.state.effects.filter(
        (effect) =>
          effect.code === 85 &&
          effect.luaTargetDescriptor === `target:status-summon-location:${statusSpecialSummonTurn}:${locationExtra}` &&
          effect.sourceUid === legacy!.uid,
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "code": 85,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-5-85",
          "luaTargetDescriptor": "target:status-summon-location:1073741824:64",
          "luaTypeFlags": 2,
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "range": [
            "spellTrapZone",
          ],
          "registryKey": "lua:88851326:lua-5-85",
          "sourceUid": "p0-deck-88851326-0",
          "target": [Function],
          "targetCardPredicate": [Function],
          "targetRange": [
            4,
            4,
          ],
        },
      ]
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const restoredSprind = restored.session.state.cards.find((card) => card.code === sprindCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === legacy!.uid && candidate.luaTargetDescriptor === `target:status-summon-location:${statusSpecialSummonTurn}:${locationExtra}`);
    expect(effect?.targetCardPredicate).toBeDefined();
    expect(effect!.targetCardPredicate!({ duel: restored.session.state } as never, restoredSprind!)).toBe(true);
    restoredSprind!.previousLocation = "hand";
    expect(effect!.targetCardPredicate!({ duel: restored.session.state } as never, restoredSprind!)).toBe(false);
    restoredSprind!.previousLocation = "extraDeck";
    restoredSprind!.summonType = "normal";
    expect(effect!.targetCardPredicate!({ duel: restored.session.state } as never, restoredSprind!)).toBe(false);
  });
});
