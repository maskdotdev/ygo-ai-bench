import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelEffectDefinition } from "#duel/types.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("chain action restore", () => {
  it("restores chain response legal actions and resolves the chain after a restored pass", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const quickSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(source).toBeTruthy();
    expect(quickSource).toBeTruthy();
    registerEffect(session, chainEffect("restore-pass-original", source!.uid, 0, "ignition", "Restored pass original resolved"));
    registerEffect(session, chainEffect("restore-pass-quick", quickSource!.uid, 1, "quick", "Restored pass quick resolved"));

    const original = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-pass-original");
    expect(original).toBeTruthy();
    expect(applyResponse(session, original!).state.chain).toHaveLength(1);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restore-pass-original": restoreChainEffect("Restored pass original resolved"),
      "restore-pass-quick": restoreChainEffect("Restored pass quick resolved"),
    });
    expect(restored.state.chain).toEqual(session.state.chain);
    expect(getDuelLegalActions(restored, 1)).toEqual(getDuelLegalActions(session, 1));
    expect(getGroupedDuelLegalActions(restored, 1)).toEqual(getGroupedDuelLegalActions(session, 1));
    const pass = getDuelLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    expect(pass).toMatchObject({ windowId: queryPublicState(restored).actionWindowId, windowKind: "chainResponse" });

    const result = applyResponse(restored, pass!);
    expect(result.ok).toBe(true);
    expect(result.state.chain).toHaveLength(0);
    expect(result.state.waitingFor).toBeDefined();
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.state.log.some((entry) => entry.detail === "Restored pass original resolved")).toBe(true);
    expect(result.state.log.some((entry) => entry.detail === "Restored pass quick resolved")).toBe(false);
    const staleResult = applyResponse(restored, pass!);
    expect(staleResult.ok).toBe(false);
    expect(staleResult.error).toContain("Response is not currently legal");
    expect(staleResult.state.actionWindowId).toBe(restored.state.actionWindowId);
  });
});

function chainEffect(id: string, sourceUid: string, controller: 0 | 1, event: "ignition" | "quick", detail: string): DuelEffectDefinition {
  return {
    id,
    registryKey: id,
    sourceUid,
    controller,
    event,
    range: ["hand"],
    operation(ctx) {
      ctx.log(detail);
    },
  };
}

function restoreChainEffect(detail: string): (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition {
  return (effect) => ({
    ...effect,
    operation(ctx) {
      ctx.log(detail);
    },
  });
}
