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
    expect(getGroupedDuelLegalActions(restored, 1).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 1));
    const pass = getDuelLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    expect(pass).toMatchObject({ windowId: queryPublicState(restored).actionWindowId, windowKind: "chainResponse" });
    expect(chainResponseGroups(restored, 1)).toEqual([
      { label: "Effects", windowId: queryPublicState(restored).actionWindowId, windowKind: "chainResponse", actionTypes: ["activateEffect"] },
      { label: "Pass", windowId: queryPublicState(restored).actionWindowId, windowKind: "chainResponse", actionTypes: ["passChain"] },
    ]);

    const staleBeforePass = applyResponse(restored, { ...pass!, windowId: pass!.windowId! - 1 });
    expect(staleBeforePass.ok).toBe(false);
    expect(staleBeforePass.error).toContain("Response is not currently legal");
    expect(staleBeforePass.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleBeforePass.legalActions).toEqual(getDuelLegalActions(restored, 1));
    expect(staleBeforePass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 1));
    expect(staleBeforePass.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleBeforePass.legalActions);

    const result = applyResponse(restored, pass!);
    expect(result.ok, result.error).toBe(true);
    expect(result.state.chain).toHaveLength(0);
    expect(result.state.waitingFor).toBeDefined();
    expect(result.legalActions).toEqual(getDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expect(result.state.log.some((entry) => entry.detail === "Restored pass original resolved")).toBe(true);
    expect(result.state.log.some((entry) => entry.detail === "Restored pass quick resolved")).toBe(false);
    const staleResult = applyResponse(restored, pass!);
    expect(staleResult.ok).toBe(false);
    expect(staleResult.error).toContain("Response is not currently legal");
    expect(staleResult.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleResult.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(staleResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
    expect(staleResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleResult.legalActions);
  });

  it("restores chain response quick actions and rejects stale restored quick actions", () => {
    const { session, restored } = setupRestoredChainResponse("quick");
    expect(restored.state.chain).toEqual(session.state.chain);
    expect(getGroupedDuelLegalActions(restored, 1).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 1));
    const quick = getDuelLegalActions(restored, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-quick-response");
    expect(quick).toBeDefined();
    expect(quick).toMatchObject({ windowId: queryPublicState(restored).actionWindowId, windowKind: "chainResponse" });
    expect(chainResponseGroups(restored, 1)).toEqual([
      { label: "Effects", windowId: queryPublicState(restored).actionWindowId, windowKind: "chainResponse", actionTypes: ["activateEffect"] },
      { label: "Pass", windowId: queryPublicState(restored).actionWindowId, windowKind: "chainResponse", actionTypes: ["passChain"] },
    ]);

    const staleBeforeQuick = applyResponse(restored, { ...quick!, windowId: quick!.windowId! - 1 });
    expect(staleBeforeQuick.ok).toBe(false);
    expect(staleBeforeQuick.error).toContain("Response is not currently legal");
    expect(staleBeforeQuick.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleBeforeQuick.legalActions).toEqual(getDuelLegalActions(restored, 1));
    expect(staleBeforeQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 1));
    expect(staleBeforeQuick.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleBeforeQuick.legalActions);

    const result = applyResponse(restored, quick!);
    expect(result.ok, result.error).toBe(true);
    expect(result.state.chain).toHaveLength(2);
    expect(result.state.waitingFor).toBe(1);
    expect(result.state.log.some((entry) => entry.detail === "Restored quick original resolved")).toBe(false);
    expect(result.state.log.some((entry) => entry.detail === "Restored quick quick resolved")).toBe(false);
    expect(result.legalActions).toEqual(getDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expect(chainResponseGroups(restored, 1)).toEqual([
      { label: "Effects", windowId: queryPublicState(restored).actionWindowId, windowKind: "chainResponse", actionTypes: ["activateEffect"] },
      { label: "Pass", windowId: queryPublicState(restored).actionWindowId, windowKind: "chainResponse", actionTypes: ["passChain"] },
    ]);
    const staleResult = applyResponse(restored, quick!);
    expect(staleResult.ok).toBe(false);
    expect(staleResult.error).toContain("Response is not currently legal");
    expect(staleResult.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleResult.legalActions).toEqual(getDuelLegalActions(restored, 1));
    expect(staleResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 1));
    expect(staleResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleResult.legalActions);

    const pass = getDuelLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const staleBeforePass = applyResponse(restored, { ...pass!, windowId: pass!.windowId! - 1 });
    expect(staleBeforePass.ok).toBe(false);
    expect(staleBeforePass.error).toContain("Response is not currently legal");
    expect(staleBeforePass.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleBeforePass.legalActions).toEqual(getDuelLegalActions(restored, 1));
    expect(staleBeforePass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 1));
    expect(staleBeforePass.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleBeforePass.legalActions);

    const resolved = applyResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(resolved.state.chain).toHaveLength(0);
    expect(resolved.state.log.some((entry) => entry.detail === "Restored quick original resolved")).toBe(true);
    expect(resolved.state.log.some((entry) => entry.detail === "Restored quick quick resolved")).toBe(true);
    expect(resolved.legalActions).toEqual(getDuelLegalActions(restored, resolved.state.waitingFor!));
    expect(resolved.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, resolved.state.waitingFor!));
    expect(resolved.legalActionGroups.flatMap((group) => group.actions)).toEqual(resolved.legalActions);
  });

  it("restores self quick response groups after trigger activation", () => {
    const session = createDuel({ seed: 3, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);
    const summoned = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const quickSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(summoned).toBeTruthy();
    expect(triggerSource).toBeTruthy();
    expect(quickSource).toBeTruthy();
    registerEffect(session, chainEffect("restore-self-trigger", triggerSource!.uid, 0, "trigger", "Restored self trigger resolved", "normalSummoned"));
    registerEffect(session, chainEffect("restore-self-quick", quickSource!.uid, 0, "quick", "Restored self quick resolved"));

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeTruthy();
    const summonResponse = applyResponse(session, summon!);
    expect(summonResponse.ok, summonResponse.error).toBe(true);
    expect(summonResponse.legalActions).toEqual(getDuelLegalActions(session, summonResponse.state.waitingFor!));
    expect(summonResponse.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, summonResponse.state.waitingFor!));
    expect(summonResponse.legalActionGroups.flatMap((group) => group.actions)).toEqual(summonResponse.legalActions);
    const trigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-self-trigger");
    expect(trigger).toBeTruthy();
    const triggerResponse = applyResponse(session, trigger!);
    expect(triggerResponse.ok, triggerResponse.error).toBe(true);
    expect(triggerResponse.legalActions).toEqual(getDuelLegalActions(session, triggerResponse.state.waitingFor!));
    expect(triggerResponse.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, triggerResponse.state.waitingFor!));
    expect(triggerResponse.legalActionGroups.flatMap((group) => group.actions)).toEqual(triggerResponse.legalActions);
    expect(queryPublicState(session)).toMatchObject({ windowKind: "chainResponse", waitingFor: 0 });

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restore-self-trigger": restoreChainEffect("Restored self trigger resolved"),
      "restore-self-quick": restoreChainEffect("Restored self quick resolved"),
    });
    expect(queryPublicState(restored)).toMatchObject({ windowKind: "chainResponse", waitingFor: 0 });
    expect(getGroupedDuelLegalActions(restored, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 0));
    expect(chainResponseGroups(restored, 0)).toEqual([
      { label: "Effects", windowId: queryPublicState(restored).actionWindowId, windowKind: "chainResponse", actionTypes: ["activateEffect"] },
      { label: "Pass", windowId: queryPublicState(restored).actionWindowId, windowKind: "chainResponse", actionTypes: ["passChain"] },
    ]);

    const quick = getDuelLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-self-quick");
    expect(quick).toBeDefined();
    const staleBeforeQuick = applyResponse(restored, { ...quick!, windowId: quick!.windowId! - 1 });
    expect(staleBeforeQuick.ok).toBe(false);
    expect(staleBeforeQuick.error).toContain("Response is not currently legal");
    expect(staleBeforeQuick.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleBeforeQuick.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(staleBeforeQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
    expect(staleBeforeQuick.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleBeforeQuick.legalActions);

    const chained = applyResponse(restored, quick!);
    expect(chained.ok, chained.error).toBe(true);
    expect(chained.legalActions).toEqual(getDuelLegalActions(restored, chained.state.waitingFor!));
    expect(chained.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, chained.state.waitingFor!));
    expect(chained.legalActionGroups.flatMap((group) => group.actions)).toEqual(chained.legalActions);
    const staleQuick = applyResponse(restored, quick!);
    expect(staleQuick.ok).toBe(false);
    expect(staleQuick.error).toContain("Response is not currently legal");
    expect(staleQuick.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleQuick.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(staleQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
    expect(staleQuick.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleQuick.legalActions);
  });

  it("returns restored chain resolution to turn-player open fast-effect priority", () => {
    const session = createDuel({ seed: 4, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);
    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const turnQuickSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const opponentQuickSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(source).toBeTruthy();
    expect(turnQuickSource).toBeTruthy();
    expect(opponentQuickSource).toBeTruthy();
    registerEffect(session, chainEffect("restore-open-priority-source", source!.uid, 0, "ignition", "Restored open priority source resolved"));
    registerEffect(session, openOnlyQuickEffect("restore-open-priority-turn-quick", turnQuickSource!.uid, 0, "Restored turn open quick resolved"));
    registerEffect(session, chainOnlyQuickEffect("restore-open-priority-opponent-chain-quick", opponentQuickSource!.uid, 1, "Restored opponent chain quick resolved"));
    registerEffect(session, openOnlyQuickEffect("restore-open-priority-opponent-open-only", opponentQuickSource!.uid, 1, "Restored opponent open-only quick resolved"));

    const original = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-open-priority-source");
    expect(original).toBeTruthy();
    const opened = applyResponse(session, original!);
    expect(opened.ok, opened.error).toBe(true);
    expect(opened.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(opened.legalActions).toEqual(getDuelLegalActions(session, opened.state.waitingFor!));
    expect(opened.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, opened.state.waitingFor!));
    expect(opened.legalActionGroups.flatMap((group) => group.actions)).toEqual(opened.legalActions);
    const pass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restore-open-priority-source": restoreChainEffect("Restored open priority source resolved"),
      "restore-open-priority-turn-quick": restoreOpenOnlyQuickEffect("Restored turn open quick resolved"),
      "restore-open-priority-opponent-chain-quick": restoreChainOnlyQuickEffect("Restored opponent chain quick resolved"),
      "restore-open-priority-opponent-open-only": restoreOpenOnlyQuickEffect("Restored opponent open-only quick resolved"),
    });
    expect(getDuelLegalActions(restored, 1).some((action) => action.type === "activateEffect" && action.effectId === "restore-open-priority-opponent-open-only")).toBe(false);
    const staleBeforePass = applyResponse(restored, { ...pass!, windowId: pass!.windowId! - 1 });
    expect(staleBeforePass.ok).toBe(false);
    expect(staleBeforePass.error).toContain("Response is not currently legal");
    expect(staleBeforePass.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleBeforePass.legalActions).toEqual(getDuelLegalActions(restored, 1));
    expect(staleBeforePass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 1));
    expect(staleBeforePass.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleBeforePass.legalActions);

    const result = applyResponse(restored, pass!);

    expect(result.ok, result.error).toBe(true);
    expect(result.state).toMatchObject({ waitingFor: 0, windowKind: "open" });
    expect(result.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expect(result.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", player: 0, effectId: "restore-open-priority-turn-quick", windowKind: "open" })]));
    expect(getGroupedDuelLegalActions(restored, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 0));
    expect(getDuelLegalActions(restored, 1)).toEqual([]);
    const quick = getDuelLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-open-priority-turn-quick");
    expect(quick).toBeDefined();
    const staleBeforeQuick = applyResponse(restored, { ...quick!, windowId: quick!.windowId! - 1 });
    expect(staleBeforeQuick.ok).toBe(false);
    expect(staleBeforeQuick.error).toContain("Response is not currently legal");
    expect(staleBeforeQuick.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleBeforeQuick.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(staleBeforeQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
    expect(staleBeforeQuick.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleBeforeQuick.legalActions);

    const quickResult = applyResponse(restored, quick!);
    expect(quickResult.ok, quickResult.error).toBe(true);
    expect(quickResult.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(quickResult.legalActions).toEqual(getDuelLegalActions(restored, 1));
    expect(quickResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 1));
    expect(quickResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(quickResult.legalActions);
    expect(quickResult.state.chain.map((link) => link.effectId)).toEqual(["restore-open-priority-turn-quick"]);
    expect(restored.state.log.some((entry) => entry.detail === "Restored turn open quick resolved")).toBe(false);
    const staleQuick = applyResponse(restored, quick!);
    expect(staleQuick.ok).toBe(false);
    expect(staleQuick.error).toContain("Response is not currently legal");
    expect(staleQuick.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleQuick.legalActions).toEqual(getDuelLegalActions(restored, 1));
    expect(staleQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 1));
    expect(staleQuick.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleQuick.legalActions);

    const restoredQuickChain = restoreDuel(serializeDuel(restored), createCardReader(cards), {
      "restore-open-priority-source": restoreChainEffect("Restored open priority source resolved"),
      "restore-open-priority-turn-quick": restoreOpenOnlyQuickEffect("Restored turn open quick resolved"),
      "restore-open-priority-opponent-chain-quick": restoreChainOnlyQuickEffect("Restored opponent chain quick resolved"),
      "restore-open-priority-opponent-open-only": restoreOpenOnlyQuickEffect("Restored opponent open-only quick resolved"),
    });
    expect(restoredQuickChain.state.chain.map((link) => link.effectId)).toEqual(["restore-open-priority-turn-quick"]);
    expect(queryPublicState(restoredQuickChain)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(getDuelLegalActions(restoredQuickChain, 0)).toEqual([]);
    expect(getDuelLegalActions(restoredQuickChain, 1).some((action) => action.type === "activateEffect" && action.effectId === "restore-open-priority-opponent-open-only")).toBe(false);
    const opponentQuick = getDuelLegalActions(restoredQuickChain, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-open-priority-opponent-chain-quick");
    expect(opponentQuick).toBeDefined();
    const staleBeforeOpponentQuick = applyResponse(restoredQuickChain, { ...opponentQuick!, windowId: opponentQuick!.windowId! - 1 });
    expect(staleBeforeOpponentQuick.ok).toBe(false);
    expect(staleBeforeOpponentQuick.error).toContain("Response is not currently legal");
    expect(staleBeforeOpponentQuick.state.actionWindowId).toBe(restoredQuickChain.state.actionWindowId);
    expect(staleBeforeOpponentQuick.legalActions).toEqual(getDuelLegalActions(restoredQuickChain, 1));
    expect(staleBeforeOpponentQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredQuickChain, 1));
    expect(staleBeforeOpponentQuick.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleBeforeOpponentQuick.legalActions);

    const opponentQuickResult = applyResponse(restoredQuickChain, opponentQuick!);
    expect(opponentQuickResult.ok, opponentQuickResult.error).toBe(true);
    expect(opponentQuickResult.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(opponentQuickResult.state.chain.map((link) => link.effectId)).toEqual([
      "restore-open-priority-turn-quick",
      "restore-open-priority-opponent-chain-quick",
    ]);
    expect(opponentQuickResult.legalActions).toEqual(getDuelLegalActions(restoredQuickChain, 1));
    expect(opponentQuickResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredQuickChain, 1));
    expect(opponentQuickResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(opponentQuickResult.legalActions);
    const staleOpponentQuick = applyResponse(restoredQuickChain, opponentQuick!);
    expect(staleOpponentQuick.ok).toBe(false);
    expect(staleOpponentQuick.error).toContain("Response is not currently legal");
    expect(staleOpponentQuick.state.actionWindowId).toBe(restoredQuickChain.state.actionWindowId);
    expect(staleOpponentQuick.legalActions).toEqual(getDuelLegalActions(restoredQuickChain, 1));
    expect(staleOpponentQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredQuickChain, 1));
    expect(staleOpponentQuick.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleOpponentQuick.legalActions);

    const opponentPass = getDuelLegalActions(restoredQuickChain, 1).find((action) => action.type === "passChain");
    expect(opponentPass).toBeDefined();
    const resolvedQuickChain = applyResponse(restoredQuickChain, opponentPass!);
    expect(resolvedQuickChain.ok, resolvedQuickChain.error).toBe(true);
    expect(resolvedQuickChain.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [] });
    expect(resolvedQuickChain.state.log.some((entry) => entry.detail === "Restored turn open quick resolved")).toBe(true);
    expect(resolvedQuickChain.state.log.some((entry) => entry.detail === "Restored opponent chain quick resolved")).toBe(true);
    expect(resolvedQuickChain.legalActions).toEqual(getDuelLegalActions(restoredQuickChain, 0));
    expect(resolvedQuickChain.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredQuickChain, 0));
    expect(resolvedQuickChain.legalActionGroups.flatMap((group) => group.actions)).toEqual(resolvedQuickChain.legalActions);

    const stalePass = applyResponse(restored, pass!);
    expect(stalePass.ok).toBe(false);
    expect(stalePass.error).toContain("Response is not currently legal");
    expect(stalePass.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(stalePass.legalActions).toEqual(getDuelLegalActions(restored, 1));
    expect(stalePass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 1));
    expect(stalePass.legalActionGroups.flatMap((group) => group.actions)).toEqual(stalePass.legalActions);
  });

  it("opens restored chain-ended trigger buckets after resolving a restored chain", () => {
    const session = createDuel({ seed: 5, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);
    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const openQuickSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    const opponentQuickSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(source).toBeTruthy();
    expect(triggerSource).toBeTruthy();
    expect(openQuickSource).toBeTruthy();
    expect(opponentQuickSource).toBeTruthy();
    registerEffect(session, chainEffect("restore-chain-ended-source", source!.uid, 0, "ignition", "Restored chain-ended source resolved"));
    registerEffect(session, { ...chainEffect("restore-chain-ended-trigger", triggerSource!.uid, 0, "trigger", "Restored chain-ended trigger resolved", "chainEnded"), oncePerTurn: true });
    registerEffect(session, openOnlyQuickEffect("restore-chain-ended-open-quick", openQuickSource!.uid, 0, "Restored chain-ended open quick resolved"));
    registerEffect(session, chainOnlyQuickEffect("restore-chain-ended-opponent-quick", opponentQuickSource!.uid, 1, "Restored chain-ended opponent quick resolved"));
    registerEffect(session, openOnlyQuickEffect("restore-chain-ended-opponent-open-only", opponentQuickSource!.uid, 1, "Restored chain-ended opponent open-only resolved"));

    const original = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-chain-ended-source");
    expect(original).toBeTruthy();
    const opened = applyResponse(session, original!);
    expect(opened.ok, opened.error).toBe(true);
    expect(opened.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    const pass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restore-chain-ended-source": restoreChainEffect("Restored chain-ended source resolved"),
      "restore-chain-ended-trigger": restoreChainEffect("Restored chain-ended trigger resolved"),
      "restore-chain-ended-open-quick": restoreOpenOnlyQuickEffect("Restored chain-ended open quick resolved"),
      "restore-chain-ended-opponent-quick": restoreChainOnlyQuickEffect("Restored chain-ended opponent quick resolved"),
      "restore-chain-ended-opponent-open-only": restoreOpenOnlyQuickEffect("Restored chain-ended opponent open-only resolved"),
    });
    const result = applyResponse(restored, pass!);
    expect(result.ok, result.error).toBe(true);
    expect(result.state).toMatchObject({ waitingFor: 0, windowKind: "triggerBucket", chain: [] });
    expect(result.state.pendingTriggers).toEqual([
      expect.objectContaining({ player: 0, effectId: "restore-chain-ended-trigger", eventName: "chainEnded", triggerBucket: "turnOptional" }),
    ]);
    expect(queryPublicState(restored).pendingTriggerBuckets).toEqual([
      { player: 0, triggerBucket: "turnOptional", triggerIds: [result.state.pendingTriggers[0]!.id] },
    ]);
    expect(result.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expect(getDuelLegalActions(restored, 1)).toEqual([]);
    expect(getDuelLegalActions(restored, 0).some((action) => action.type === "activateEffect" && action.effectId === "restore-chain-ended-open-quick")).toBe(false);
    expect(restored.state.log.some((entry) => entry.detail === "Restored chain-ended source resolved")).toBe(true);
    expect(restored.state.log.some((entry) => entry.detail === "Restored chain-ended trigger resolved")).toBe(false);

    const restoredTriggerBucket = restoreDuel(serializeDuel(restored), createCardReader(cards), {
      "restore-chain-ended-source": restoreChainEffect("Restored chain-ended source resolved"),
      "restore-chain-ended-trigger": restoreChainEffect("Restored chain-ended trigger resolved"),
      "restore-chain-ended-open-quick": restoreOpenOnlyQuickEffect("Restored chain-ended open quick resolved"),
      "restore-chain-ended-opponent-quick": restoreChainOnlyQuickEffect("Restored chain-ended opponent quick resolved"),
      "restore-chain-ended-opponent-open-only": restoreOpenOnlyQuickEffect("Restored chain-ended opponent open-only resolved"),
    });
    expect(restoredTriggerBucket.state.pendingTriggers).toEqual(restored.state.pendingTriggers);
    expect(queryPublicState(restoredTriggerBucket)).toMatchObject({ waitingFor: 0, windowKind: "triggerBucket" });
    expect(getGroupedDuelLegalActions(restoredTriggerBucket, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restoredTriggerBucket, 0));
    const trigger = getDuelLegalActions(restoredTriggerBucket, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-chain-ended-trigger");
    expect(trigger).toBeDefined();
    const staleBeforeTrigger = applyResponse(restoredTriggerBucket, { ...trigger!, windowId: trigger!.windowId! - 1 });
    expect(staleBeforeTrigger.ok).toBe(false);
    expect(staleBeforeTrigger.error).toContain("Response is not currently legal");
    expect(staleBeforeTrigger.state.actionWindowId).toBe(restoredTriggerBucket.state.actionWindowId);
    expect(staleBeforeTrigger.legalActions).toEqual(getDuelLegalActions(restoredTriggerBucket, 0));
    expect(staleBeforeTrigger.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredTriggerBucket, 0));
    expect(staleBeforeTrigger.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleBeforeTrigger.legalActions);

    const triggerResult = applyResponse(restoredTriggerBucket, trigger!);
    expect(triggerResult.ok, triggerResult.error).toBe(true);
    expect(triggerResult.state.pendingTriggers).toEqual([]);
    expect(triggerResult.state.chain.map((link) => link.effectId)).toEqual(["restore-chain-ended-trigger"]);
    expect(triggerResult.state.log.some((entry) => entry.detail === "Restored chain-ended trigger resolved")).toBe(false);
    expect(triggerResult.legalActions).toEqual(getDuelLegalActions(restoredTriggerBucket, triggerResult.state.waitingFor!));
    expect(triggerResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredTriggerBucket, triggerResult.state.waitingFor!));
    expect(triggerResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(triggerResult.legalActions);
    const restoredTriggerChain = restoreDuel(serializeDuel(restoredTriggerBucket), createCardReader(cards), {
      "restore-chain-ended-source": restoreChainEffect("Restored chain-ended source resolved"),
      "restore-chain-ended-trigger": restoreChainEffect("Restored chain-ended trigger resolved"),
      "restore-chain-ended-open-quick": restoreOpenOnlyQuickEffect("Restored chain-ended open quick resolved"),
      "restore-chain-ended-opponent-quick": restoreChainOnlyQuickEffect("Restored chain-ended opponent quick resolved"),
      "restore-chain-ended-opponent-open-only": restoreOpenOnlyQuickEffect("Restored chain-ended opponent open-only resolved"),
    });
    expect(queryPublicState(restoredTriggerChain)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(restoredTriggerChain.state.chain.map((link) => link.effectId)).toEqual(["restore-chain-ended-trigger"]);
    expect(getDuelLegalActions(restoredTriggerChain, 1).some((action) => action.type === "activateEffect" && action.effectId === "restore-chain-ended-opponent-quick")).toBe(true);
    expect(getDuelLegalActions(restoredTriggerChain, 1).some((action) => action.type === "activateEffect" && action.effectId === "restore-chain-ended-opponent-open-only")).toBe(false);
    const triggerPass = getDuelLegalActions(restoredTriggerChain, triggerResult.state.waitingFor!).find((action) => action.type === "passChain");
    expect(triggerPass).toBeDefined();
    const staleBeforeTriggerPass = applyResponse(restoredTriggerChain, { ...triggerPass!, windowId: triggerPass!.windowId! - 1 });
    expect(staleBeforeTriggerPass.ok).toBe(false);
    expect(staleBeforeTriggerPass.error).toContain("Response is not currently legal");
    expect(staleBeforeTriggerPass.state.actionWindowId).toBe(restoredTriggerChain.state.actionWindowId);
    expect(staleBeforeTriggerPass.legalActions).toEqual(getDuelLegalActions(restoredTriggerChain, 1));
    expect(staleBeforeTriggerPass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredTriggerChain, 1));
    expect(staleBeforeTriggerPass.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleBeforeTriggerPass.legalActions);

    const resolvedTrigger = applyResponse(restoredTriggerChain, triggerPass!);
    expect(resolvedTrigger.ok, resolvedTrigger.error).toBe(true);
    expect(resolvedTrigger.state.chain).toEqual([]);
    expect(resolvedTrigger.state.log.some((entry) => entry.detail === "Restored chain-ended trigger resolved")).toBe(true);
    expect(resolvedTrigger.state).toMatchObject({ waitingFor: 0, windowKind: "open" });
    expect(resolvedTrigger.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", player: 0, effectId: "restore-chain-ended-open-quick", windowKind: "open" })]));
    expect(getDuelLegalActions(restoredTriggerChain, 1)).toEqual([]);
    expect(resolvedTrigger.legalActions).toEqual(getDuelLegalActions(restoredTriggerChain, resolvedTrigger.state.waitingFor!));
    expect(resolvedTrigger.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredTriggerChain, resolvedTrigger.state.waitingFor!));
    expect(resolvedTrigger.legalActionGroups.flatMap((group) => group.actions)).toEqual(resolvedTrigger.legalActions);
  });

  it("returns restored chain-ended trigger declines to open fast-effect priority", () => {
    const session = createDuel({ seed: 6, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);
    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const openQuickSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    const opponentQuickSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(source).toBeTruthy();
    expect(triggerSource).toBeTruthy();
    expect(openQuickSource).toBeTruthy();
    expect(opponentQuickSource).toBeTruthy();
    registerEffect(session, chainEffect("restore-chain-ended-decline-source", source!.uid, 0, "ignition", "Restored chain-ended decline source resolved"));
    registerEffect(session, chainEffect("restore-chain-ended-decline-trigger", triggerSource!.uid, 0, "trigger", "Restored chain-ended decline trigger resolved", "chainEnded"));
    registerEffect(session, openOnlyQuickEffect("restore-chain-ended-decline-open-quick", openQuickSource!.uid, 0, "Restored chain-ended decline open quick resolved"));
    registerEffect(session, chainOnlyQuickEffect("restore-chain-ended-decline-opponent-quick", opponentQuickSource!.uid, 1, "Restored chain-ended decline opponent quick resolved"));

    const original = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-chain-ended-decline-source");
    expect(original).toBeTruthy();
    const opened = applyResponse(session, original!);
    expect(opened.ok, opened.error).toBe(true);
    const pass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restore-chain-ended-decline-source": restoreChainEffect("Restored chain-ended decline source resolved"),
      "restore-chain-ended-decline-trigger": restoreChainEffect("Restored chain-ended decline trigger resolved"),
      "restore-chain-ended-decline-open-quick": restoreOpenOnlyQuickEffect("Restored chain-ended decline open quick resolved"),
      "restore-chain-ended-decline-opponent-quick": restoreChainOnlyQuickEffect("Restored chain-ended decline opponent quick resolved"),
    });
    const result = applyResponse(restored, pass!);
    expect(result.ok, result.error).toBe(true);
    expect(result.state).toMatchObject({ waitingFor: 0, windowKind: "triggerBucket", chain: [] });
    expect(result.state.pendingTriggers).toEqual([
      expect.objectContaining({ player: 0, effectId: "restore-chain-ended-decline-trigger", eventName: "chainEnded", triggerBucket: "turnOptional" }),
    ]);

    const restoredTriggerBucket = restoreDuel(serializeDuel(restored), createCardReader(cards), {
      "restore-chain-ended-decline-source": restoreChainEffect("Restored chain-ended decline source resolved"),
      "restore-chain-ended-decline-trigger": restoreChainEffect("Restored chain-ended decline trigger resolved"),
      "restore-chain-ended-decline-open-quick": restoreOpenOnlyQuickEffect("Restored chain-ended decline open quick resolved"),
      "restore-chain-ended-decline-opponent-quick": restoreChainOnlyQuickEffect("Restored chain-ended decline opponent quick resolved"),
    });
    const decline = getDuelLegalActions(restoredTriggerBucket, 0).find((action) => action.type === "declineTrigger" && action.effectId === "restore-chain-ended-decline-trigger");
    expect(decline).toBeDefined();
    const staleBeforeDecline = applyResponse(restoredTriggerBucket, { ...decline!, windowId: decline!.windowId! - 1 });
    expect(staleBeforeDecline.ok).toBe(false);
    expect(staleBeforeDecline.error).toContain("Response is not currently legal");
    expect(staleBeforeDecline.state.actionWindowId).toBe(restoredTriggerBucket.state.actionWindowId);
    expect(staleBeforeDecline.legalActions).toEqual(getDuelLegalActions(restoredTriggerBucket, 0));
    expect(staleBeforeDecline.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredTriggerBucket, 0));
    expect(staleBeforeDecline.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleBeforeDecline.legalActions);

    const declined = applyResponse(restoredTriggerBucket, decline!);
    expect(declined.ok, declined.error).toBe(true);
    expect(declined.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [] });
    expect(declined.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", player: 0, effectId: "restore-chain-ended-decline-open-quick", windowKind: "open" })]));
    expect(declined.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-chain-ended-decline-opponent-quick")).toBe(false);
    expect(restoredTriggerBucket.state.log.some((entry) => entry.action === "declineTrigger" && entry.detail === "restore-chain-ended-decline-trigger")).toBe(true);
    expect(restoredTriggerBucket.state.log.some((entry) => entry.detail === "Restored chain-ended decline trigger resolved")).toBe(false);
    expect(getDuelLegalActions(restoredTriggerBucket, 1)).toEqual([]);
    expect(declined.legalActions).toEqual(getDuelLegalActions(restoredTriggerBucket, 0));
    expect(declined.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredTriggerBucket, 0));
    expect(declined.legalActionGroups.flatMap((group) => group.actions)).toEqual(declined.legalActions);
    const staleDecline = applyResponse(restoredTriggerBucket, decline!);
    expect(staleDecline.ok).toBe(false);
    expect(staleDecline.error).toContain("Response is not currently legal");
    expect(staleDecline.state.actionWindowId).toBe(restoredTriggerBucket.state.actionWindowId);
    expect(staleDecline.legalActions).toEqual(getDuelLegalActions(restoredTriggerBucket, 0));
    expect(staleDecline.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredTriggerBucket, 0));
    expect(staleDecline.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleDecline.legalActions);
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
  const opened = applyResponse(session, original!);
  expect(opened.ok, opened.error).toBe(true);
  expect(opened.state.chain).toHaveLength(1);
  expect(opened.legalActions).toEqual(getDuelLegalActions(session, 1));
  expect(opened.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, 1));
  expect(opened.legalActionGroups.flatMap((group) => group.actions)).toEqual(opened.legalActions);

  const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
    [`restore-${kind}-original`]: restoreChainEffect(`Restored ${kind} original resolved`),
    [`restore-${kind}-response`]: restoreChainEffect(`Restored ${kind} quick resolved`),
  });
  return { session, restored };
}

