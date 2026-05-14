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
const locationDeck = 0x01;
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script previous controller previous location event reason condition", () => {
  it("restores event-reason previous-controller previous-location checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const cupidVolleyCode = "11851647";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === cupidVolleyCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1185, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [cupidVolleyCode] }, 1: { main: [] } });
    startDuel(session);

    const cupidVolley = session.state.cards.find((card) => card.code === cupidVolleyCode);
    expect(cupidVolley).toBeDefined();
    moveDuelCard(session.state, cupidVolley!.uid, "monsterZone", 0);
    moveDuelCard(session.state, cupidVolley!.uid, "graveyard", 0, duelReason.destroy, 1);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(cupidVolleyCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const descriptor = `condition:source-previous-controller-previous-location-reason:${locationOnField}:${duelReason.destroy}`;
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          luaConditionDescriptor: descriptor,
          sourceUid: cupidVolley!.uid,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredCupidVolley = restored.session.state.cards.find((card) => card.code === cupidVolleyCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === cupidVolley!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = conditionContext(restored.session.state, restoredCupidVolley!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredCupidVolley!.reason = duelReason.effect;
    expect(effect!.canActivate!(ctx)).toBe(false);
    expect(effect!.canActivate!({ ...ctx, eventReason: duelReason.destroy })).toBe(true);
    restoredCupidVolley!.reason = duelReason.destroy;
    restoredCupidVolley!.previousLocation = "hand";
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredCupidVolley!.previousLocation = "monsterZone";
    restoredCupidVolley!.previousController = 1;
    expect(effect!.canActivate!(ctx)).toBe(false);
  });

  it("restores event-reason previous-controller GetPreviousLocation equality checks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const zhugeKongCode = "32422602";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === zhugeKongCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 3242, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [zhugeKongCode] }, 1: { main: [] } });
    startDuel(session);

    const zhugeKong = session.state.cards.find((card) => card.code === zhugeKongCode);
    expect(zhugeKong).toBeDefined();
    moveDuelCard(session.state, zhugeKong!.uid, "hand", 0, duelReason.effect, 0);

    const host = createLuaScriptHost(session, workspace);
    const register = host.loadCardScript(Number(zhugeKongCode), workspace);
    expect(register.ok, register.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const descriptor = `condition:source-previous-controller-previous-location-reason:${locationDeck}:${duelReason.effect}`;
    expect(session.state.effects).toEqual(expect.arrayContaining([expect.objectContaining({ luaConditionDescriptor: descriptor, sourceUid: zhugeKong!.uid })]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredZhugeKong = restored.session.state.cards.find((card) => card.code === zhugeKongCode);
    const effect = restored.session.state.effects.find((candidate) => candidate.sourceUid === zhugeKong!.uid && candidate.luaConditionDescriptor === descriptor);
    expect(effect?.canActivate).toBeDefined();
    const ctx = conditionContext(restored.session.state, restoredZhugeKong!);
    expect(effect!.canActivate!(ctx)).toBe(true);
    restoredZhugeKong!.reason = 0;
    expect(effect!.canActivate!(ctx)).toBe(false);
    restoredZhugeKong!.reason = duelReason.effect;
    restoredZhugeKong!.previousLocation = "hand";
    expect(effect!.canActivate!(ctx)).toBe(false);
  });
});
