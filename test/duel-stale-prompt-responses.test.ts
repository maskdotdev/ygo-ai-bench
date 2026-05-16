import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelEffectDefinition } from "#duel/types.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel stale prompt responses", () => {
  it("rejects stale select-option responses after the prompt resolves", () => {
    const session = createDuel({ seed: 107, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);
    session.state.prompt = { id: "stale-option-prompt", type: "selectOption", player: 1, options: [1, 3], returnTo: 0 };
    session.state.waitingFor = 1;

    const staleOption = getDuelLegalActions(session, 1).find((action) => action.type === "selectOption" && action.option === 3);
    expect(staleOption).toBeDefined();
    expect(applyResponse(session, staleOption!).ok).toBe(true);
    const replay = applyResponse(session, staleOption!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(replay.legalActions).toEqual(getDuelLegalActions(session, 0));
    expect(replay.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(replay.legalActionGroups.flatMap((group) => group.actions)).toEqual(replay.legalActions);
    expect(session.state.prompt).toBeUndefined();
    expect(session.state.waitingFor).toBe(0);
    expect(session.state.log.filter((entry) => entry.action === "selectOption" && entry.detail === "Selected option 3")).toHaveLength(1);
  });

  it("rejects stale yes-no responses after the prompt resolves", () => {
    const session = createDuel({ seed: 108, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);
    session.state.prompt = { id: "stale-yes-no-prompt", type: "selectYesNo", player: 0, description: 456, returnTo: 1 };
    session.state.waitingFor = 0;

    const staleNo = getDuelLegalActions(session, 0).find((action) => action.type === "selectYesNo" && !action.yes);
    expect(staleNo).toBeDefined();
    expect(applyResponse(session, staleNo!).ok).toBe(true);
    const replay = applyResponse(session, staleNo!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(replay.legalActions).toEqual(getDuelLegalActions(session, 1));
    expect(replay.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, 1));
    expect(replay.legalActionGroups.flatMap((group) => group.actions)).toEqual(replay.legalActions);
    expect(session.state.prompt).toBeUndefined();
    expect(session.state.waitingFor).toBe(1);
    expect(session.state.log.filter((entry) => entry.action === "selectYesNo" && entry.detail === "Selected no")).toHaveLength(1);
  });

  it("rejects stale prompt responses captured before snapshot restore", () => {
    const session = createDuel({ seed: 109, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);
    const quickSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand");
    expect(quickSource).toBeDefined();
    registerEffect(session, openOnlyQuickEffect("restore-prompt-open-quick", quickSource!.uid, "Restored prompt open quick resolved"));
    session.state.prompt = { id: "restore-stale-option-prompt", type: "selectOption", player: 1, options: [2, 4], returnTo: 0 };
    session.state.waitingFor = 1;

    const staleOption = getDuelLegalActions(session, 1).find((action) => action.type === "selectOption" && action.option === 4);
    expect(staleOption).toBeDefined();
    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restore-prompt-open-quick": restoreOpenOnlyQuickEffect("Restored prompt open quick resolved"),
    });
    const restoredOption = getDuelLegalActions(restored, 1).find((action) => action.type === "selectOption" && action.option === 2);
    expect(restoredOption).toBeDefined();
    expect(restoredOption).toMatchObject({ windowId: queryPublicState(restored).actionWindowId, windowKind: "prompt" });
    expect(restoredOption!.windowToken).toBeDefined();
    expect(getGroupedDuelLegalActions(restored, 1)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        windowId: queryPublicState(restored).actionWindowId,
        windowKind: "prompt",
        promptId: "restore-stale-option-prompt",
        promptType: "selectOption",
      }),
    ]));
    const staleBeforeSelection = applyResponse(restored, { ...restoredOption!, windowId: restoredOption!.windowId! - 1 });
    expect(staleBeforeSelection.ok).toBe(false);
    expect(staleBeforeSelection.error).toContain("Response is not currently legal");
    expect(staleBeforeSelection.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleBeforeSelection.legalActions).toEqual(getDuelLegalActions(restored, 1));
    expect(staleBeforeSelection.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 1));
    expect(staleBeforeSelection.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleBeforeSelection.legalActions);
    expect(restored.state.prompt).toMatchObject({ id: "restore-stale-option-prompt", type: "selectOption", player: 1 });
    expect(restored.state.log.some((entry) => entry.action === "selectOption")).toBe(false);
    const forgedOption = applyResponse(restored, {
      ...restoredOption!,
      option: 9,
      label: "Forge invalid option into restored prompt",
    });
    expect(forgedOption.ok).toBe(false);
    expect(forgedOption.error).toContain("Response is not currently legal");
    expect(forgedOption.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(forgedOption.legalActions).toEqual(getDuelLegalActions(restored, 1));
    expect(forgedOption.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 1));
    expect(forgedOption.legalActionGroups.flatMap((group) => group.actions)).toEqual(forgedOption.legalActions);
    expect(restored.state.prompt).toMatchObject({ id: "restore-stale-option-prompt", type: "selectOption", player: 1 });
    expect(restored.state.log.some((entry) => entry.action === "selectOption")).toBe(false);
    const optionResult = applyResponse(restored, restoredOption!);
    expect(optionResult.ok).toBe(true);
    expect(optionResult.state).toMatchObject({ waitingFor: 0, windowKind: "open" });
    expect(optionResult.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", player: 0, effectId: "restore-prompt-open-quick", windowKind: "open" })]));
    expect(optionResult.legalActions).toEqual(getDuelLegalActions(restored, optionResult.state.waitingFor!));
    expect(optionResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, optionResult.state.waitingFor!));
    expect(optionResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(optionResult.legalActions);
    expect(getDuelLegalActions(restored, 1)).toEqual([]);
    const replay = applyResponse(restored, staleOption!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(replay.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(replay.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
    expect(replay.legalActionGroups.flatMap((group) => group.actions)).toEqual(replay.legalActions);
    expect(restored.state.prompt).toBeUndefined();
    expect(restored.state.log.filter((entry) => entry.action === "selectOption" && entry.detail === "Selected option 2")).toHaveLength(1);
    expect(restored.state.log.some((entry) => entry.action === "selectOption" && entry.detail === "Selected option 4")).toBe(false);
    expect(restored.state.log.some((entry) => entry.detail === "Restored prompt open quick resolved")).toBe(false);
  });

  it("rejects stale yes-no responses captured before snapshot restore", () => {
    const session = createDuel({ seed: 110, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);
    const quickSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand");
    expect(quickSource).toBeDefined();
    registerEffect(session, openOnlyQuickEffect("restore-yes-no-open-quick", quickSource!.uid, 1, "Restored yes-no open quick resolved"));
    session.state.prompt = { id: "restore-stale-yes-no-prompt", type: "selectYesNo", player: 0, description: 789, returnTo: 1 };
    session.state.waitingFor = 0;

    const staleNo = getDuelLegalActions(session, 0).find((action) => action.type === "selectYesNo" && !action.yes);
    expect(staleNo).toBeDefined();
    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restore-yes-no-open-quick": restoreOpenOnlyQuickEffect("Restored yes-no open quick resolved"),
    });
    const restoredYes = getDuelLegalActions(restored, 0).find((action) => action.type === "selectYesNo" && action.yes);
    expect(restoredYes).toBeDefined();
    expect(restoredYes).toMatchObject({ windowId: queryPublicState(restored).actionWindowId, windowKind: "prompt" });
    expect(restoredYes!.windowToken).toBeDefined();
    expect(getGroupedDuelLegalActions(restored, 0)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        windowId: queryPublicState(restored).actionWindowId,
        windowKind: "prompt",
        promptId: "restore-stale-yes-no-prompt",
        promptType: "selectYesNo",
      }),
    ]));
    const staleBeforeSelection = applyResponse(restored, { ...restoredYes!, windowId: restoredYes!.windowId! - 1 });
    expect(staleBeforeSelection.ok).toBe(false);
    expect(staleBeforeSelection.error).toContain("Response is not currently legal");
    expect(staleBeforeSelection.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleBeforeSelection.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(staleBeforeSelection.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
    expect(staleBeforeSelection.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleBeforeSelection.legalActions);
    expect(restored.state.prompt).toMatchObject({ id: "restore-stale-yes-no-prompt", type: "selectYesNo", player: 0 });
    expect(restored.state.log.some((entry) => entry.action === "selectYesNo")).toBe(false);
    const forgedPromptId = applyResponse(restored, {
      ...restoredYes!,
      promptId: "forged-restore-stale-yes-no-prompt",
      label: "Forge prompt id into restored yes-no prompt",
    });
    expect(forgedPromptId.ok).toBe(false);
    expect(forgedPromptId.error).toContain("Response is not currently legal");
    expect(forgedPromptId.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(forgedPromptId.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(forgedPromptId.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
    expect(forgedPromptId.legalActionGroups.flatMap((group) => group.actions)).toEqual(forgedPromptId.legalActions);
    expect(restored.state.prompt).toMatchObject({ id: "restore-stale-yes-no-prompt", type: "selectYesNo", player: 0 });
    expect(restored.state.log.some((entry) => entry.action === "selectYesNo")).toBe(false);
    const yesResult = applyResponse(restored, restoredYes!);
    expect(yesResult.ok).toBe(true);
    expect(yesResult.state).toMatchObject({ waitingFor: 1, windowKind: "open" });
    expect(yesResult.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", player: 1, effectId: "restore-yes-no-open-quick", windowKind: "open" })]));
    expect(yesResult.legalActions).toEqual(getDuelLegalActions(restored, yesResult.state.waitingFor!));
    expect(yesResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, yesResult.state.waitingFor!));
    expect(yesResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(yesResult.legalActions);
    expect(getDuelLegalActions(restored, 0)).toEqual([]);
    const replay = applyResponse(restored, staleNo!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(replay.legalActions).toEqual(getDuelLegalActions(restored, 1));
    expect(replay.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 1));
    expect(replay.legalActionGroups.flatMap((group) => group.actions)).toEqual(replay.legalActions);
    expect(restored.state.prompt).toBeUndefined();
    expect(restored.state.waitingFor).toBe(1);
    expect(restored.state.log.filter((entry) => entry.action === "selectYesNo" && entry.detail === "Selected yes")).toHaveLength(1);
    expect(restored.state.log.some((entry) => entry.action === "selectYesNo" && entry.detail === "Selected no")).toBe(false);
    expect(restored.state.log.some((entry) => entry.detail === "Restored yes-no open quick resolved")).toBe(false);
  });
});

function openOnlyQuickEffect(id: string, sourceUid: string, controllerOrDetail: 0 | 1 | string, maybeDetail?: string): DuelEffectDefinition {
  const controller = typeof controllerOrDetail === "number" ? controllerOrDetail : 0;
  const detail = maybeDetail ?? String(controllerOrDetail);
  return {
    id,
    registryKey: id,
    sourceUid,
    controller,
    event: "quick",
    range: ["hand"],
    canActivate(ctx) {
      return ctx.duel.chain.length === 0;
    },
    operation(ctx) {
      ctx.log(detail);
    },
  };
}

function restoreOpenOnlyQuickEffect(detail: string): (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition {
  return (effect) => ({
    ...effect,
    canActivate(ctx) {
      return ctx.duel.chain.length === 0;
    },
    operation(ctx) {
      ctx.log(detail);
    },
  });
}
