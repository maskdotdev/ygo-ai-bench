import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelEffectDefinition } from "#duel/types.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("chain action restore", () => {
  it("restores chain response legal actions and resolves the chain after a restored pass", () => {
    const { session, restored } = setupRestoredChainResponse("pass");
    expect(restored.state.chain).toEqual(session.state.chain);
    expect(getDuelLegalActions(restored, 1)).toEqual(getDuelLegalActions(session, 1));
    expect(getGroupedDuelLegalActions(restored, 1)).toEqual(getGroupedDuelLegalActions(session, 1));
    const pass = getDuelLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    expect(pass).toMatchObject({ windowId: queryPublicState(restored).actionWindowId, windowKind: "chainResponse" });
    expect(chainResponseGroups(restored, 1)).toEqual([
      { label: "Effects", windowId: queryPublicState(restored).actionWindowId, windowKind: "chainResponse", actionTypes: ["activateEffect"] },
      { label: "Pass", windowId: queryPublicState(restored).actionWindowId, windowKind: "chainResponse", actionTypes: ["passChain"] },
    ]);

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

  it("restores chain response quick actions and rejects stale restored quick actions", () => {
    const { session, restored } = setupRestoredChainResponse("quick");
    expect(restored.state.chain).toEqual(session.state.chain);
    const quick = getDuelLegalActions(restored, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-quick-response");
    expect(quick).toBeDefined();
    expect(quick).toMatchObject({ windowId: queryPublicState(restored).actionWindowId, windowKind: "chainResponse" });
    expect(chainResponseGroups(restored, 1)).toEqual([
      { label: "Effects", windowId: queryPublicState(restored).actionWindowId, windowKind: "chainResponse", actionTypes: ["activateEffect"] },
      { label: "Pass", windowId: queryPublicState(restored).actionWindowId, windowKind: "chainResponse", actionTypes: ["passChain"] },
    ]);

    const result = applyResponse(restored, quick!);
    expect(result.ok).toBe(true);
    expect(result.state.chain).toHaveLength(2);
    expect(result.state.waitingFor).toBe(1);
    expect(result.state.log.some((entry) => entry.detail === "Restored quick original resolved")).toBe(false);
    expect(result.state.log.some((entry) => entry.detail === "Restored quick quick resolved")).toBe(false);
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, result.state.waitingFor!));
    expect(chainResponseGroups(restored, 1)).toEqual([
      { label: "Effects", windowId: queryPublicState(restored).actionWindowId, windowKind: "chainResponse", actionTypes: ["activateEffect"] },
      { label: "Pass", windowId: queryPublicState(restored).actionWindowId, windowKind: "chainResponse", actionTypes: ["passChain"] },
    ]);
    const staleResult = applyResponse(restored, quick!);
    expect(staleResult.ok).toBe(false);
    expect(staleResult.error).toContain("Response is not currently legal");
    expect(staleResult.state.actionWindowId).toBe(restored.state.actionWindowId);

    const pass = getDuelLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyResponse(restored, pass!);
    expect(resolved.ok).toBe(true);
    expect(resolved.state.chain).toHaveLength(0);
    expect(resolved.state.log.some((entry) => entry.detail === "Restored quick original resolved")).toBe(true);
    expect(resolved.state.log.some((entry) => entry.detail === "Restored quick quick resolved")).toBe(true);
  });
});

function chainResponseGroups(session: ReturnType<typeof setupRestoredChainResponse>["restored"], player: 0 | 1) {
  return getGroupedDuelLegalActions(session, player).map((group) => ({
    label: group.label,
    windowId: group.windowId,
    windowKind: group.windowKind,
    actionTypes: group.actions.map((action) => action.type),
  }));
}

function setupRestoredChainResponse(kind: "pass" | "quick") {
  const session = createDuel({ seed: kind === "pass" ? 1 : 2, startingHandSize: 2, cardReader: createCardReader(cards) });
  loadDecks(session, {
    0: { main: ["100", "300"] },
    1: { main: ["400", "500"] },
  });
  startDuel(session);

  const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
  const quickSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
  expect(source).toBeTruthy();
  expect(quickSource).toBeTruthy();
  registerEffect(session, chainEffect(`restore-${kind}-original`, source!.uid, 0, "ignition", `Restored ${kind} original resolved`));
  registerEffect(session, chainEffect(`restore-${kind}-response`, quickSource!.uid, 1, "quick", `Restored ${kind} quick resolved`));

  const original = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === `restore-${kind}-original`);
  expect(original).toBeTruthy();
  expect(applyResponse(session, original!).state.chain).toHaveLength(1);

  const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
    [`restore-${kind}-original`]: restoreChainEffect(`Restored ${kind} original resolved`),
    [`restore-${kind}-response`]: restoreChainEffect(`Restored ${kind} quick resolved`),
  });
  return { session, restored };
}

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
