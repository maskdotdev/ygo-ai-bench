import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelCardInstance, DuelEffectContext } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const locationHand = 0x02;
const discardEffectReason = duelReason.discard | duelReason.effect;

function conditionContext(duel: DuelEffectContext["duel"], source: DuelCardInstance): DuelEffectContext {
  return {
    duel,
    source,
    player: source.controller,
    targetUids: [],
    log: () => {},
    moveCard: () => source,
    negateChainLink: () => false,
    setTargets: () => {},
    getTargets: () => [],
    setTargetPlayer: () => {},
    setTargetParam: () => {},
  };
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script source previous location event reason-all player condition", () => {
  it("restores opponent-caused GetPreviousLocation event reason-all checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const minarCode = "32539892";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === minarCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 3253, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [minarCode] }, 1: { main: [] } });
    startDuel(session);

    const minar = session.state.cards.find((card) => card.code === minarCode);
    expect(minar).toBeDefined();
    moveDuelCard(session.state, minar!.uid, "hand", 0);
    moveDuelCard(session.state, minar!.uid, "graveyard", 0, discardEffectReason, 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(minarCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const descriptor = `condition:source-previous-location-reason-all-player:${locationHand}:${discardEffectReason}:opponent`;
    expect(
      session.state.effects.filter(
        (effect) => effect.luaConditionDescriptor === descriptor && effect.sourceUid === minar!.uid,
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "category": 524288,
          "code": 1014,
          "controller": 0,
          "cost": [Function],
          "description": 520638272,
          "event": "trigger",
          "id": "lua-1-1014",
          "luaConditionDescriptor": "condition:source-previous-location-reason-all-player:2:16448:opponent",
          "luaTypeFlags": 513,
          "oncePerTurn": false,
          "operation": [Function],
          "optional": false,
          "promptOperation": [Function],
          "property": 2048,
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
          "registryKey": "lua:32539892:lua-1-1014",
          "sourceUid": "p0-deck-32539892-0",
          "target": [Function],
          "targetCardPredicate": [Function],
          "triggerCode": 1014,
          "triggerEvent": "sentToGraveyard",
          "triggerSourceOnly": true,
          "triggerTiming": "when",
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
    const restoredMinar = restored.session.state.cards.find((card) => card.code === minarCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === minar!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = conditionContext(restored.session.state, restoredMinar!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredMinar!.reasonPlayer = 0;
    expect(effect!.canActivate!(ctx)).toBe(false);
    expect(effect!.canActivate!({ ...ctx, eventReasonPlayer: 1 })).toBe(true);
    restoredMinar!.reasonPlayer = 1;
    restoredMinar!.reason = duelReason.discard;
    expect(effect!.canActivate!(ctx)).toBe(false);
    expect(effect!.canActivate!({ ...ctx, eventReason: discardEffectReason })).toBe(true);
    restoredMinar!.reason = discardEffectReason;
    restoredMinar!.previousLocation = "deck";
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});
