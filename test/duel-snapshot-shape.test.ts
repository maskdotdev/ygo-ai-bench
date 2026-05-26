import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards, findPublicCard } from "./full-duel-engine-fixtures.js";

describe("duel snapshot restore shape validation", () => {
  it("rejects malformed snapshot root values before restore", () => {
    expect(() => restoreDuel(null, createCardReader(cards))).toThrow("Malformed duel snapshot: root must be an object");
  });

  it("rejects malformed snapshot roots before restore", () => {
    expect(() => restoreDuel({ version: 1, state: null }, createCardReader(cards))).toThrow("Malformed duel snapshot: state must be an object");
  });

  it("rejects malformed snapshot collections before restore", () => {
    const session = createDuel({ seed: 138, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const snapshot = serializeDuel(session);
    (snapshot.state as { cards?: unknown }).cards = undefined;

    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards must be an array");
  });

  it("rejects incomplete current-version snapshot collections before restore", () => {
    const session = createDuel({ seed: 139, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const snapshot = serializeDuel(session);
    (snapshot.state as { battlePairs?: unknown }).battlePairs = undefined;

    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battlePairs must be an array");
  });

  it("rejects malformed current-version snapshot scalar fields before restore", () => {
    const session = createDuel({ seed: 140, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const snapshot = serializeDuel(session);
    (snapshot.state as { turnPlayer?: unknown }).turnPlayer = 2;

    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: state.turnPlayer must be a player id");
  });

  it("rejects malformed current-version snapshot enum fields before restore", () => {
    const session = createDuel({ seed: 141, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badStatus = serializeDuel(session);
    const badPhase = serializeDuel(session);
    (badStatus.state as { status?: unknown }).status = "paused";
    (badPhase.state as { phase?: unknown }).phase = "combat";

    expect(() => restoreDuel(badStatus, createCardReader(cards))).toThrow("Malformed duel snapshot: state.status must be a duel status");
    expect(() => restoreDuel(badPhase, createCardReader(cards))).toThrow("Malformed duel snapshot: state.phase must be a duel phase");
  });

  it("rejects awaiting snapshots without a waiting player before restore", () => {
    const session = createDuel({ seed: 149, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const snapshot = serializeDuel(session);
    delete snapshot.state.waitingFor;

    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: awaiting duel requires waitingFor");
  });

  it("rejects ended snapshots with a waiting player before restore", () => {
    const session = createDuel({ seed: 150, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const snapshot = serializeDuel(session);
    snapshot.state.status = "ended";
    snapshot.state.winner = 1;
    snapshot.state.waitingFor = 0;

    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: ended duel must not include waitingFor");
  });

  it("rejects snapshots with inconsistent result fields before restore", () => {
    const session = createDuel({ seed: 151, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const endedWithoutWinner = serializeDuel(session);
    const activeWithWinner = serializeDuel(session);
    const activeWithWinReason = serializeDuel(session);
    endedWithoutWinner.state.status = "ended";
    delete endedWithoutWinner.state.waitingFor;
    activeWithWinner.state.winner = 0;
    activeWithWinReason.state.winReason = 16;

    expect(() => restoreDuel(endedWithoutWinner, createCardReader(cards))).toThrow("Malformed duel snapshot: ended duel requires winner");
    expect(() => restoreDuel(activeWithWinner, createCardReader(cards))).toThrow("Malformed duel snapshot: active duel must not include winner");
    expect(() => restoreDuel(activeWithWinReason, createCardReader(cards))).toThrow("Malformed duel snapshot: active duel must not include winReason");
  });

  it("rejects ended snapshots with battle bookkeeping before restore", () => {
    const session = createDuel({ seed: 150, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const battleDamage = serializeDuel(session);
    const attackCost = serializeDuel(session);
    battleDamage.state.status = "ended";
    battleDamage.state.winner = 0;
    battleDamage.state.battleDamage = { 0: 0, 1: 1200 };
    delete battleDamage.state.waitingFor;
    attackCost.state.status = "ended";
    attackCost.state.winner = 0;
    attackCost.state.attackCostPaid = 1;
    delete attackCost.state.waitingFor;

    expect(() => restoreDuel(battleDamage, createCardReader(cards))).toThrow("Malformed duel snapshot: ended duel must not include battle damage");
    expect(() => restoreDuel(attackCost, createCardReader(cards))).toThrow("Malformed duel snapshot: ended duel must not include attackCostPaid");
  });

  it("rejects ended snapshots with chain limits before restore", () => {
    const session = createDuel({ seed: 151, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const snapshot = serializeDuel(session);
    snapshot.state.status = "ended";
    snapshot.state.winner = 0;
    snapshot.state.chainLimits = [{ registryKey: "ended-chain-limit", untilChainEnd: true }];
    delete snapshot.state.waitingFor;

    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: ended duel must not include chain limits");
  });

  it("rejects malformed optional prompt snapshots before restore", () => {
    const session = createDuel({ seed: 142, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badOptions = serializeDuel(session);
    const badOptionValue = serializeDuel(session);
    const badDuplicateOptions = serializeDuel(session);
    const badDescriptions = serializeDuel(session);
    const badDescriptionLength = serializeDuel(session);
    const badYesNoDescriptions = serializeDuel(session);
    const badPromptType = serializeDuel(session);
    const badDescription = serializeDuel(session);
    const badReturnTo = serializeDuel(session);
    const badOrigin = serializeDuel(session);
    const badWaitingFor = serializeDuel(session);
    badOptions.state.prompt = { id: "bad-prompt", type: "selectOption", player: 0, options: "not-options" as unknown as number[] };
    badOptionValue.state.prompt = { id: "bad-option-value", type: "selectOption", player: 0, options: [1, Number.NaN] };
    badDuplicateOptions.state.prompt = { id: "bad-duplicate-options", type: "selectOption", player: 0, options: [1, 1] };
    badDescriptions.state.prompt = { id: "bad-descriptions", type: "selectOption", player: 0, options: [1], descriptions: [Number.NaN] };
    badDescriptionLength.state.prompt = { id: "bad-description-length", type: "selectOption", player: 0, options: [1, 2], descriptions: [100] };
    badYesNoDescriptions.state.prompt = { id: "bad-yes-no-descriptions", type: "selectYesNo", player: 0, descriptions: [100] } as NonNullable<typeof badYesNoDescriptions.state.prompt>;
    badPromptType.state.prompt = { id: "bad-type", type: "selectCard" as "selectOption", player: 0, options: [1] };
    badDescription.state.prompt = { id: "bad-description", type: "selectYesNo", player: 0, description: Number.POSITIVE_INFINITY };
    badReturnTo.state.prompt = { id: "bad-return", type: "selectYesNo", player: 0, returnTo: 2 as 0 };
    badOrigin.state.prompt = { id: "bad-origin", type: "selectYesNo", player: 0, origin: "regularPrompt" as "luaOperation" };
    badWaitingFor.state.prompt = { id: "bad-waiting", type: "selectYesNo", player: 0 };
    badWaitingFor.state.waitingFor = 1;

    expect(() => restoreDuel(badOptions, createCardReader(cards))).toThrow("Malformed duel snapshot: state.prompt.options must be an array");
    expect(() => restoreDuel(badOptionValue, createCardReader(cards))).toThrow("Malformed duel snapshot: state.prompt.options must contain safe integers");
    expect(() => restoreDuel(badDuplicateOptions, createCardReader(cards))).toThrow("Malformed duel snapshot: state.prompt.options must be unique");
    expect(() => restoreDuel(badDescriptions, createCardReader(cards))).toThrow("Malformed duel snapshot: state.prompt.descriptions must contain safe integers");
    expect(() => restoreDuel(badDescriptionLength, createCardReader(cards))).toThrow("Malformed duel snapshot: state.prompt.descriptions must match options length");
    expect(() => restoreDuel(badYesNoDescriptions, createCardReader(cards))).toThrow("Malformed duel snapshot: state.prompt.descriptions is only valid for selectOption");
    expect(() => restoreDuel(badPromptType, createCardReader(cards))).toThrow("Malformed duel snapshot: state.prompt.type must be a prompt type");
    expect(() => restoreDuel(badDescription, createCardReader(cards))).toThrow("Malformed duel snapshot: state.prompt.description must be a safe integer");
    expect(() => restoreDuel(badReturnTo, createCardReader(cards))).toThrow("Malformed duel snapshot: state.prompt.returnTo must be a player id");
    expect(() => restoreDuel(badOrigin, createCardReader(cards))).toThrow("Malformed duel snapshot: state.prompt.origin must be a prompt origin");
    expect(() => restoreDuel(badWaitingFor, createCardReader(cards))).toThrow("Malformed duel snapshot: state.waitingFor must match prompt.player");
  });

  it("rejects unknown prompt snapshot fields before restore", () => {
    const session = createDuel({ seed: 242, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const snapshot = serializeDuel(session);
    snapshot.state.prompt = { id: "stale-prompt", type: "selectYesNo", player: 0, stalePrompt: true } as unknown as NonNullable<typeof snapshot.state.prompt>;

    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: state.prompt.stalePrompt is not a known field");
  });

  it("rejects prompt snapshots that overlap hidden timing windows", () => {
    const session = createDuel({ seed: 143, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const sourceUid = session.state.cards.find((card) => card.code === "100")!.uid;
    const promptWithChain = serializeDuel(session);
    const promptWithTriggers = serializeDuel(session);
    promptWithChain.state.prompt = { id: "prompt-chain", type: "selectYesNo", player: 0 };
    promptWithChain.state.chain = [{ id: "chain-1", player: 0, sourceUid, effectId: "effect" }];
    promptWithTriggers.state.prompt = { id: "prompt-triggers", type: "selectYesNo", player: 0 };
    promptWithTriggers.state.pendingTriggers = [{ id: "trigger-1", player: 0, sourceUid, effectId: "effect", eventName: "customEvent", eventTriggerTiming: "if", triggerBucket: "turnOptional" }];
    promptWithTriggers.state.pendingTriggerBuckets = [{ triggerBucket: "turnOptional", player: 0, triggerIds: ["trigger-1"] }];

    expect(() => restoreDuel(promptWithChain, createCardReader(cards))).toThrow("Malformed duel snapshot: state.prompt must not overlap a pending chain");
    expect(() => restoreDuel(promptWithTriggers, createCardReader(cards))).toThrow("Malformed duel snapshot: state.prompt must not overlap pending triggers");
  });

  it("rejects prompt snapshots outside awaiting status", () => {
    const session = createDuel({ seed: 144, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const resolvingPrompt = serializeDuel(session);
    const endedPrompt = serializeDuel(session);
    resolvingPrompt.state.prompt = { id: "resolving-prompt", type: "selectYesNo", player: 0 };
    resolvingPrompt.state.status = "resolving";
    endedPrompt.state.prompt = { id: "ended-prompt", type: "selectYesNo", player: 0 };
    endedPrompt.state.status = "ended";
    endedPrompt.state.winner = 1;
    delete endedPrompt.state.waitingFor;

    expect(() => restoreDuel(resolvingPrompt, createCardReader(cards))).toThrow("Malformed duel snapshot: pending prompt requires an awaiting duel");
    expect(() => restoreDuel(endedPrompt, createCardReader(cards))).toThrow("Malformed duel snapshot: pending prompt requires an awaiting duel");
  });

  it("rejects malformed player and option snapshots before restore", () => {
    const session = createDuel({ seed: 145, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badPlayer = serializeDuel(session);
    const badOption = serializeDuel(session);
    badPlayer.state.players[1] = { ...badPlayer.state.players[1], lifePoints: "8000" as unknown as number };
    badOption.state.options = { ...badOption.state.options, drawPerTurn: "one" as unknown as number };

    expect(() => restoreDuel(badPlayer, createCardReader(cards))).toThrow("Malformed duel snapshot: state.players.1.lifePoints must be a number");
    expect(() => restoreDuel(badOption, createCardReader(cards))).toThrow("Malformed duel snapshot: state.options.drawPerTurn must be a number");
  });

  it("rejects unknown duel state snapshot fields before restore", () => {
    const session = createDuel({ seed: 250, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const stale = serializeDuel(session) as ReturnType<typeof serializeDuel> & { state: Record<string, unknown> };
    stale.state.restoredWindow = "stale";

    expect(() => restoreDuel(stale, createCardReader(cards))).toThrow("Malformed duel snapshot: state.restoredWindow is not a known field");
  });

  it("rejects impossible player and option numeric snapshots before restore", () => {
    const session = createDuel({ seed: 234, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const negativeLife = serializeDuel(session);
    const fractionalDeckSize = serializeDuel(session);
    const negativeHandSize = serializeDuel(session);
    const fractionalDraw = serializeDuel(session);
    negativeLife.state.players[0] = { ...negativeLife.state.players[0], lifePoints: -1 };
    fractionalDeckSize.state.players[1] = { ...fractionalDeckSize.state.players[1], initialMainDeckSize: 1.5 };
    negativeHandSize.state.options = { ...negativeHandSize.state.options, startingHandSize: -1 };
    fractionalDraw.state.options = { ...fractionalDraw.state.options, drawPerTurn: 0.5 };

    expect(() => restoreDuel(negativeLife, createCardReader(cards))).toThrow("Malformed duel snapshot: state.players.0.lifePoints must be a non-negative integer");
    expect(() => restoreDuel(fractionalDeckSize, createCardReader(cards))).toThrow("Malformed duel snapshot: state.players.1.initialMainDeckSize must be a non-negative integer");
    expect(() => restoreDuel(negativeHandSize, createCardReader(cards))).toThrow("Malformed duel snapshot: state.options.startingHandSize must be a non-negative integer");
    expect(() => restoreDuel(fractionalDraw, createCardReader(cards))).toThrow("Malformed duel snapshot: state.options.drawPerTurn must be a non-negative integer");
  });

  it("rejects malformed winner snapshots before restore", () => {
    const session = createDuel({ seed: 146, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badWinner = serializeDuel(session);
    const badWinReason = serializeDuel(session);
    badWinner.state.winner = "timeout" as unknown as 0;
    badWinReason.state.winReason = "battle" as unknown as number;

    expect(() => restoreDuel(badWinner, createCardReader(cards))).toThrow("Malformed duel snapshot: state.winner must be a player id");
    expect(() => restoreDuel(badWinReason, createCardReader(cards))).toThrow("Malformed duel snapshot: state.winReason must be a number");
  });

  it("rejects malformed snapshot player-id collections before restore", () => {
    const session = createDuel({ seed: 147, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badChainPasses = serializeDuel(session);
    badChainPasses.state.chainPasses = [0, 2 as 0];

    expect(() => restoreDuel(badChainPasses, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chainPasses.1 must be a player id");
  });

  it("rejects duplicate pending-window pass players before restore", () => {
    const session = createDuel({ seed: 172, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badChainPasses = serializeDuel(session);
    const badAttackPasses = serializeDuel(session);
    const badDamagePasses = serializeDuel(session);
    badChainPasses.state.chainPasses = [0, 0];
    badAttackPasses.state.attackPasses = [1, 1];
    badDamagePasses.state.damagePasses = [0, 0];

    expect(() => restoreDuel(badChainPasses, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chainPasses must not contain duplicate players");
    expect(() => restoreDuel(badAttackPasses, createCardReader(cards))).toThrow("Malformed duel snapshot: state.attackPasses must not contain duplicate players");
    expect(() => restoreDuel(badDamagePasses, createCardReader(cards))).toThrow("Malformed duel snapshot: state.damagePasses must not contain duplicate players");
  });

  it("rejects duplicate set-like snapshot string collections before restore", () => {
    const session = createDuel({ seed: 230, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const uid = serializeDuel(session).state.cards[0]!.uid;
    const badUsedCount = serializeDuel(session);
    const badAttack = serializeDuel(session);
    const badCanceled = serializeDuel(session);
    const badAttackedTarget = serializeDuel(session);
    const badPosition = serializeDuel(session);
    badUsedCount.state.usedCountKeys = ["once", "once"];
    badAttack.state.attacksDeclared = [uid, uid];
    badCanceled.state.attackCanceledUids = [uid, uid];
    badAttackedTarget.state.attackedTargetUids = [uid, uid];
    badPosition.state.positionsChanged = [uid, uid];

    expect(() => restoreDuel(badUsedCount, createCardReader(cards))).toThrow("Malformed duel snapshot: state.usedCountKeys must not contain duplicates");
    expect(() => restoreDuel(badAttack, createCardReader(cards))).not.toThrow();
    expect(() => restoreDuel(badCanceled, createCardReader(cards))).toThrow("Malformed duel snapshot: state.attackCanceledUids must not contain duplicates");
    expect(() => restoreDuel(badAttackedTarget, createCardReader(cards))).toThrow("Malformed duel snapshot: state.attackedTargetUids must not contain duplicates");
    expect(() => restoreDuel(badPosition, createCardReader(cards))).toThrow("Malformed duel snapshot: state.positionsChanged must not contain duplicates");
  });

  it("rejects pass snapshots without their pending window before restore", () => {
    const session = createDuel({ seed: 173, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badChainPasses = serializeDuel(session);
    const badAttackPasses = serializeDuel(session);
    const badDamagePasses = serializeDuel(session);
    badChainPasses.state.chainPasses = [0];
    badAttackPasses.state.attackPasses = [1];
    badDamagePasses.state.damagePasses = [0];

    expect(() => restoreDuel(badChainPasses, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chainPasses requires a pending chain");
    expect(() => restoreDuel(badAttackPasses, createCardReader(cards))).toThrow("Malformed duel snapshot: state.attackPasses requires a pending battle");
    expect(() => restoreDuel(badDamagePasses, createCardReader(cards))).toThrow("Malformed duel snapshot: state.damagePasses requires a pending battle");
  });

  it("rejects impossible chain pass snapshots before restore", () => {
    const session = createDuel({ seed: 176, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const sourceUid = serializeDuel(session).state.cards[0]!.uid;
    const badWaitingPass = serializeDuel(session);
    const badBothPassed = serializeDuel(session);
    badWaitingPass.state.chain = [{ id: "link", player: 0, sourceUid, effectId: "effect" }];
    badWaitingPass.state.waitingFor = 1;
    badWaitingPass.state.chainPasses = [1];
    badBothPassed.state.chain = [{ id: "link", player: 0, sourceUid, effectId: "effect" }];
    badBothPassed.state.waitingFor = 0;
    badBothPassed.state.chainPasses = [0, 1];

    expect(() => restoreDuel(badWaitingPass, createCardReader(cards))).toThrow("Malformed duel snapshot: state.waitingFor must not be included in chainPasses");
    expect(() => restoreDuel(badBothPassed, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chainPasses must not contain both players");
  });

  it("rejects active chain snapshots without a waiting player before restore", () => {
    const session = createDuel({ seed: 178, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const sourceUid = serializeDuel(session).state.cards[0]!.uid;
    const snapshot = serializeDuel(session);
    snapshot.state.chain = [{ id: "link", player: 0, sourceUid, effectId: "effect" }];
    delete snapshot.state.waitingFor;

    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: state.waitingFor is required for a pending chain");
  });

  it("rejects pending chain snapshots outside awaiting status", () => {
    const session = createDuel({ seed: 179, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const sourceUid = serializeDuel(session).state.cards[0]!.uid;
    const resolvingChain = serializeDuel(session);
    const endedChain = serializeDuel(session);
    resolvingChain.state.chain = [{ id: "link", player: 0, sourceUid, effectId: "effect" }];
    resolvingChain.state.status = "resolving";
    endedChain.state.chain = [{ id: "link", player: 0, sourceUid, effectId: "effect" }];
    endedChain.state.status = "ended";
    endedChain.state.winner = 1;
    delete endedChain.state.waitingFor;

    expect(() => restoreDuel(resolvingChain, createCardReader(cards))).toThrow("Malformed duel snapshot: pending chain requires an awaiting duel");
    expect(() => restoreDuel(endedChain, createCardReader(cards))).toThrow("Malformed duel snapshot: pending chain requires an awaiting duel");
  });

  it("rejects malformed snapshot scalar collections before restore", () => {
    const session = createDuel({ seed: 148, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badDice = serializeDuel(session);
    const badUid = serializeDuel(session);
    badDice.state.lastDiceResults = [6, "one" as unknown as number];
    badUid.state.attackCanceledUids = ["attacker", 7 as unknown as string];

    expect(() => restoreDuel(badDice, createCardReader(cards))).toThrow("Malformed duel snapshot: state.lastDiceResults.1 must be a number");
    expect(() => restoreDuel(badUid, createCardReader(cards))).toThrow("Malformed duel snapshot: state.attackCanceledUids.1 must be a string");
  });

  it("rejects missing card references in snapshot uid collections before restore", () => {
    const session = createDuel({ seed: 170, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badAttack = serializeDuel(session);
    const badPosition = serializeDuel(session);
    badAttack.state.attacksDeclared = ["missing"];
    badPosition.state.positionsChanged = [badPosition.state.cards[0]!.uid, "missing"];

    expect(() => restoreDuel(badAttack, createCardReader(cards))).toThrow("Malformed duel snapshot: state.attacksDeclared.0 must reference a card");
    expect(() => restoreDuel(badPosition, createCardReader(cards))).toThrow("Malformed duel snapshot: state.positionsChanged.1 must reference a card");
  });

  it("rejects malformed snapshot battle pair collections before restore", () => {
    const session = createDuel({ seed: 149, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badPair = serializeDuel(session);
    badPair.state.battlePairs = [{ attackerUid: "attacker", targetUid: 7 as unknown as string }];

    expect(() => restoreDuel(badPair, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battlePairs.0.targetUid must be a string");
  });

  it("rejects duplicate battle pair snapshots before restore", () => {
    const session = createDuel({ seed: 232, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const attackerUid = serializeDuel(session).state.cards[0]!.uid;
    const targetUid = serializeDuel(session).state.cards[1]!.uid;
    const badPair = serializeDuel(session);
    badPair.state.battlePairs = [
      { attackerUid, targetUid },
      { attackerUid, targetUid },
    ];

    expect(() => restoreDuel(badPair, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battlePairs.1 must be unique by attacker and target");
  });

  it("rejects missing battle card references before restore", () => {
    const session = createDuel({ seed: 165, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badPair = serializeDuel(session);
    const badWindow = serializeDuel(session);
    badPair.state.battlePairs = [{ attackerUid: "missing", targetUid: badPair.state.cards[0]!.uid }];
    badWindow.state.battleWindow = { id: 1, kind: "attackDeclaration", step: "attack", attackerUid: "missing", responsePlayer: 0, attackNegated: false };

    expect(() => restoreDuel(badPair, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battlePairs.0.attackerUid must reference a card");
    expect(() => restoreDuel(badWindow, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleWindow.attackerUid must reference a card");
  });

  it("rejects malformed snapshot activity and damage records before restore", () => {
    const session = createDuel({ seed: 150, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badActivity = serializeDuel(session);
    const badBattleDamage = serializeDuel(session);
    badActivity.state.activityCounts[0] = { ...badActivity.state.activityCounts[0], attack: "one" as unknown as number };
    badBattleDamage.state.battleDamage = { ...badBattleDamage.state.battleDamage, 1: "1000" as unknown as number };

    expect(() => restoreDuel(badActivity, createCardReader(cards))).toThrow("Malformed duel snapshot: state.activityCounts.0.attack must be a number");
    expect(() => restoreDuel(badBattleDamage, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleDamage.1 must be a number");
  });

  it("rejects impossible battle damage snapshots before restore", () => {
    const session = createDuel({ seed: 235, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const negative = serializeDuel(session);
    const fractional = serializeDuel(session);
    negative.state.battleDamage = { ...negative.state.battleDamage, 0: -1 };
    fractional.state.battleDamage = { ...fractional.state.battleDamage, 1: 0.5 };

    expect(() => restoreDuel(negative, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleDamage.0 must be a non-negative integer");
    expect(() => restoreDuel(fractional, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleDamage.1 must be a non-negative integer");
  });

  it("rejects impossible activity count snapshots before restore", () => {
    const session = createDuel({ seed: 233, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const negative = serializeDuel(session);
    const fractional = serializeDuel(session);
    negative.state.activityCounts[0] = { ...negative.state.activityCounts[0], attack: -1 };
    fractional.state.activityCounts[1] = { ...fractional.state.activityCounts[1], specialSummon: 0.5 };

    expect(() => restoreDuel(negative, createCardReader(cards))).toThrow("Malformed duel snapshot: state.activityCounts.0.attack must be a non-negative integer");
    expect(() => restoreDuel(fractional, createCardReader(cards))).toThrow("Malformed duel snapshot: state.activityCounts.1.specialSummon must be a non-negative integer");
  });

  it("rejects unknown battle pair snapshot fields before restore", () => {
    const session = createDuel({ seed: 238, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const snapshot = serializeDuel(session);
    snapshot.state.battlePairs = [{ attackerUid: snapshot.state.cards[0]!.uid, targetUid: snapshot.state.cards[1]!.uid, staleBattle: true } as unknown as typeof snapshot.state.battlePairs[number]];

    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battlePairs.0.staleBattle is not a known field");
  });

  it("rejects malformed pending trigger snapshots before restore", () => {
    const session = createDuel({ seed: 151, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const sourceUid = serializeDuel(session).state.cards[0]!.uid;
    const badBucket = serializeDuel(session);
    const badPayload = serializeDuel(session), badEventName = serializeDuel(session);
    const badBucketPlayer = serializeDuel(session), missingTiming = serializeDuel(session);
    badBucket.state.pendingTriggers = [{ id: "trigger", player: 0, sourceUid: "source", effectId: "effect", eventName: "customEvent", eventTriggerTiming: "if", triggerBucket: "optional" as "turnOptional" }];
    badPayload.state.pendingTriggers = [{ id: "trigger", player: 0, sourceUid: "source", effectId: "effect", eventName: "customEvent", eventTriggerTiming: "if", triggerBucket: "turnOptional", eventPlayer: 2 as 0 }];
    badEventName.state.pendingTriggers = [{ id: "trigger", player: 0, sourceUid: "source", effectId: "effect", eventName: "unknown" as "customEvent", triggerBucket: "turnOptional" }];
    badBucketPlayer.state.pendingTriggers = [{ id: "trigger", player: 1, sourceUid: "source", effectId: "effect", eventName: "customEvent", eventTriggerTiming: "if", triggerBucket: "turnOptional" }];
    missingTiming.state.pendingTriggers = [{ id: "trigger", player: 0, sourceUid, effectId: "effect", eventName: "customEvent", triggerBucket: "turnOptional" }];

    expect(() => restoreDuel(badBucket, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingTriggers.0.triggerBucket must be a trigger bucket");
    expect(() => restoreDuel(badPayload, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingTriggers.0.eventPlayer must be a player id");
    expect(() => restoreDuel(badEventName, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingTriggers.0.eventName must be a duel event");
    expect(() => restoreDuel(badBucketPlayer, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingTriggers.0.triggerBucket must match the trigger player");
    expect(() => restoreDuel(missingTiming, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingTriggers.0.eventTriggerTiming is required");
  });

  it("rejects unknown pending trigger and bucket snapshot fields before restore", () => {
    const session = createDuel({ seed: 239, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const sourceUid = serializeDuel(session).state.cards[0]!.uid;
    const badTrigger = serializeDuel(session);
    const badBucket = serializeDuel(session);
    badTrigger.state.pendingTriggers = [{ id: "trigger", player: 0, sourceUid, effectId: "effect", eventName: "customEvent", eventTriggerTiming: "if", triggerBucket: "turnOptional", staleTrigger: true } as unknown as typeof badTrigger.state.pendingTriggers[number]];
    badBucket.state.pendingTriggers = [{ id: "trigger", player: 0, sourceUid, effectId: "effect", eventName: "customEvent", eventTriggerTiming: "if", triggerBucket: "turnOptional" }];
    badBucket.state.pendingTriggerBuckets = [{ triggerBucket: "turnOptional", player: 0, triggerIds: ["trigger"], staleBucket: true }] as unknown as NonNullable<typeof badBucket.state.pendingTriggerBuckets>;

    expect(() => restoreDuel(badTrigger, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingTriggers.0.staleTrigger is not a known field");
    expect(() => restoreDuel(badBucket, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingTriggerBuckets.0.staleBucket is not a known field");
  });

  it("rejects active trigger snapshots with mismatched waiting player before restore", () => {
    const session = createDuel({ seed: 177, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const sourceUid = serializeDuel(session).state.cards[0]!.uid;
    const snapshot = serializeDuel(session);
    snapshot.state.pendingTriggers = [{ id: "trigger", player: 1, sourceUid, effectId: "effect", eventName: "customEvent", eventTriggerTiming: "if", triggerBucket: "opponentMandatory" }];
    snapshot.state.pendingTriggerBuckets = [{ triggerBucket: "opponentMandatory", player: 1, triggerIds: ["trigger"] }];
    snapshot.state.waitingFor = 0;

    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: state.waitingFor must match active trigger bucket player");
  });

  it("rejects missing pending trigger card references before restore", () => {
    const session = createDuel({ seed: 167, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const sourceUid = serializeDuel(session).state.cards[0]!.uid;
    const badSource = serializeDuel(session);
    const badEventCard = serializeDuel(session);
    const badEventUid = serializeDuel(session);
    badSource.state.pendingTriggers = [{ id: "trigger", player: 0, sourceUid: "missing", effectId: "effect", eventName: "customEvent", eventTriggerTiming: "if", triggerBucket: "turnOptional" }];
    badEventCard.state.pendingTriggers = [{ id: "trigger", player: 0, sourceUid, effectId: "effect", eventName: "customEvent", eventTriggerTiming: "if", triggerBucket: "turnOptional", eventCardUid: "missing" }];
    badEventUid.state.pendingTriggers = [{ id: "trigger", player: 0, sourceUid, effectId: "effect", eventName: "customEvent", eventTriggerTiming: "if", triggerBucket: "turnOptional", eventUids: ["missing"] }];

    expect(() => restoreDuel(badSource, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingTriggers.0.sourceUid must reference a card");
    expect(() => restoreDuel(badEventCard, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingTriggers.0.eventCardUid must reference a card");
    expect(() => restoreDuel(badEventUid, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingTriggers.0.eventUids.0 must reference a card");
  });

  it("rejects malformed pending trigger bucket snapshots before restore", () => {
    const session = createDuel({ seed: 168, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const sourceUid = serializeDuel(session).state.cards[0]!.uid;
    const badBucket = serializeDuel(session);
    const badPlayer = serializeDuel(session);
    const badTriggerIds = serializeDuel(session);
    const badTriggerRef = serializeDuel(session);
    const badBucketOrder = serializeDuel(session);
    const badBucketIds = serializeDuel(session);
    for (const snapshot of [badBucket, badPlayer, badTriggerIds, badTriggerRef, badBucketOrder, badBucketIds]) {
      snapshot.state.pendingTriggers = [{ id: "trigger", player: 0, sourceUid, effectId: "effect", eventName: "customEvent", eventTriggerTiming: "if", triggerBucket: "turnOptional" }];
    }
    badBucket.state.pendingTriggerBuckets = [{ triggerBucket: "optional" as "turnOptional", player: 0, triggerIds: ["trigger"] }];
    badPlayer.state.pendingTriggerBuckets = [{ triggerBucket: "turnOptional", player: 2 as 0, triggerIds: ["trigger"] }];
    badTriggerIds.state.pendingTriggerBuckets = [{ triggerBucket: "turnOptional", player: 0, triggerIds: "trigger" as unknown as string[] }];
    badTriggerRef.state.pendingTriggerBuckets = [{ triggerBucket: "turnOptional", player: 0, triggerIds: ["missing"] }];
    badBucketOrder.state.pendingTriggerBuckets = [{ triggerBucket: "opponentOptional", player: 0, triggerIds: ["trigger"] }];
    badBucketIds.state.pendingTriggers.push({ id: "second-trigger", player: 0, sourceUid, effectId: "second-effect", eventName: "customEvent", eventTriggerTiming: "if", triggerBucket: "turnOptional" });
    badBucketIds.state.pendingTriggerBuckets = [{ triggerBucket: "turnOptional", player: 0, triggerIds: ["second-trigger", "trigger"] }];

    expect(() => restoreDuel(badBucket, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingTriggerBuckets.0.triggerBucket must be a trigger bucket");
    expect(() => restoreDuel(badPlayer, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingTriggerBuckets.0.player must be a player id");
    expect(() => restoreDuel(badTriggerIds, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingTriggerBuckets.0.triggerIds must be an array");
    expect(() => restoreDuel(badTriggerRef, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingTriggerBuckets.0.triggerIds.0 must reference a pending trigger");
    expect(() => restoreDuel(badBucketOrder, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingTriggerBuckets must match pendingTriggers");
    expect(() => restoreDuel(badBucketIds, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingTriggerBuckets must match pendingTriggers");
  });

  it("rejects malformed event history snapshots before restore", () => {
    const session = createDuel({ seed: 152, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badEventName = serializeDuel(session);
    const unknownEventName = serializeDuel(session);
    const badPayload = serializeDuel(session);
    const badEventUids = serializeDuel(session);
    badEventName.state.eventHistory = [{ eventName: 12 as unknown as "customEvent" }];
    unknownEventName.state.eventHistory = [{ eventName: "unknown" as "customEvent" }];
    badPayload.state.eventHistory = [{ eventName: "customEvent", eventCardUid: 12 as unknown as string }];
    badEventUids.state.eventHistory = [{ eventName: "customEvent", eventUids: "uid" as unknown as string[] }];

    expect(() => restoreDuel(badEventName, createCardReader(cards))).toThrow("Malformed duel snapshot: state.eventHistory.0.eventName must be a string");
    expect(() => restoreDuel(unknownEventName, createCardReader(cards))).toThrow("Malformed duel snapshot: state.eventHistory.0.eventName must be a duel event");
    expect(() => restoreDuel(badPayload, createCardReader(cards))).toThrow("Malformed duel snapshot: state.eventHistory.0.eventCardUid must be a string");
    expect(() => restoreDuel(badEventUids, createCardReader(cards))).toThrow("Malformed duel snapshot: state.eventHistory.0.eventUids must be an array");
  });

  it("rejects unknown event history and event card-state snapshot fields before restore", () => {
    const session = createDuel({ seed: 240, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badEvent = serializeDuel(session);
    const badCardState = serializeDuel(session);
    badEvent.state.eventHistory = [{ eventName: "customEvent", staleEvent: true } as unknown as typeof badEvent.state.eventHistory[number]];
    badCardState.state.eventHistory = [{ eventName: "customEvent", eventPreviousState: { controller: 0, location: "hand", sequence: 0, position: "faceDown", faceUp: false, staleState: true } } as unknown as typeof badCardState.state.eventHistory[number]];

    expect(() => restoreDuel(badEvent, createCardReader(cards))).toThrow("Malformed duel snapshot: state.eventHistory.0.staleEvent is not a known field");
    expect(() => restoreDuel(badCardState, createCardReader(cards))).toThrow("Malformed duel snapshot: state.eventHistory.0.eventPreviousState.staleState is not a known field");
  });

  it("rejects missing event history card references before restore", () => {
    const session = createDuel({ seed: 168, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const snapshot = serializeDuel(session);
    const badEventUid = serializeDuel(session);
    const duplicateEventUids = serializeDuel(session);
    const sourceUid = snapshot.state.cards[0]!.uid;
    snapshot.state.eventHistory = [{ eventName: "customEvent", eventCardUid: "missing" }];
    badEventUid.state.eventHistory = [{ eventName: "customEvent", eventUids: ["missing"] }];
    duplicateEventUids.state.eventHistory = [{ eventName: "customEvent", eventUids: [sourceUid, sourceUid] }];

    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: state.eventHistory.0.eventCardUid must reference a card");
    expect(() => restoreDuel(badEventUid, createCardReader(cards))).toThrow("Malformed duel snapshot: state.eventHistory.0.eventUids.0 must reference a card");
    expect(() => restoreDuel(duplicateEventUids, createCardReader(cards))).toThrow("Malformed duel snapshot: state.eventHistory.0.eventUids must not contain duplicates");
  });

  it("rejects malformed chain snapshots before restore", () => {
    const session = createDuel({ seed: 153, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const sourceUid = serializeDuel(session).state.cards[0]!.uid;
    const badTargetUids = serializeDuel(session);
    const duplicateTargetUids = serializeDuel(session);
    const badEventUids = serializeDuel(session);
    const duplicateLinkIds = serializeDuel(session);
    const badPlayer = serializeDuel(session);
    const badActivationLocation = serializeDuel(session);
    const missingTriggerTiming = serializeDuel(session);
    const quickEventPayload = serializeDuel(session);
    badTargetUids.state.chain = [{ id: "link", player: 0, sourceUid, effectId: "effect", targetUids: ["target", 7 as unknown as string] }];
    duplicateTargetUids.state.chain = [{ id: "link", player: 0, sourceUid, effectId: "effect", targetUids: [sourceUid, sourceUid] }];
    badEventUids.state.chain = [{ id: "link", player: 0, sourceUid, effectId: "effect", eventUids: [7 as unknown as string] }];
    duplicateLinkIds.state.chain = [{ id: "link", player: 0, sourceUid, effectId: "effect" }, { id: "link", player: 0, sourceUid, effectId: "effect" }];
    badPlayer.state.chain = [{ id: "link", player: 2 as 0, sourceUid, effectId: "effect" }];
    badActivationLocation.state.chain = [{ id: "link", player: 0, sourceUid, effectId: "effect", activationLocation: "field" as "hand" }];
    missingTriggerTiming.state.effects = [{ id: "trigger-effect", sourceUid, controller: 0, event: "trigger", triggerEvent: "customEvent", triggerTiming: "if", range: ["hand"] }];
    missingTriggerTiming.state.chain = [{ id: "link", player: 0, sourceUid, effectId: "trigger-effect", eventName: "customEvent" }];
    quickEventPayload.state.effects = [{ id: "quick-effect", sourceUid, controller: 0, event: "quick", triggerEvent: "customEvent", triggerTiming: "if", range: ["hand"] }];
    quickEventPayload.state.chain = [{ id: "link", player: 0, sourceUid, effectId: "quick-effect", eventName: "customEvent" }];

    expect(() => restoreDuel(badTargetUids, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chain.0.targetUids.1 must be a string");
    expect(() => restoreDuel(duplicateTargetUids, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chain.0.targetUids must not contain duplicates");
    expect(() => restoreDuel(badEventUids, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chain.0.eventUids.0 must reference a card");
    expect(() => restoreDuel(duplicateLinkIds, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chain.1.id must be unique");
    expect(() => restoreDuel(badPlayer, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chain.0.player must be a player id");
    expect(() => restoreDuel(badActivationLocation, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chain.0.activationLocation must be a card location");
    expect(() => restoreDuel(missingTriggerTiming, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chain.0.eventTriggerTiming is required for trigger chain links");
    expect(() => restoreDuel(quickEventPayload, createCardReader(cards))).not.toThrow();
  });

  it("rejects malformed Lua operation prompt snapshots before restore", () => {
    const session = createDuel({ seed: 248, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const sourceUid = session.state.cards.find((card) => card.code === "100")!.uid;
    const unknownField = serializeDuel(session);
    const missingChainLink = serializeDuel(session);
    const missingPrompt = serializeDuel(session);
    const badPromptApi = serializeDuel(session);
    const badPromptDescriptions = serializeDuel(session);
    const badOptionPromptDescription = serializeDuel(session);
    const badYesNoPromptOptions = serializeDuel(session);
    const badChainLinkSource = serializeDuel(session);
    const prompt = { id: "lua-prompt-1", api: "SelectOption" as const, player: 0 as const, options: [0, 1], descriptions: [701, 702], returned: 0 };
    unknownField.state.luaOperationPrompt = { chainLink: { id: "lua-op-chain", player: 0, sourceUid, effectId: "effect" }, prompt, stale: true } as unknown as NonNullable<typeof unknownField.state.luaOperationPrompt>;
    missingChainLink.state.luaOperationPrompt = {} as NonNullable<typeof missingChainLink.state.luaOperationPrompt>;
    missingPrompt.state.luaOperationPrompt = { chainLink: { id: "lua-op-chain", player: 0, sourceUid, effectId: "effect" } } as NonNullable<typeof missingPrompt.state.luaOperationPrompt>;
    badPromptApi.state.luaOperationPrompt = { chainLink: { id: "lua-op-chain", player: 0, sourceUid, effectId: "effect" }, prompt: { ...prompt, api: "SelectCard" as "SelectOption" } };
    badPromptDescriptions.state.luaOperationPrompt = { chainLink: { id: "lua-op-chain", player: 0, sourceUid, effectId: "effect" }, prompt: { ...prompt, descriptions: [701] } };
    badOptionPromptDescription.state.luaOperationPrompt = { chainLink: { id: "lua-op-chain", player: 0, sourceUid, effectId: "effect" }, prompt: { ...prompt, description: 701 } } as unknown as NonNullable<typeof badOptionPromptDescription.state.luaOperationPrompt>;
    badYesNoPromptOptions.state.luaOperationPrompt = { chainLink: { id: "lua-op-chain", player: 0, sourceUid, effectId: "effect" }, prompt: { id: "lua-prompt-2", api: "SelectEffectYesNo", player: 0, returned: true, options: [0] } } as unknown as NonNullable<typeof badYesNoPromptOptions.state.luaOperationPrompt>;
    badChainLinkSource.state.luaOperationPrompt = { chainLink: { id: "lua-op-chain", player: 0, sourceUid: "missing-card", effectId: "effect" }, prompt };

    expect(() => restoreDuel(unknownField, createCardReader(cards))).toThrow("Malformed duel snapshot: state.luaOperationPrompt.stale is not a known field");
    expect(() => restoreDuel(missingChainLink, createCardReader(cards))).toThrow("Malformed duel snapshot: state.luaOperationPrompt.chainLink is required");
    expect(() => restoreDuel(missingPrompt, createCardReader(cards))).toThrow("Malformed duel snapshot: state.luaOperationPrompt.prompt is required");
    expect(() => restoreDuel(badPromptApi, createCardReader(cards))).toThrow("Malformed duel snapshot: state.luaOperationPrompt.prompt.api must be a Lua prompt api");
    expect(() => restoreDuel(badPromptDescriptions, createCardReader(cards))).toThrow("Malformed duel snapshot: state.luaOperationPrompt.prompt.descriptions must match options length");
    expect(() => restoreDuel(badOptionPromptDescription, createCardReader(cards))).toThrow("Malformed duel snapshot: state.luaOperationPrompt.prompt.description is only valid for yes/no prompt APIs");
    expect(() => restoreDuel(badYesNoPromptOptions, createCardReader(cards))).toThrow("Malformed duel snapshot: state.luaOperationPrompt.prompt.options is only valid for option-like prompt APIs");
    expect(() => restoreDuel(badChainLinkSource, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chain.0.sourceUid must reference a card");
  });

  it("rejects unknown chain link snapshot fields before restore", () => {
    const session = createDuel({ seed: 241, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const snapshot = serializeDuel(session);
    snapshot.state.chain = [{ id: "link", player: 0, sourceUid: snapshot.state.cards[0]!.uid, effectId: "effect", staleChain: true } as unknown as typeof snapshot.state.chain[number]];

    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chain.0.staleChain is not a known field");
  });

  it("rejects missing chain target and event card snapshots before restore", () => {
    const session = createDuel({ seed: 169, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const sourceUid = serializeDuel(session).state.cards[0]!.uid;
    const badTarget = serializeDuel(session);
    const badEventCard = serializeDuel(session);
    const badEventUid = serializeDuel(session);
    badTarget.state.chain = [{ id: "link", player: 0, sourceUid, effectId: "effect", targetUids: ["missing"] }];
    badEventCard.state.chain = [{ id: "link", player: 0, sourceUid, effectId: "effect", eventCardUid: "missing" }];
    badEventUid.state.chain = [{ id: "link", player: 0, sourceUid, effectId: "effect", eventUids: ["missing"] }];

    expect(() => restoreDuel(badTarget, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chain.0.targetUids.0 must reference a card");
    expect(() => restoreDuel(badEventCard, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chain.0.eventCardUid must reference a card");
    expect(() => restoreDuel(badEventUid, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chain.0.eventUids.0 must reference a card");
  });

  it("rejects missing chain and effect source card snapshots before restore", () => {
    const session = createDuel({ seed: 164, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const source = findPublicCard(session, 0, "hand", "100");
    expect(source).toBeTruthy();
    registerEffect(session, {
      id: "snapshot-missing-source-effect",
      registryKey: "snapshot-missing-source-effect",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation() {},
    });
    const missingChainSource = serializeDuel(session);
    const missingEffectSource = serializeDuel(session);
    missingChainSource.state.chain = [{ id: "link", player: 0, sourceUid: "missing", effectId: "effect" }];
    missingEffectSource.state.effects[0] = { ...missingEffectSource.state.effects[0]!, sourceUid: "missing" };

    expect(() => restoreDuel(missingChainSource, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chain.0.sourceUid must reference a card");
    expect(() => restoreDuel(missingEffectSource, createCardReader(cards))).toThrow("Malformed duel snapshot: state.effects.0.sourceUid must reference a card");
  });

  it("rejects malformed chain limit snapshots before restore", () => {
    const session = createDuel({ seed: 154, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badRegistryKey = serializeDuel(session);
    const badExpiry = serializeDuel(session);
    const badUntilEndExpiry = serializeDuel(session);
    const missingExpiry = serializeDuel(session);
    badRegistryKey.state.chainLimits = [{ registryKey: 7 as unknown as string, untilChainEnd: true }];
    badExpiry.state.chainLimits = [{ registryKey: "limit", expiresAtChainLength: "one" as unknown as number, untilChainEnd: true }];
    badUntilEndExpiry.state.chainLimits = [{ registryKey: "limit", expiresAtChainLength: 1, untilChainEnd: true }];
    missingExpiry.state.chainLimits = [{ registryKey: "limit", untilChainEnd: false }];

    expect(() => restoreDuel(badRegistryKey, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chainLimits.0.registryKey must be a string");
    expect(() => restoreDuel(badExpiry, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chainLimits.0.expiresAtChainLength must be a number");
    expect(() => restoreDuel(badUntilEndExpiry, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chainLimits.0.expiresAtChainLength must not be set for until-chain-end limits");
    expect(() => restoreDuel(missingExpiry, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chainLimits.0.expiresAtChainLength is required for non-until-chain-end limits");
  });

  it("rejects unknown chain limit, skipped phase, and activity history snapshot fields before restore", () => {
    const session = createDuel({ seed: 236, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badLimit = serializeDuel(session);
    const badSkip = serializeDuel(session);
    const badActivity = serializeDuel(session);
    badLimit.state.chainLimits = [{ registryKey: "limit", untilChainEnd: true, staleScope: "all" } as typeof badLimit.state.chainLimits[number]];
    badSkip.state.skippedPhases = [{ player: 0, phase: "battle", remaining: 1, staleSkip: true } as typeof badSkip.state.skippedPhases[number]];
    badActivity.state.activityHistory = [{ player: 0, activity: 1, staleSource: "ui" } as typeof badActivity.state.activityHistory[number]];

    expect(() => restoreDuel(badLimit, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chainLimits.0.staleScope is not a known field");
    expect(() => restoreDuel(badSkip, createCardReader(cards))).toThrow("Malformed duel snapshot: state.skippedPhases.0.staleSkip is not a known field");
    expect(() => restoreDuel(badActivity, createCardReader(cards))).toThrow("Malformed duel snapshot: state.activityHistory.0.staleSource is not a known field");
  });

  it("rejects malformed phase and activity history snapshots before restore", () => {
    const session = createDuel({ seed: 155, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badSkip = serializeDuel(session);
    const badActivity = serializeDuel(session);
    const badActivityEffect = serializeDuel(session);
    badSkip.state.skippedPhases = [{ player: 0, phase: "combat" as "battle", remaining: 1 }];
    badActivity.state.activityHistory = [{ player: 0, activity: "attack" as unknown as number }];
    badActivityEffect.state.activityHistory = [{ player: 0, activity: 0x20, effectId: 7 as unknown as string }];

    expect(() => restoreDuel(badSkip, createCardReader(cards))).toThrow("Malformed duel snapshot: state.skippedPhases.0.phase must be a duel phase");
    expect(() => restoreDuel(badActivity, createCardReader(cards))).toThrow("Malformed duel snapshot: state.activityHistory.0.activity must be a number");
    expect(() => restoreDuel(badActivityEffect, createCardReader(cards))).toThrow("Malformed duel snapshot: state.activityHistory.0.effectId must be a string");
  });

  it("rejects impossible skipped phase snapshots before restore", () => {
    const session = createDuel({ seed: 231, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const duplicate = serializeDuel(session);
    const zeroRemaining = serializeDuel(session);
    duplicate.state.skippedPhases = [
      { player: 0, phase: "battle", remaining: 1 },
      { player: 0, phase: "battle", remaining: 2 },
    ];
    zeroRemaining.state.skippedPhases = [{ player: 1, phase: "main2", remaining: 0 }];

    expect(() => restoreDuel(duplicate, createCardReader(cards))).toThrow("Malformed duel snapshot: state.skippedPhases.1 must be unique by player and phase");
    expect(() => restoreDuel(zeroRemaining, createCardReader(cards))).toThrow("Malformed duel snapshot: state.skippedPhases.0.remaining must be positive");
  });

  it("rejects missing activity history card references before restore", () => {
    const session = createDuel({ seed: 171, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const snapshot = serializeDuel(session);
    snapshot.state.activityHistory = [{ player: 0, activity: 1, cardUid: "missing" }];

    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: state.activityHistory.0.cardUid must reference a card");
  });

  it("rejects malformed flag and log snapshots before restore", () => {
    const session = createDuel({ seed: 156, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badFlag = serializeDuel(session);
    const badLog = serializeDuel(session);
    badFlag.state.flagEffects = [{ ownerType: "duel" as "player", ownerId: "0", code: 1, reset: 0, property: 0, value: 1, turn: 1 }];
    badLog.state.log = [{ step: 1, action: "bad", player: 2 as 0, detail: "bad player" }];

    expect(() => restoreDuel(badFlag, createCardReader(cards))).toThrow("Malformed duel snapshot: state.flagEffects.0.ownerType must be a flag owner type");
    expect(() => restoreDuel(badLog, createCardReader(cards))).toThrow("Malformed duel snapshot: state.log.0.player must be a player id");
  });

  it("rejects unknown flag, log, and operation info snapshot fields before restore", () => {
    const session = createDuel({ seed: 237, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badFlag = serializeDuel(session);
    const badLog = serializeDuel(session);
    const badOperationInfo = serializeDuel(session);
    badFlag.state.flagEffects = [{ ownerType: "player", ownerId: "0", code: 1, reset: 0, property: 0, value: 1, turn: 1, staleFlag: 1 } as typeof badFlag.state.flagEffects[number]];
    badLog.state.log = [{ step: 1, action: "bad", detail: "bad field", staleLog: true } as typeof badLog.state.log[number]];
    badOperationInfo.state.chain = [{ id: "chain-1", effectId: "effect-1", sourceUid: badOperationInfo.state.cards[0]!.uid, player: 0, operationInfos: [{ category: 1, count: 1, parameter: 0, player: 0, targetUids: [], staleInfo: "extra" }] }] as unknown as typeof badOperationInfo.state.chain;

    expect(() => restoreDuel(badFlag, createCardReader(cards))).toThrow("Malformed duel snapshot: state.flagEffects.0.staleFlag is not a known field");
    expect(() => restoreDuel(badLog, createCardReader(cards))).toThrow("Malformed duel snapshot: state.log.0.staleLog is not a known field");
    expect(() => restoreDuel(badOperationInfo, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chain.0.operationInfos.0.staleInfo is not a known field");
  });

  it("rejects malformed flag owner snapshots before restore", () => {
    const session = createDuel({ seed: 172, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badPlayer = serializeDuel(session);
    const badCard = serializeDuel(session);
    badPlayer.state.flagEffects = [{ ownerType: "player", ownerId: "2", code: 1, reset: 0, property: 0, value: 1, turn: 1 }];
    badCard.state.flagEffects = [{ ownerType: "card", ownerId: "missing", code: 1, reset: 0, property: 0, value: 1, turn: 1 }];

    expect(() => restoreDuel(badPlayer, createCardReader(cards))).toThrow("Malformed duel snapshot: state.flagEffects.0.ownerId must be a player id");
    expect(() => restoreDuel(badCard, createCardReader(cards))).toThrow("Malformed duel snapshot: state.flagEffects.0.ownerId must reference a card");
  });

});
