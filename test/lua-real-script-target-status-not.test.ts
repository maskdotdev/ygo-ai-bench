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
const statusSummonedThisTurn = 0x800 | 0x20000000 | 0x40000000;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script target negated status", () => {
  it("restores target predicates using not IsStatus masks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const invitationCode = "86527709";
    const targetCode = "72329844";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => [invitationCode, targetCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7901, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [invitationCode], extra: [targetCode] }, 1: { main: [] } });
    startDuel(session);

    const invitation = session.state.cards.find((card) => card.code === invitationCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(invitation).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, invitation!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(invitationCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(
      session.state.effects.filter(
        (effect) =>
          effect.code === 122 &&
          effect.luaTargetDescriptor === `target:not-status:${statusSummonedThisTurn}` &&
          effect.sourceUid === invitation!.uid,
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "code": 122,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-2-122",
          "luaTargetDescriptor": "target:not-status:1610614784",
          "luaTypeFlags": 2,
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "range": [
            "spellTrapZone",
          ],
          "registryKey": "lua:86527709:lua-2-122",
          "sourceUid": "p0-deck-86527709-0",
          "target": [Function],
          "targetCardPredicate": [Function],
          "targetRange": [
            0,
            4,
          ],
          "value": 2048,
        },
      ]
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const restoredTarget = restored.session.state.cards.find((card) => card.code === targetCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === invitation!.uid && candidate.luaTargetDescriptor === `target:not-status:${statusSummonedThisTurn}`);
    expect(effect?.targetCardPredicate).toBeDefined();
    expect(effect!.targetCardPredicate!({ duel: restored.session.state } as never, restoredTarget!)).toBe(true);
    restoredTarget!.summonType = "link";
    expect(effect!.targetCardPredicate!({ duel: restored.session.state } as never, restoredTarget!)).toBe(false);
    restoredTarget!.summonType = "normal";
    expect(effect!.targetCardPredicate!({ duel: restored.session.state } as never, restoredTarget!)).toBe(false);
    delete restoredTarget!.summonType;
    restoredTarget!.customStatusMask = 0x20;
    expect(effect!.targetCardPredicate!({ duel: restored.session.state } as never, restoredTarget!)).toBe(true);
  });
});
