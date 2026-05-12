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
const locationOnField = 0x0c;

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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script previous controller previous position location reason condition", () => {
  it("restores previous-controller previous-position previous-location reason checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const gigastoneCode = "79080761";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === gigastoneCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7908, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [gigastoneCode] }, 1: { main: [] } });
    startDuel(session);

    const gigastone = session.state.cards.find((card) => card.code === gigastoneCode);
    expect(gigastone).toBeDefined();
    moveDuelCard(session.state, gigastone!.uid, "monsterZone", 0);
    gigastone!.faceUp = true;
    gigastone!.position = "faceUpAttack";
    moveDuelCard(session.state, gigastone!.uid, "graveyard", 0, duelReason.effect);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(gigastoneCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    const descriptor = `condition:source-previous-controller-previous-position-location-reason:${positionFaceUp}:${locationOnField}:${duelReason.effect}`;
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: descriptor,
          sourceUid: gigastone!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredGigastone = restored.session.state.cards.find((card) => card.code === gigastoneCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === gigastone!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = conditionContext(restored.session.state, restoredGigastone!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredGigastone!.previousController = 1;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredGigastone!.previousController = 0;
    restoredGigastone!.previousPosition = "faceDownDefense";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredGigastone!.previousPosition = "faceUpAttack";
    restoredGigastone!.previousLocation = "deck";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredGigastone!.previousLocation = "monsterZone";
    restoredGigastone!.reason = duelReason.battle;
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});
