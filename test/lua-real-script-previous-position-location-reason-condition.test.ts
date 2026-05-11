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
const positionFaceUpAttack = 0x1;
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script previous position location reason condition", () => {
  it("restores previous-position current-location battle-reason checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const wispCode = "70546737";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === wispCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 8247, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [wispCode] }, 1: { main: [] } });
    startDuel(session);

    const wisp = session.state.cards.find((card) => card.code === wispCode);
    expect(wisp).toBeDefined();
    moveDuelCard(session.state, wisp!.uid, "monsterZone", 0);
    wisp!.position = "faceUpAttack";
    moveDuelCard(session.state, wisp!.uid, "graveyard", 0, duelReason.battle, 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(wispCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: `condition:source-previous-position-location-reason:${positionFaceUpAttack}:${locationGraveyard}:${duelReason.battle}`,
          sourceUid: wisp!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredWisp = restored.session.state.cards.find((card) => card.code === wispCode);
    const descriptor = `condition:source-previous-position-location-reason:${positionFaceUpAttack}:${locationGraveyard}:${duelReason.battle}`;
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === wisp!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = conditionContext(restored.session.state, restoredWisp!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredWisp!.previousPosition = "faceUpDefense";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredWisp!.previousPosition = "faceUpAttack";
    restoredWisp!.reason = duelReason.effect;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredWisp!.reason = duelReason.battle;
    restoredWisp!.location = "monsterZone";
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});
