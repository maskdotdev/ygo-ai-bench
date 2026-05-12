import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelCardInstance, DuelEffectContext } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const positionFaceUp = 0x5;
const locationGraveyard = 0x10;

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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script location reason previous position condition", () => {
  it("restores current-location battle-reason previous-position checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const poisonCloudCode = "83982270";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === poisonCloudCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8248, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [poisonCloudCode] }, 1: { main: [] } });
    startDuel(session);

    const poisonCloud = session.state.cards.find((card) => card.code === poisonCloudCode);
    expect(poisonCloud).toBeDefined();
    moveDuelCard(session.state, poisonCloud!.uid, "monsterZone", 0);
    poisonCloud!.position = "faceUpDefense";
    moveDuelCard(session.state, poisonCloud!.uid, "graveyard", 0, duelReason.battle, 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(poisonCloudCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: `condition:source-previous-position-location-reason:${positionFaceUp}:${locationGraveyard}:${duelReason.battle}`,
          sourceUid: poisonCloud!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredPoisonCloud = restored.session.state.cards.find((card) => card.code === poisonCloudCode);
    const descriptor = `condition:source-previous-position-location-reason:${positionFaceUp}:${locationGraveyard}:${duelReason.battle}`;
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === poisonCloud!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = conditionContext(restored.session.state, restoredPoisonCloud!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredPoisonCloud!.previousPosition = "faceDownDefense";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredPoisonCloud!.previousPosition = "faceUpAttack";
    restoredPoisonCloud!.reason = duelReason.effect;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredPoisonCloud!.reason = duelReason.battle;
    restoredPoisonCloud!.location = "monsterZone";
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});