function chainEffect(id: string, sourceUid: string, controller: 0 | 1, event: "ignition" | "quick" | "trigger", detail: string, triggerEvent?: DuelEffectDefinition["triggerEvent"]): DuelEffectDefinition {
  return {
    id,
    registryKey: id,
    sourceUid,
    controller,
    event,
    ...(triggerEvent === undefined ? {} : { triggerEvent }),
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

function openOnlyQuickEffect(id: string, sourceUid: string, controller: 0 | 1, detail: string): DuelEffectDefinition {
  return {
    ...chainEffect(id, sourceUid, controller, "quick", detail),
    canActivate(ctx) {
      return ctx.duel.chain.length === 0;
    },
  };
}

function chainOnlyQuickEffect(id: string, sourceUid: string, controller: 0 | 1, detail: string): DuelEffectDefinition {
  return {
    ...chainEffect(id, sourceUid, controller, "quick", detail),
    canActivate(ctx) {
      return ctx.duel.chain.length > 0;
    },
  };
}

function restoreOpenOnlyQuickEffect(detail: string): (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition {
  return (effect) => ({
    ...restoreChainEffect(detail)(effect),
    canActivate(ctx) {
      return ctx.duel.chain.length === 0;
    },
  });
}

function restoreChainOnlyQuickEffect(detail: string): (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition {
  return (effect) => ({
    ...restoreChainEffect(detail)(effect),
    canActivate(ctx) {
      return ctx.duel.chain.length > 0;
    },
  });
}
