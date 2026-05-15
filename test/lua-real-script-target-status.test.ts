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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script target status", () => {
  it("restores target predicates using IsStatus masks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const mammothCode = "59380081";
    const targetCode = "72329844";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => [mammothCode, targetCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7829, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [mammothCode], extra: [targetCode] }, 1: { main: [] } });
    startDuel(session);

    const mammoth = session.state.cards.find((card) => card.code === mammothCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(mammoth).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, mammoth!.uid, "monsterZone", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);
    target!.summonType = "link";

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(mammothCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 85,
          luaTargetDescriptor: `target:status:${statusSummonedThisTurn}`,
          sourceUid: mammoth!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const restoredTarget = restored.session.state.cards.find((card) => card.code === targetCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === mammoth!.uid && candidate.luaTargetDescriptor === `target:status:${statusSummonedThisTurn}`);
    expect(effect?.targetCardPredicate).toBeDefined();
    expect(effect!.targetCardPredicate!({ duel: restored.session.state } as never, restoredTarget!)).toBe(true);
    restoredTarget!.summonType = "normal";
    expect(effect!.targetCardPredicate!({ duel: restored.session.state } as never, restoredTarget!)).toBe(true);
    delete restoredTarget!.summonType;
    expect(effect!.targetCardPredicate!({ duel: restored.session.state } as never, restoredTarget!)).toBe(false);
    restoredTarget!.customStatusMask = 0x20000000;
    expect(effect!.targetCardPredicate!({ duel: restored.session.state } as never, restoredTarget!)).toBe(true);
  });
});
