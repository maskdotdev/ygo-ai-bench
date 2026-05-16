import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import {
  applyResponse,
  addDuelChainLimit,
  createDuel,
  fusionSummonDuelCard,
  getGroupedDuelLegalActions,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  queryPublicState,
  registerEffect,
  restoreDuel,
  serializeDuel,
  sendDuelCardToGraveyard,
  startDuel,
} from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { luaOptionPromptApis, luaYesNoPromptApis, type LuaPromptDecision } from "#lua/host-types.js";
import { cards, findPublicCard } from "./full-duel-engine-fixtures.js";

describe("duel snapshot persistence", () => {
  it("serializes every initialized duel state key", () => {
    const session = createDuel({ seed: 137, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const snapshot = serializeDuel(session);
    const missingSnapshotKeys = Object.keys(session.state).filter((key) => !(key in snapshot.state));
    const restored = restoreDuel(snapshot, createCardReader(cards));
    const missingRestoredKeys = Object.keys(session.state).filter((key) => !(key in restored.state));

    expect(missingSnapshotKeys).toEqual([]);
    expect(missingRestoredKeys).toEqual([]);
  });

  it("preserves skipped phases across snapshots", () => {
    const session = createDuel({ seed: 122, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    session.state.skippedPhases.push({ player: 0, phase: "battle", remaining: 1 });

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    const next = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "changePhase");

    expect(restored.state.skippedPhases).toEqual([{ player: 0, phase: "battle", remaining: 1 }]);
    expect(next).toMatchObject({ phase: "main2" });
    const nextResult = applyResponse(restored, next!);
    expect(nextResult.ok).toBe(true);
    expect(nextResult.legalActions).toEqual(getDuelLegalActions(restored, nextResult.state.waitingFor!));
    expect(nextResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, nextResult.state.waitingFor!));
    expect(nextResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(nextResult.legalActions);
    expect(restored.state.skippedPhases).toEqual([]);
  });

  it("exposes the active action window in public state", () => {
    const session = createDuel({ seed: 182, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    expect(queryPublicState(session)).toMatchObject({
      actionWindowId: session.state.actionWindowId,
      windowKind: "open",
      waitingFor: 0,
    });
  });

  it("deep-copies replay target sets across snapshots", () => {
    const session = createDuel({ seed: 181, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const attackerUid = session.state.cards[0]!.uid;
    const targetUid = session.state.cards[1]!.uid;
    session.state.phase = "battle";
    session.state.battleStep = "attack";
    session.state.attacksDeclared = [attackerUid];
    session.state.currentAttack = { attackerUid, targetUid, replayTargetCount: 1, replayTargetUids: [targetUid] };
    session.state.pendingBattle = { attackerUid, targetUid, replayTargetCount: 1, replayTargetUids: [targetUid] };

    const snapshot = serializeDuel(session);
    snapshot.state.currentAttack!.replayTargetUids!.push("snapshot-mutation");
    snapshot.state.pendingBattle!.replayTargetUids!.push("snapshot-mutation");
    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    restored.state.currentAttack!.replayTargetUids!.push("restore-mutation");
    restored.state.pendingBattle!.replayTargetUids!.push("restore-mutation");

    expect(session.state.currentAttack.replayTargetUids).toEqual([targetUid]);
    expect(session.state.pendingBattle.replayTargetUids).toEqual([targetUid]);
    expect(serializeDuel(session).state.currentAttack!.replayTargetUids).toEqual([targetUid]);
    expect(serializeDuel(session).state.pendingBattle!.replayTargetUids).toEqual([targetUid]);
  });

  it("keeps internal chain operation overrides out of public and serialized state", () => {
    const session = createDuel({ seed: 128, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    session.state.chain = [
      {
        id: "chain-1",
        player: 0,
        sourceUid: "source",
        effectId: "effect",
        targetUids: ["target-a"],
        operationOverride(ctx) {
          ctx.log("internal override");
        },
      },
    ];

    const publicLink = queryPublicState(session).chain[0] as { operationOverride?: unknown; targetUids?: string[] };
    const serializedLink = serializeDuel(session).state.chain[0] as { operationOverride?: unknown; targetUids?: string[] };

    expect(publicLink.operationOverride).toBeUndefined();
    expect(serializedLink.operationOverride).toBeUndefined();
    publicLink.targetUids!.push("target-b");
    serializedLink.targetUids!.push("target-c");
    expect(session.state.chain[0]?.targetUids).toEqual(["target-a"]);
  });

  it("copies event uid arrays out of public and serialized state", () => {
    const session = createDuel({ seed: 140, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const sourceUid = session.state.cards.find((card) => card.code === "100")!.uid;
    session.state.chain = [{ id: "chain-1", player: 0, sourceUid, effectId: "effect", eventUids: [sourceUid] }];
    session.state.pendingTriggers = [{ id: "trigger-1", player: 0, sourceUid, effectId: "effect", eventName: "customEvent", triggerBucket: "turnOptional", eventUids: [sourceUid] }];
    session.state.eventHistory = [{ eventName: "customEvent", eventUids: [sourceUid] }];

    const publicState = queryPublicState(session);
    const serialized = serializeDuel(session);
    publicState.chain[0]!.eventUids!.push("public-mutation");
    publicState.pendingTriggers[0]!.eventUids!.push("public-mutation");
    serialized.state.chain[0]!.eventUids!.push("serialized-mutation");
    serialized.state.pendingTriggers[0]!.eventUids!.push("serialized-mutation");
    serialized.state.eventHistory[0]!.eventUids!.push("serialized-mutation");

    expect(session.state.chain[0]?.eventUids).toEqual([sourceUid]);
    expect(session.state.pendingTriggers[0]?.eventUids).toEqual([sourceUid]);
    expect(session.state.eventHistory[0]?.eventUids).toEqual([sourceUid]);
  });

  it("exposes pending trigger buckets in public and serialized state", () => {
    const session = createDuel({ seed: 143, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const sourceUid = session.state.cards.find((card) => card.code === "100")!.uid;
    session.state.pendingTriggers = [
      { id: "turn-mandatory", player: 0, sourceUid, effectId: "effect-a", eventName: "customEvent", triggerBucket: "turnMandatory" },
      { id: "turn-optional", player: 0, sourceUid, effectId: "effect-b", eventName: "customEvent", triggerBucket: "turnOptional" },
      { id: "opponent-optional", player: 1, sourceUid, effectId: "effect-c", eventName: "customEvent", triggerBucket: "opponentOptional" },
    ];

    const publicState = queryPublicState(session);
    const serialized = serializeDuel(session);
    publicState.pendingTriggerBuckets[0]!.triggerIds.push("public-mutation");
    serialized.state.pendingTriggerBuckets![1]!.triggerIds.push("serialized-mutation");

    expect(queryPublicState(session).pendingTriggerBuckets).toEqual([
      { triggerBucket: "turnMandatory", player: 0, triggerIds: ["turn-mandatory"] },
      { triggerBucket: "turnOptional", player: 0, triggerIds: ["turn-optional"] },
      { triggerBucket: "opponentOptional", player: 1, triggerIds: ["opponent-optional"] },
    ]);
    expect(serializeDuel(session).state.pendingTriggerBuckets).toEqual(queryPublicState(session).pendingTriggerBuckets);
    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {}, {}, { pruneUnrestoredPendingTriggers: false });
    expect(restored.state.pendingTriggers).toEqual(session.state.pendingTriggers);
    expect("pendingTriggerBuckets" in restored.state).toBe(false);
    expect(queryPublicState(restored).pendingTriggerBuckets).toEqual(queryPublicState(session).pendingTriggerBuckets);
  });

  it("derives trigger order prompt state from restored pending trigger buckets", () => {
    const session = createDuel({ seed: 146, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const sourceUid = session.state.cards.find((card) => card.code === "100")!.uid;
    session.state.status = "awaiting";
    session.state.waitingFor = 0;
    session.state.pendingTriggers = [
      { id: "turn-optional-a", player: 0, sourceUid, effectId: "effect-a", eventName: "customEvent", triggerBucket: "turnOptional" },
      { id: "turn-optional-b", player: 0, sourceUid, effectId: "effect-b", eventName: "customEvent", triggerBucket: "turnOptional" },
      { id: "opponent-optional", player: 1, sourceUid, effectId: "effect-c", eventName: "customEvent", triggerBucket: "opponentOptional" },
    ];

    const publicState = queryPublicState(session);
    const serialized = serializeDuel(session);
    publicState.triggerOrderPrompt!.triggerIds.push("public-mutation");
    const restored = restoreDuel(serialized, createCardReader(cards), {}, {}, { pruneUnrestoredPendingTriggers: false });

    expect(queryPublicState(session).triggerOrderPrompt).toEqual({
      id: `${session.state.actionWindowId}:turnOptional:0`,
      type: "orderTriggers",
      player: 0,
      triggerBucket: "turnOptional",
      triggerIds: ["turn-optional-a", "turn-optional-b"],
    });
    expect("triggerOrderPrompt" in serialized.state).toBe(false);
    expect(queryPublicState(restored).triggerOrderPrompt).toEqual(queryPublicState(session).triggerOrderPrompt);
  });

  it("rejects duplicate pending trigger ids on restore", () => {
    const session = createDuel({ seed: 144, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const sourceUid = session.state.cards.find((card) => card.code === "100")!.uid;
    session.state.pendingTriggers = [
      { id: "duplicate-trigger", player: 0, sourceUid, effectId: "effect-a", eventName: "customEvent", triggerBucket: "turnOptional" },
      { id: "duplicate-trigger", player: 0, sourceUid, effectId: "effect-b", eventName: "customEvent", triggerBucket: "turnOptional" },
    ];

    expect(() => restoreDuel(serializeDuel(session), createCardReader(cards), {}, {}, { pruneUnrestoredPendingTriggers: false })).toThrow(
      "Malformed duel snapshot: state.pendingTriggers.1.id must be unique",
    );
  });

  it("rejects active pending trigger windows outside awaiting status", () => {
    const session = createDuel({ seed: 145, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const sourceUid = session.state.cards.find((card) => card.code === "100")!.uid;
    session.state.pendingTriggers = [{ id: "pending-trigger", player: 0, sourceUid, effectId: "effect", eventName: "customEvent", triggerBucket: "turnOptional" }];
    const snapshot = serializeDuel(session);
    snapshot.state.status = "resolving";

    expect(() => restoreDuel(snapshot, createCardReader(cards), {}, {}, { pruneUnrestoredPendingTriggers: false })).toThrow(
      "Malformed duel snapshot: pending trigger window requires an awaiting duel",
    );
  });

  it("rejects active battle windows with mismatched waiting player", () => {
    const session = createDuel({ seed: 147, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const attackerUid = session.state.cards.find((card) => card.code === "100")!.uid;
    session.state.phase = "battle";
    session.state.waitingFor = 1;
    session.state.attacksDeclared = [attackerUid];
    session.state.currentAttack = { attackerUid };
    session.state.pendingBattle = { attackerUid };
    session.state.battleStep = "damage";
    session.state.battleWindow = { id: session.state.actionWindowId, kind: "startDamageStep", step: "damage", attackerUid, responsePlayer: 1, attackNegated: false };
    const snapshot = serializeDuel(session);
    snapshot.state.waitingFor = 0;

    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: state.waitingFor must match battleWindow.responsePlayer");
  });

  it("rejects active battle windows whose response player already passed", () => {
    const session = createDuel({ seed: 148, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const attackerUid = session.state.cards.find((card) => card.code === "100")!.uid;
    session.state.phase = "battle";
    session.state.waitingFor = 1;
    session.state.attacksDeclared = [attackerUid];
    session.state.currentAttack = { attackerUid };
    session.state.pendingBattle = { attackerUid };
    session.state.battleStep = "damage";
    session.state.battleWindow = { id: session.state.actionWindowId, kind: "startDamageStep", step: "damage", attackerUid, responsePlayer: 1, attackNegated: false };
    const snapshot = serializeDuel(session);
    snapshot.state.damagePasses = [1];

    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleWindow.responsePlayer must not be included in damagePasses");
  });

  it("copies prompt options out of public and serialized state", () => {
    const session = createDuel({ seed: 141, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    session.state.prompt = { id: "snapshot-options", type: "selectOption", player: 0, options: [1, 2], returnTo: 0, origin: "luaOperation" };

    const publicPrompt = queryPublicState(session).prompt;
    const serializedPrompt = serializeDuel(session).state.prompt;
    if (publicPrompt?.type !== "selectOption" || serializedPrompt?.type !== "selectOption") throw new Error("Expected select-option prompts");
    publicPrompt.options.push(3);
    serializedPrompt.options.push(4);

    if (session.state.prompt?.type !== "selectOption") throw new Error("Expected live select-option prompt");
    const freshSerializedPrompt = serializeDuel(session).state.prompt;
    if (freshSerializedPrompt?.type !== "selectOption") throw new Error("Expected fresh serialized select-option prompt");
    expect(session.state.prompt.options).toEqual([1, 2]);
    expect(freshSerializedPrompt.options).toEqual([1, 2]);
    expect(publicPrompt.origin).toBe("luaOperation");
    expect(serializedPrompt.origin).toBe("luaOperation");
    expect(freshSerializedPrompt.origin).toBe("luaOperation");
  });

  it("preserves SelectEffectYesNo Lua operation prompts across snapshots", () => {
    const session = createDuel({ seed: 164, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const sourceUid = session.state.cards.find((card) => card.code === "100")!.uid;
    session.state.status = "awaiting";
    session.state.waitingFor = 0;
    session.state.prompt = { id: "lua-prompt-1", type: "selectYesNo", player: 0, description: 501, returnTo: 0, origin: "luaOperation" };
    session.state.luaOperationPrompt = {
      chainLink: { id: "chain-1", player: 0, sourceUid, effectId: "effect-a" },
      prompt: { id: "lua-prompt-1", api: "SelectEffectYesNo", player: 0, description: 501, returned: true },
    };

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));

    expect(restored.state.prompt).toEqual(session.state.prompt);
    expect(restored.state.luaOperationPrompt).toEqual(session.state.luaOperationPrompt);
  });

  it("preserves AnnounceType Lua operation prompts across snapshots", () => {
    const session = createDuel({ seed: 166, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const sourceUid = session.state.cards.find((card) => card.code === "100")!.uid;
    session.state.status = "awaiting";
    session.state.waitingFor = 0;
    session.state.prompt = { id: "lua-prompt-1", type: "selectOption", player: 0, options: [1, 2], descriptions: [1, 2], returnTo: 0, origin: "luaOperation" };
    session.state.luaOperationPrompt = {
      chainLink: { id: "chain-1", player: 0, sourceUid, effectId: "effect-a" },
      prompt: { id: "lua-prompt-1", api: "AnnounceType", player: 0, options: [1, 2], descriptions: [1, 2], returned: 1 },
    };

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));

    expect(restored.state.prompt).toEqual(session.state.prompt);
    expect(restored.state.luaOperationPrompt).toEqual(session.state.luaOperationPrompt);
  });

  it("preserves every Lua operation prompt API across snapshots", () => {
    const prompts: LuaPromptDecision[] = [
      ...luaOptionPromptApis.map((api, index): LuaPromptDecision => ({
        id: `lua-prompt-${index + 1}`,
        api,
        player: 0,
        options: [index + 1, index + 101],
        descriptions: [index + 1, index + 101],
        returned: index + 1,
      })),
      { id: "lua-prompt-select-codes-index-table", api: "SelectCardsFromCodes", player: 0, options: [1, 2], descriptions: [700, 800], returned: 1, returnKind: "codeIndexTable" },
      {
        id: "lua-prompt-select-codes-multi",
        api: "SelectCardsFromCodes",
        player: 0,
        options: [1, 2],
        descriptions: [700, 700],
        descriptionLists: [[700, 800], [700, 900]],
        returned: 1,
        returnValues: [[700, 800], [700, 900]],
      },
      {
        id: "lua-prompt-select-codes-index-table-multi",
        api: "SelectCardsFromCodes",
        player: 0,
        options: [1, 2],
        descriptions: [700, 700],
        descriptionLists: [[700, 800], [700, 900]],
        returned: 1,
        returnValues: [[{ code: 700, index: 1 }, { code: 800, index: 2 }], [{ code: 700, index: 1 }, { code: 900, index: 3 }]],
      },
      ...luaYesNoPromptApis.map((api, index): LuaPromptDecision => ({
        id: `lua-prompt-yes-no-${index + 1}`,
        api,
        player: 0,
        description: 701 + index,
        returned: index === 0,
      })),
    ];

    for (const [index, luaPrompt] of prompts.entries()) {
      const session = createDuel({ seed: 190 + index, startingHandSize: 1, cardReader: createCardReader(cards) });
      loadDecks(session, {
        0: { main: ["100"] },
        1: { main: ["400"] },
      });
      startDuel(session);
      const sourceUid = session.state.cards.find((card) => card.code === "100")!.uid;
      session.state.status = "awaiting";
      session.state.waitingFor = 0;
      session.state.prompt = "options" in luaPrompt
        ? { id: luaPrompt.id, type: "selectOption", player: 0, options: [...luaPrompt.options], descriptions: [...luaPrompt.descriptions], ...(luaPrompt.descriptionLists === undefined ? {} : { descriptionLists: luaPrompt.descriptionLists.map((descriptions) => [...descriptions]) }), returnTo: 0, origin: "luaOperation" }
        : { id: luaPrompt.id, type: "selectYesNo", player: 0, ...(luaPrompt.description === undefined ? {} : { description: luaPrompt.description }), returnTo: 0, origin: "luaOperation" };
      session.state.luaOperationPrompt = {
        chainLink: { id: `chain-${index + 1}`, player: 0, sourceUid, effectId: "effect-a" },
        prompt: luaPrompt,
      };

      const restored = restoreDuel(serializeDuel(session), createCardReader(cards));

      expect(restored.state.prompt).toEqual(session.state.prompt);
      expect(restored.state.luaOperationPrompt).toEqual(session.state.luaOperationPrompt);
    }
  });

  it("rejects malformed Lua operation prompt payload fields", () => {
    const session = createDuel({ seed: 165, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const sourceUid = session.state.cards.find((card) => card.code === "100")!.uid;
    const snapshot = serializeDuel(session);
    const malformedState = snapshot.state as unknown as { luaOperationPrompt?: unknown };

    const optionPromptWithDescription: unknown = {
      chainLink: { id: "chain-1", player: 0, sourceUid, effectId: "effect-a" },
      prompt: { id: "lua-prompt-1", api: "SelectOption", player: 0, options: [0], descriptions: [101], description: 101, returned: 0 },
    };
    malformedState.luaOperationPrompt = optionPromptWithDescription;
    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: state.luaOperationPrompt.prompt.description is only valid for yes/no prompt APIs");

    const yesNoPromptWithOptions: unknown = {
      chainLink: { id: "chain-1", player: 0, sourceUid, effectId: "effect-a" },
      prompt: { id: "lua-prompt-1", api: "SelectEffectYesNo", player: 0, options: [0], returned: true },
    };
    malformedState.luaOperationPrompt = yesNoPromptWithOptions;
    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: state.luaOperationPrompt.prompt.options is only valid for option-like prompt APIs");

    const optionPromptWithWrongReturnKind: unknown = {
      chainLink: { id: "chain-1", player: 0, sourceUid, effectId: "effect-a" },
      prompt: { id: "lua-prompt-1", api: "SelectOption", player: 0, options: [0], descriptions: [101], returned: 0, returnKind: "codeIndexTable" },
    };
    malformedState.luaOperationPrompt = optionPromptWithWrongReturnKind;
    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: state.luaOperationPrompt.prompt.returnKind must match the Lua prompt api");

    const yesNoPromptWithReturnKind: unknown = {
      chainLink: { id: "chain-1", player: 0, sourceUid, effectId: "effect-a" },
      prompt: { id: "lua-prompt-1", api: "SelectEffectYesNo", player: 0, returned: true, returnKind: "codeIndexTable" },
    };
    malformedState.luaOperationPrompt = yesNoPromptWithReturnKind;
    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: state.luaOperationPrompt.prompt.returnKind is only valid for SelectCardsFromCodes");

    const optionPromptWithMismatchedReturnValues: unknown = {
      chainLink: { id: "chain-1", player: 0, sourceUid, effectId: "effect-a" },
      prompt: { id: "lua-prompt-1", api: "SelectCardsFromCodes", player: 0, options: [1, 2], descriptions: [700, 700], returned: 1, returnValues: [[700, 800]] },
    };
    malformedState.luaOperationPrompt = optionPromptWithMismatchedReturnValues;
    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: state.luaOperationPrompt.prompt.returnValues must match options length");
  });

  it("copies battle response collections out of public and serialized state", () => {
    const session = createDuel({ seed: 142, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const attackerUid = session.state.cards[0]!.uid;
    const targetUid = session.state.cards[1]!.uid;
    session.state.attacksDeclared = [attackerUid];
    session.state.attackCanceledUids = [attackerUid];
    session.state.attackedTargetUids = [targetUid];
    session.state.battlePairs = [{ attackerUid, targetUid }];
    session.state.attackPasses = [0];
    session.state.damagePasses = [1];

    const publicState = queryPublicState(session);
    const serialized = serializeDuel(session);
    publicState.attacksDeclared.push("public-attack");
    publicState.attackCanceledUids.push("public-cancel");
    publicState.attackedTargetUids.push("public-target");
    publicState.battlePairs[0]!.targetUid = "public-target";
    publicState.attackPasses.push(1);
    publicState.damagePasses.push(0);
    serialized.state.attacksDeclared.push("serialized-attack");
    serialized.state.attackCanceledUids.push("serialized-cancel");
    serialized.state.attackedTargetUids.push("serialized-target");
    serialized.state.battlePairs[0]!.targetUid = "serialized-target";
    serialized.state.attackPasses.push(1);
    serialized.state.damagePasses.push(0);

    expect(session.state.attacksDeclared).toEqual([attackerUid]);
    expect(session.state.attackCanceledUids).toEqual([attackerUid]);
    expect(session.state.attackedTargetUids).toEqual([targetUid]);
    expect(session.state.battlePairs).toEqual([{ attackerUid, targetUid }]);
    expect(session.state.attackPasses).toEqual([0]);
    expect(session.state.damagePasses).toEqual([1]);
  });

  it("preserves static continuous effects across snapshots", () => {
    const session = createDuel({ seed: 95, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["900"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const fusion = findPublicCard(session, 0, "extraDeck", "900");
    const blockedMaterial = findPublicCard(session, 0, "hand", "100");
    expect(fusion).toBeTruthy();
    expect(blockedMaterial).toBeTruthy();

    registerEffect(session, {
      id: "snapshot-cannot-be-fusion-material",
      sourceUid: blockedMaterial!.uid,
      controller: 0,
      event: "continuous",
      code: 235,
      range: ["hand"],
      operation() {},
    });

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));

    expect(restored.state.effects).toHaveLength(1);
    expect(restored.state.effects[0]).toMatchObject({ id: "snapshot-cannot-be-fusion-material", event: "continuous", code: 235 });
    expect(getDuelLegalActions(restored, 0).some((candidate) => candidate.type === "fusionSummon" && candidate.uid === fusion!.uid)).toBe(false);
    expect(() =>
      fusionSummonDuelCard(
        restored.state,
        0,
        fusion!.uid,
        restored.state.cards
          .filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "100" || card.code === "300"))
          .map((card) => card.uid),
      ),
    ).toThrow("cannot be used as fusion material");
  });

  it("keeps unregistered continuous effect callbacks out of snapshots", () => {
    const session = createDuel({ seed: 129, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);
    const source = findPublicCard(session, 0, "hand", "100");
    expect(source).toBeTruthy();
    registerEffect(session, {
      id: "snapshot-unregistered-predicate",
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      code: 235,
      range: ["hand"],
      targetCardPredicate: (_ctx, card) => card.uid === source!.uid,
      operation() {},
    });

    const snapshot = serializeDuel(session);
    const restored = restoreDuel(snapshot, createCardReader(cards));

    expect(snapshot.state.effects).toEqual([]);
    expect(restored.state.effects).toEqual([]);
  });

  it("strips registry-backed effect callbacks from snapshot data", () => {
    const session = createDuel({ seed: 130, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const source = findPublicCard(session, 0, "hand", "100");
    expect(source).toBeTruthy();
    registerEffect(session, {
      id: "snapshot-registry-predicate",
      registryKey: "snapshot-registry-predicate",
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      code: 235,
      range: ["hand"],
      targetCardPredicate: (_ctx, card) => card.uid === source!.uid,
      operation() {},
    });

    const serialized = serializeDuel(session).state.effects[0] as {
      operation?: unknown;
      targetCardPredicate?: unknown;
    };

    expect(serialized).toMatchObject({ id: "snapshot-registry-predicate", registryKey: "snapshot-registry-predicate" });
    expect(serialized.operation).toBeUndefined();
    expect(serialized.targetCardPredicate).toBeUndefined();
  });

  it("produces data-only JSON snapshots when live state contains callbacks", () => {
    const session = createDuel({ seed: 131, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const source = findPublicCard(session, 0, "hand", "100");
    expect(source).toBeTruthy();
    registerEffect(session, {
      id: "snapshot-json-effect",
      registryKey: "snapshot-json-effect",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation(ctx) {
        ctx.log("callback should not serialize");
      },
    });
    session.state.chainLimits.push({
      registryKey: "snapshot-json-chain-limit",
      untilChainEnd: true,
      allows: () => false,
      release() {},
    });

    const roundTripped = JSON.parse(JSON.stringify(serializeDuel(session))) as ReturnType<typeof serializeDuel>;

    expect(roundTripped.state.effects[0]).toMatchObject({ id: "snapshot-json-effect", registryKey: "snapshot-json-effect" });
    expect(roundTripped.state.chainLimits[0]).toEqual({ registryKey: "snapshot-json-chain-limit", untilChainEnd: true });
    expect(roundTripped.state.chainLimits[0]).not.toHaveProperty("expiresAtChainLength");
  });

  it("serializes expiring chain limits with their expiry window", () => {
    const session = createDuel({ seed: 132, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["400"] } });
    startDuel(session);
    session.state.chain = [{ id: "chain-1", player: 0, sourceUid: session.state.cards[0]!.uid, effectId: "effect" }];
    addDuelChainLimit(session.state, { registryKey: "snapshot-expiring-chain-limit", untilChainEnd: false, allows: () => false });

    expect(serializeDuel(session).state.chainLimits[0]).toEqual({ registryKey: "snapshot-expiring-chain-limit", untilChainEnd: false, expiresAtChainLength: 2 });
  });

  it("copies nested assumed card state by value across snapshots", () => {
    const session = createDuel({ seed: 126, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const card = session.state.cards.find((candidate) => candidate.code === "100");
    expect(card).toBeTruthy();
    card!.assumedProperties = { 1: 999, 10: 15 };
    card!.uniqueOnField = { self: true, opponent: false, code: 100, locationMask: 0x04 };

    const snapshot = serializeDuel(session);
    card!.assumedProperties[1] = 888;
    card!.uniqueOnField.code = 200;

    const restored = restoreDuel(snapshot, createCardReader(cards));
    const restoredCard = restored.state.cards.find((candidate) => candidate.uid === card!.uid);

    expect(restoredCard?.assumedProperties).toEqual({ 1: 999, 10: 15 });
    expect(restoredCard?.uniqueOnField).toEqual({ self: true, opponent: false, code: 100, locationMask: 0x04 });

    snapshot.state.cards.find((candidate) => candidate.uid === card!.uid)!.assumedProperties![1] = 777;
    snapshot.state.cards.find((candidate) => candidate.uid === card!.uid)!.uniqueOnField!.code = 300;

    expect(restoredCard?.assumedProperties).toEqual({ 1: 999, 10: 15 });
    expect(restoredCard?.uniqueOnField).toEqual({ self: true, opponent: false, code: 100, locationMask: 0x04 });
  });

  it("copies nested card data by value across snapshots", () => {
    const session = createDuel({ seed: 127, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const card = session.state.cards.find((candidate) => candidate.code === "100");
    expect(card).toBeTruthy();
    card!.data = {
      ...card!.data,
      setcodes: [0x10],
      fusionMaterials: ["100", "300"],
      synchroMaterials: { tuner: "100", nonTuners: ["300"] },
      listedNames: ["400"],
    };

    const snapshot = serializeDuel(session);
    card!.data.setcodes!.push(0x20);
    card!.data.fusionMaterials!.push("400");
    card!.data.synchroMaterials!.nonTuners.push("500");
    card!.data.listedNames!.push("500");

    const restored = restoreDuel(snapshot, createCardReader(cards));
    const restoredCard = restored.state.cards.find((candidate) => candidate.uid === card!.uid);

    expect(restoredCard?.data.setcodes).toEqual([0x10]);
    expect(restoredCard?.data.fusionMaterials).toEqual(["100", "300"]);
    expect(restoredCard?.data.synchroMaterials).toEqual({ tuner: "100", nonTuners: ["300"] });
    expect(restoredCard?.data.listedNames).toEqual(["400"]);
  });

  it("restores registry-backed effects across snapshots", () => {
    const session = createDuel({ seed: 96, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const source = findPublicCard(session, 0, "hand", "100");
    expect(source).toBeTruthy();
    registerEffect(session, {
      id: "snapshot-send-self",
      registryKey: "send-self",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation(ctx) {
        sendDuelCardToGraveyard(ctx.duel, ctx.source.uid, ctx.player);
      },
    });

    const withoutRegistry = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(withoutRegistry.state.effects).toHaveLength(0);
    expect(getDuelLegalActions(withoutRegistry, 0).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "snapshot-send-self")).toBe(false);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "send-self": (effect) => ({
        ...effect,
        operation(ctx) {
          sendDuelCardToGraveyard(ctx.duel, ctx.source.uid, ctx.player);
        },
      }),
    });
    const action = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "snapshot-send-self");
    expect(action).toBeTruthy();
    const result = applyResponse(restored, action!);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === source!.uid)?.location).toBe("graveyard");
  });

  it("restores registry-backed chain limits across snapshots", () => {
    const session = createDuel({ seed: 125, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    session.state.chainLimits.push({
      registryKey: "snapshot-chain-limit",
      untilChainEnd: true,
      allows: () => false,
    });

    const withoutRegistry = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(withoutRegistry.state.chainLimits).toEqual([]);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {}, {
      "snapshot-chain-limit": (limit) => ({
        ...limit,
        allows: (effect) => effect.id === "allowed-after-restore",
      }),
    });

    expect(restored.state.chainLimits).toHaveLength(1);
    const restoredLimit = restored.state.chainLimits[0]!;
    expect(restoredLimit).toMatchObject({ registryKey: "snapshot-chain-limit", untilChainEnd: true });
    expect(restoredLimit.allows({ id: "blocked-after-restore", sourceUid: "missing", controller: 0, event: "quick", range: ["hand"], operation() {} }, 0, 0)).toBe(false);
    expect(restoredLimit.allows({ id: "allowed-after-restore", sourceUid: "missing", controller: 0, event: "quick", range: ["hand"], operation() {} }, 0, 0)).toBe(true);
  });

  it("preserves pending trigger timing metadata across snapshots", () => {
    const session = createDuel({ seed: 123, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const triggerSource = findPublicCard(session, 0, "hand", "100");
    const moved = findPublicCard(session, 0, "hand", "300");
    expect(triggerSource).toBeTruthy();
    expect(moved).toBeTruthy();
    registerEffect(session, {
      id: "snapshot-delayed-trigger",
      registryKey: "delayed-trigger",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "sentToGraveyard",
      triggerTiming: "if",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Restored delayed trigger resolved");
      },
    });

    sendDuelCardToGraveyard(session.state, moved!.uid, 0);
    expect(session.state.pendingTriggers).toHaveLength(1);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "delayed-trigger": (effect) => ({
        ...effect,
        operation(ctx) {
          ctx.log("Restored delayed trigger resolved");
        },
      }),
    });

    expect(restored.state.effects[0]).toMatchObject({ triggerTiming: "if", triggerEvent: "sentToGraveyard" });
    expect(restored.state.pendingTriggers).toEqual(session.state.pendingTriggers);
    const action = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.effectId === "snapshot-delayed-trigger");
    expect(action).toBeTruthy();
    expect(getGroupedDuelLegalActions(restored, 0).map((group) => ({
      label: group.label,
      windowId: group.windowId,
      windowKind: group.windowKind,
      triggerBucket: group.triggerBucket,
      actions: group.actions.map((candidate) => ({
        type: candidate.type,
        windowId: candidate.windowId,
        windowKind: candidate.windowKind,
        effectId: candidate.type === "activateTrigger" || candidate.type === "declineTrigger" ? candidate.effectId : undefined,
      })),
    }))).toEqual([
      { label: "Trigger Activations", windowId: queryPublicState(restored).actionWindowId, windowKind: "triggerBucket", triggerBucket: { triggerBucket: "turnOptional", player: 0, triggerIds: [restored.state.pendingTriggers[0]!.id] }, actions: [{ type: "activateTrigger", windowId: queryPublicState(restored).actionWindowId, windowKind: "triggerBucket", effectId: "snapshot-delayed-trigger" }] },
      { label: "Trigger Declines", windowId: queryPublicState(restored).actionWindowId, windowKind: "triggerBucket", triggerBucket: { triggerBucket: "turnOptional", player: 0, triggerIds: [restored.state.pendingTriggers[0]!.id] }, actions: [{ type: "declineTrigger", windowId: queryPublicState(restored).actionWindowId, windowKind: "triggerBucket", effectId: "snapshot-delayed-trigger" }] },
    ]);
    const result = applyResponse(restored, action!);

    expect(result.ok).toBe(true);
    expect(result.state.log.some((entry) => entry.detail === "Restored delayed trigger resolved")).toBe(true);
    expect(result.state.waitingFor).toBeDefined();
    expect(result.legalActions).toEqual(getDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    const staleTrigger = applyResponse(restored, action!);
    expect(staleTrigger.ok).toBe(false);
    expect(staleTrigger.error).toContain("Response is not currently legal");
    expect(staleTrigger.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleTrigger.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(staleTrigger.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
    expect(staleTrigger.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleTrigger.legalActions);
  });

  it("prunes pending triggers whose non-registry effects cannot be restored", () => {
    const session = createDuel({ seed: 124, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const summoned = findPublicCard(session, 0, "hand", "100");
    const triggerSource = findPublicCard(session, 0, "hand", "300");
    expect(summoned).toBeTruthy();
    expect(triggerSource).toBeTruthy();
    registerEffect(session, {
      id: "non-registry-pending-trigger",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Non-registry trigger should not restore");
      },
    });

    const summon = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === summoned!.uid);
    expect(summon).toBeTruthy();
    expect(applyResponse(session, summon!).ok).toBe(true);
    expect(session.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["non-registry-pending-trigger"]);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));

    expect(restored.state.effects).toEqual([]);
    expect(restored.state.pendingTriggers).toEqual([]);
    expect(restored.state.waitingFor).toBe(0);
    expect(getDuelLegalActions(restored, 0).some((candidate) => candidate.type === "activateTrigger")).toBe(false);
  });

  it("preserves chain response player when pruning unrestored held triggers", () => {
    const session = createDuel({ seed: 146, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const sourceUid = session.state.cards.find((card) => card.code === "100")!.uid;
    registerEffect(session, {
      id: "active-chain-link",
      registryKey: "active-chain-link",
      sourceUid,
      controller: 0,
      event: "quick",
      range: ["hand"],
      operation() {},
    });
    session.state.chain = [{ id: "chain-1", player: 0, sourceUid, effectId: "active-chain-link" }];
    session.state.pendingTriggers = [{ id: "held-trigger", player: 0, sourceUid, effectId: "unrestored-held-trigger", eventName: "customEvent", triggerBucket: "turnOptional" }];
    session.state.waitingFor = 1;

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "active-chain-link": (effect) => ({ ...effect, operation() {} }),
    });

    expect(restored.state.pendingTriggers).toEqual([]);
    expect(restored.state.chain).toEqual(session.state.chain);
    expect(restored.state.waitingFor).toBe(1);
    expect(getDuelLegalActions(restored, 1).some((candidate) => candidate.type === "passChain")).toBe(true);
  });

  it("keeps reset-pruned effects gone across snapshots", () => {
    const session = createDuel({ seed: 121, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const source = findPublicCard(session, 0, "hand", "100");
    expect(source).toBeTruthy();
    registerEffect(session, {
      id: "snapshot-reset-pruned",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      reset: { flags: 0x1000 + 0x40000 },
      operation(ctx) {
        sendDuelCardToGraveyard(ctx.duel, ctx.source.uid, ctx.player);
      },
    });
    expect(session.state.effects).toHaveLength(1);

    moveDuelCard(session.state, source!.uid, "graveyard", 0);

    expect(session.state.effects).toHaveLength(0);
    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(restored.state.effects).toHaveLength(0);
    expect(getDuelLegalActions(restored, 0).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "snapshot-reset-pruned")).toBe(false);
  });
});
