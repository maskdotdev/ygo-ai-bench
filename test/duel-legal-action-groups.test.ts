import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, groupDuelLegalActions, loadDecks, registerEffect, restoreDuel, runScriptedDuelResponses, selectDuelActionBySelector, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelAction, DuelEffectDefinition } from "#duel/types.js";

describe("duel legal action groups", () => {
  it("groups open-window legal actions while preserving action order", () => {
    const session = createDuel({ seed: 91, startingHandSize: 2 });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["300", "400"] },
    });
    startDuel(session);

    const actions = getDuelLegalActions(session, 0);
    const groups = groupDuelLegalActions(actions);

    expect(groups).toHaveLength(2);
    expect(groups.every((group) => group.windowKind === "open")).toBe(true);
    expect(groups.every((group) => group.windowToken === session.state.actionWindowToken)).toBe(true);
    expect(groups.flatMap((group) => group.actions)).toEqual(actions);
    expect(groups.some((group) => group.label === "Summons")).toBe(true);
    expect(groups.some((group) => group.label === "Turn")).toBe(true);
    expect(getGroupedDuelLegalActions(session, 0)).toEqual(groups);
  });

  it("keeps flip summons with summon actions before manual position changes", () => {
    const session = createDuel({ seed: 101, startingHandSize: 3 });
    loadDecks(session, {
      0: { main: ["100", "200", "500"] },
      1: { main: ["300", "400"] },
    });
    startDuel(session);
    const setMonster = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const positionMonster = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    expect(setMonster).toBeDefined();
    expect(positionMonster).toBeDefined();
    moveDuelCard(session.state, setMonster!.uid, "monsterZone", 0).position = "faceDownDefense";
    moveDuelCard(session.state, positionMonster!.uid, "monsterZone", 0).position = "faceUpAttack";

    const actions = getDuelLegalActions(session, 0);
    const relevantActions = actions.filter((action) => action.type === "normalSummon" || action.type === "setMonster" || action.type === "flipSummon" || action.type === "changePosition");
    expect(relevantActions.map((action) => action.type)).toEqual(["normalSummon", "setMonster", "flipSummon", "changePosition"]);
    expect(getGroupedDuelLegalActions(session, 0).flatMap((group) => group.actions)).toEqual(actions);
  });

  it("groups trigger-bucket activations and declines separately", () => {
    const session = createDuel({ seed: 92, startingHandSize: 2 });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["300", "400"] },
    });
    startDuel(session);
    const watcher = session.state.cards.find((card) => card.code === "100")!;
    registerEffect(session, triggerEffect(watcher.uid));

    sendDuelCardToGraveyard(session.state, session.state.cards.find((card) => card.code === "200")!.uid);
    const actions = getDuelLegalActions(session, 0);
    const groups = groupDuelLegalActions(actions);

    expect(actions.map((action) => action.type).sort()).toEqual(["activateTrigger", "declineTrigger"]);
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.label)).toEqual(["Trigger Activations", "Trigger Declines"]);
    expect(groups.every((group) => group.windowId === session.state.actionWindowId && group.windowKind === "triggerBucket")).toBe(true);
    expect(groups.map((group) => group.triggerBucket)).toEqual([
      { triggerBucket: "turnOptional", player: 0, triggerIds: [actions.find((action) => action.type === "activateTrigger")!.triggerId] },
      { triggerBucket: "turnOptional", player: 0, triggerIds: [actions.find((action) => action.type === "declineTrigger")!.triggerId] },
    ]);
    expect(groups.flatMap((group) => group.actions)).toEqual(actions);
  });

  it("keeps separate pending prompts in separate groups", () => {
    const actions: DuelAction[] = [
      { type: "selectYesNo", player: 0, promptId: "prompt-a", yes: true, label: "Yes", windowId: 4, windowKind: "prompt" },
      { type: "selectYesNo", player: 0, promptId: "prompt-a", yes: false, label: "No", windowId: 4, windowKind: "prompt" },
      { type: "selectOption", player: 0, promptId: "prompt-b", option: 1, label: "Option 1", windowId: 4, windowKind: "prompt" },
    ];

    const groups = groupDuelLegalActions(actions);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.key)).toEqual(["4:prompt:prompt:prompt-a", "4:prompt:prompt:prompt-b"]);
    expect(groups.flatMap((group) => group.actions)).toEqual(actions);
  });

  it("preserves chain-response window metadata on grouped quick effects and passes", () => {
    const actions: DuelAction[] = [
      { type: "activateEffect", player: 1, uid: "quick", effectId: "chain-quick", label: "Quick", windowId: 8, windowKind: "chainResponse", windowToken: "chain-token" },
      { type: "passChain", player: 1, label: "Pass", windowId: 8, windowKind: "chainResponse", windowToken: "chain-token" },
    ];

    const groups = groupDuelLegalActions(actions);

    expect(groups.map((group) => ({ label: group.label, windowId: group.windowId, windowKind: group.windowKind, windowToken: group.windowToken }))).toEqual([
      { label: "Effects", windowId: 8, windowKind: "chainResponse", windowToken: "chain-token" },
      { label: "Pass", windowId: 8, windowKind: "chainResponse", windowToken: "chain-token" },
    ]);
    expect(groups.flatMap((group) => group.actions)).toEqual(actions);
  });

  it("summarizes same-bucket trigger ids on grouped trigger actions", () => {
    const actions: DuelAction[] = [
      { type: "activateTrigger", player: 0, triggerId: "trigger-a", triggerBucket: "turnMandatory", uid: "card-a", effectId: "effect-a", label: "A", windowId: 7, windowKind: "triggerBucket" },
      { type: "activateTrigger", player: 0, triggerId: "trigger-b", triggerBucket: "turnMandatory", uid: "card-b", effectId: "effect-b", label: "B", windowId: 7, windowKind: "triggerBucket" },
      { type: "declineTrigger", player: 0, triggerId: "trigger-c", triggerBucket: "turnOptional", uid: "card-c", effectId: "effect-c", label: "C", windowId: 7, windowKind: "triggerBucket" },
    ];

    const groups = groupDuelLegalActions(actions);

    expect(groups.map((group) => group.triggerBucket)).toEqual([
      { triggerBucket: "turnMandatory", player: 0, triggerIds: ["trigger-a", "trigger-b"] },
      { triggerBucket: "turnOptional", player: 0, triggerIds: ["trigger-c"] },
    ]);
    groups[0]!.triggerBucket!.triggerIds.push("mutated");
    expect(actions.map((action) => action.type === "activateTrigger" || action.type === "declineTrigger" ? action.triggerId : undefined)).toEqual(["trigger-a", "trigger-b", "trigger-c"]);
  });

  it("preserves legal action order for multi-trigger optional buckets", () => {
    const actions: DuelAction[] = [
      { type: "activateTrigger", player: 0, triggerId: "trigger-a", triggerBucket: "turnOptional", uid: "card-a", effectId: "effect-a", label: "A", windowId: 7, windowKind: "triggerBucket" },
      { type: "activateTrigger", player: 0, triggerId: "trigger-b", triggerBucket: "turnOptional", uid: "card-b", effectId: "effect-b", label: "B", windowId: 7, windowKind: "triggerBucket" },
      { type: "declineTrigger", player: 0, triggerId: "trigger-a", triggerBucket: "turnOptional", uid: "card-a", effectId: "effect-a", label: "Decline A", windowId: 7, windowKind: "triggerBucket" },
      { type: "declineTrigger", player: 0, triggerId: "trigger-b", triggerBucket: "turnOptional", uid: "card-b", effectId: "effect-b", label: "Decline B", windowId: 7, windowKind: "triggerBucket" },
    ];

    const groups = groupDuelLegalActions(actions);

    expect(groups.map((group) => group.label)).toEqual(["Trigger Activations", "Trigger Declines"]);
    expect(groups.map((group) => group.triggerBucket)).toEqual([
      { triggerBucket: "turnOptional", player: 0, triggerIds: ["trigger-a", "trigger-b"] },
      { triggerBucket: "turnOptional", player: 0, triggerIds: ["trigger-a", "trigger-b"] },
    ]);
    expect(groups.flatMap((group) => group.actions)).toEqual(actions);
  });

  it("keeps different trigger buckets in separate groups", () => {
    const actions: DuelAction[] = [
      { type: "activateTrigger", player: 0, triggerId: "trigger-a", triggerBucket: "turnMandatory", uid: "card-a", effectId: "effect-a", label: "A", windowId: 7, windowKind: "triggerBucket" },
      { type: "activateTrigger", player: 1, triggerId: "trigger-b", triggerBucket: "opponentMandatory", uid: "card-b", effectId: "effect-b", label: "B", windowId: 7, windowKind: "triggerBucket" },
    ];

    const groups = groupDuelLegalActions(actions);

    expect(groups.map((group) => group.key)).toEqual([
      "7:triggerBucket:trigger-activate:turnMandatory:0",
      "7:triggerBucket:trigger-activate:opponentMandatory:1",
    ]);
    expect(groups.map((group) => group.triggerBucket)).toEqual([
      { triggerBucket: "turnMandatory", player: 0, triggerIds: ["trigger-a"] },
      { triggerBucket: "opponentMandatory", player: 1, triggerIds: ["trigger-b"] },
    ]);
  });

  it("copies grouped action payloads away from the source action list", () => {
    const actions: DuelAction[] = [{ type: "fusionSummon", player: 0, uid: "fusion", materialUids: ["a", "b"], label: "Fusion", windowId: 2, windowKind: "open" }];

    const groups = groupDuelLegalActions(actions);
    const groupedAction = groups[0]?.actions[0];
    expect(groupedAction?.type).toBe("fusionSummon");
    if (!groupedAction || groupedAction.type !== "fusionSummon") throw new Error("Expected grouped fusion action");
    groupedAction.materialUids.push("c");
    groupedAction.label = "Mutated Fusion";

    expect(actions[0]).toEqual({ type: "fusionSummon", player: 0, uid: "fusion", materialUids: ["a", "b"], label: "Fusion", windowId: 2, windowKind: "open" });
  });

  it("returns grouped legal actions after applying a response", () => {
    const session = createDuel({ seed: 93, startingHandSize: 2 });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["300", "400"] },
    });
    startDuel(session);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon")!;

    const result = applyResponse(session, action);

    expect(result.ok).toBe(true);
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  });

  it("returns grouped legal actions after rejecting an illegal response", () => {
    const session = createDuel({ seed: 97, startingHandSize: 2 });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["300", "400"] },
    });
    startDuel(session);

    const result = applyResponse(session, { type: "endTurn", player: 1, label: "End Turn" });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Response is not currently legal");
    expect(result.legalActions).toEqual(getDuelLegalActions(session, 0));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  });

  it("selects legal actions with the same selectors used by parity fixtures", () => {
    const session = createDuel({ seed: 94, startingHandSize: 2 });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["300", "400"] },
    });
    startDuel(session);
    const actions = getDuelLegalActions(session, 0);

    expect(selectDuelActionBySelector(actions, { type: "normalSummon", player: 0, code: "100", location: "hand" }, session.state.cards)).toMatchObject({
      type: "normalSummon",
      player: 0,
    });
    expect(selectDuelActionBySelector(actions, { type: "normalSummon", player: 0, code: "missing", location: "hand" }, session.state.cards)).toBeUndefined();
  });

  it("runs full-duel scripted selectors and reports diverging windows", () => {
    const session = createDuel({ seed: 95, startingHandSize: 2 });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["300", "400"] },
    });
    startDuel(session);

    const success = runScriptedDuelResponses(session, [{ type: "normalSummon", player: 0, code: "100", location: "hand" }]);
    expect(success.ok).toBe(true);
    expect(success.failedStep).toBeUndefined();
    expect(success.legalActionGroups.flatMap((group) => group.actions)).toEqual(success.legalActions);

    const failure = runScriptedDuelResponses(session, [{ type: "normalSummon", player: 0, code: "missing", location: "hand" }]);
    expect(failure.ok).toBe(false);
    expect(failure.failedStep).toBe(0);
    expect(failure.failure).toBe("No legal response matched type=normalSummon player=0 code=missing location=hand");
    expect(failure.divergencePlayer).toBe(0);
    expect(failure.divergenceWindowId).toBe(session.state.actionWindowId);
    expect(failure.divergenceWindowKind).toBe("open");
    expect(failure.divergenceGroupKey).toBe(failure.legalActionGroups[0]?.key);
    expect(failure.divergenceGroupLabel).toBe(failure.legalActionGroups[0]?.label);

    const wrongPlayer = runScriptedDuelResponses(session, [{ type: "normalSummon", player: 1, code: "300", location: "hand" }]);
    expect(wrongPlayer.ok).toBe(false);
    expect(wrongPlayer.failure).toBe("No legal response matched type=normalSummon player=1 code=300 location=hand");
    expect(wrongPlayer.divergencePlayer).toBe(1);
    expect(wrongPlayer.divergenceWindowId).toBe(session.state.actionWindowId);
    expect(wrongPlayer.divergenceWindowKind).toBe("open");
    expect(wrongPlayer.legalActions).toEqual(getDuelLegalActions(session, 1));
    expect(wrongPlayer.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, 1));
    expect(wrongPlayer.legalActionGroups.flatMap((group) => group.actions)).toEqual(wrongPlayer.legalActions);
    expect(wrongPlayer.divergenceGroupKey).toBeUndefined();
    expect(wrongPlayer.divergenceGroupLabel).toBeUndefined();
  });

  it("runs full-duel scripted selectors after snapshot restore", () => {
    const cards = [
      { code: "100", name: "Fixture 100", kind: "monster" as const, attack: 1000, defense: 1000 },
      { code: "200", name: "Fixture 200", kind: "monster" as const, attack: 1000, defense: 1000 },
      { code: "300", name: "Fixture 300", kind: "monster" as const, attack: 1000, defense: 1000 },
      { code: "400", name: "Fixture 400", kind: "monster" as const, attack: 1000, defense: 1000 },
    ];
    const session = createDuel({ seed: 96, startingHandSize: 2 });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["300", "400"] },
    });
    startDuel(session);
    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));

    const result = runScriptedDuelResponses(restored, [{ type: "normalSummon", player: 0, code: "100", location: "hand" }]);

    expect(result.ok).toBe(true);
    expect(result.state.cards).toContainEqual(expect.objectContaining({ code: "100", location: "monsterZone" }));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  });
});

function triggerEffect(sourceUid: string): DuelEffectDefinition {
  return {
    id: "fixture-grouped-trigger",
    sourceUid,
    controller: 0,
    event: "trigger",
    triggerEvent: "sentToGraveyard",
    triggerTiming: "if",
    range: ["hand"],
    operation: (ctx) => ctx.log("Grouped trigger resolved"),
  };
}
