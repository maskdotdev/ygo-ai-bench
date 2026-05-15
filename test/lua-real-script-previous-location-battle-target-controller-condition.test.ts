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
const locationMonsterZone = 0x04;

function targetContext(duel: DuelEffectContext["duel"], source: DuelCardInstance): DuelEffectContext {
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script previous location battle target controller condition", () => {
  it("restores previous MZONE battle-destroyed opponent battle-target checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const dispatchparazziCode = "64966519";
    const targetCode = "72329844";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => [dispatchparazziCode, targetCode].includes(card.code));
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8245, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [targetCode], extra: [dispatchparazziCode] }, 1: { main: [] } });
    startDuel(session);

    const dispatchparazzi = session.state.cards.find((card) => card.code === dispatchparazziCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(dispatchparazzi).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, dispatchparazzi!.uid, "monsterZone", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);
    moveDuelCard(session.state, dispatchparazzi!.uid, "graveyard", 0, duelReason.battle, 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(dispatchparazziCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: `condition:source-battle-target-opponent-previous-location-reason-player:${locationMonsterZone}:${duelReason.battle}:opponent`,
          sourceUid: dispatchparazzi!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(
      getLuaRestoreLegalActions(restored, 0),
    );
    const restoredDispatchparazzi = restored.session.state.cards.find((card) => card.code === dispatchparazziCode);
    const restoredTarget = restored.session.state.cards.find((card) => card.code === targetCode);
    const descriptor = `condition:source-battle-target-opponent-previous-location-reason-player:${locationMonsterZone}:${duelReason.battle}:opponent`;
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === dispatchparazzi!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredDispatchparazzi!);
    expect(effect!.canActivate!(ctx)).toBe(false);
    restored.session.state.currentAttack = { attackerUid: restoredTarget!.uid, targetUid: restoredDispatchparazzi!.uid };
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredDispatchparazzi!.reasonPlayer = 0;
    expect(effect!.canActivate!(ctx)).toBe(false);
    expect(effect!.canActivate!({ ...ctx, eventReasonPlayer: 1 })).toBe(true);
    restoredDispatchparazzi!.reasonPlayer = 1;
    restoredDispatchparazzi!.previousLocation = "hand";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredDispatchparazzi!.previousLocation = "monsterZone";
    restoredTarget!.controller = 0;
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});
