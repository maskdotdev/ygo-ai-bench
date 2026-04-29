import { describe, expect, it } from "vitest";
import {
  applyResponse,
  banishDuelCard,
  canDuelCardAttack,
  canChangeDuelCardPosition,
  canMoveDuelCardToLocation,
  changeDuelCardPosition,
  canSpecialSummonDuelCard,
  createDuel,
  damageDuelPlayer,
  declareDuelAttack,
  destroyDuelCard,
  detachDuelOverlayMaterials,
  getDuelAttackTargets,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  queryPublicState,
  registerEffect,
  restoreDuel,
  serializeDuel,
  sendDuelCardToGraveyard,
  recoverDuelPlayer,
  setDuelPlayerLifePoints,
  specialSummonDuelCard,
  startDuel,
  ritualSummonDuelCard,
  tributeSummonDuelCard,
  flipSummonDuelCard,
  fusionSummonDuelCard,
  linkSummonDuelCard,
  synchroSummonDuelCard,
  xyzSummonDuelCard,
} from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { duelReason } from "#duel/reasons.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";

const cards: DuelCardData[] = [
  { code: "100", name: "Normal Test Monster", kind: "monster", attack: 1800, defense: 1200 },
  { code: "110", name: "Level Three Tuner", kind: "monster", typeFlags: 0x1001, level: 3, attack: 1200, defense: 800 },
  { code: "200", name: "Test Spell", kind: "spell" },
  { code: "300", name: "Second Monster", kind: "monster", attack: 1000, defense: 1000 },
  { code: "310", name: "Level Four Non-Tuner", kind: "monster", typeFlags: 0x1, level: 4, attack: 1600, defense: 1000 },
  { code: "320", name: "Level Three Non-Tuner", kind: "monster", typeFlags: 0x1, level: 3, attack: 1300, defense: 900 },
  { code: "330", name: "Second Level Four Non-Tuner", kind: "monster", typeFlags: 0x1, level: 4, attack: 1400, defense: 1100 },
  { code: "340", name: "Level One Non-Tuner", kind: "monster", typeFlags: 0x1, level: 1, attack: 500, defense: 500 },
  { code: "350", name: "Pendulum Test Monster", kind: "monster", typeFlags: 0x1000001, level: 4, attack: 1500, defense: 1500 },
  { code: "400", name: "Opponent Monster", kind: "monster", attack: 1500, defense: 1600 },
  { code: "500", name: "Third Monster", kind: "monster", attack: 2400, defense: 2000 },
  { code: "600", name: "One Tribute Monster", kind: "monster", level: 6, attack: 2300, defense: 1800 },
  { code: "700", name: "Two Tribute Monster", kind: "monster", level: 7, attack: 2600, defense: 2100 },
  { code: "900", name: "Fusion Test Monster", kind: "extra", attack: 2800, defense: 2200, fusionMaterials: ["100", "300"] },
  { code: "910", name: "Synchro Test Monster", kind: "extra", attack: 2500, defense: 2000, synchroMaterials: { tuner: "100", nonTuners: ["300"] } },
  { code: "920", name: "Xyz Test Monster", kind: "extra", attack: 2400, defense: 2000, xyzMaterials: ["100", "300"] },
  { code: "930", name: "Link Test Monster", kind: "extra", attack: 2300, linkMaterials: ["100", "300"] },
  { code: "950", name: "Generic Link-2", kind: "extra", attack: 1800, typeFlags: 0x4000001, level: 2 },
  { code: "960", name: "Generic Link-3", kind: "extra", attack: 2400, typeFlags: 0x4000001, level: 3 },
  { code: "970", name: "Generic Level 7 Synchro", kind: "extra", attack: 2600, defense: 2100, typeFlags: 0x2001, level: 7 },
  { code: "980", name: "Generic Rank 4 Xyz", kind: "extra", attack: 2200, defense: 1800, typeFlags: 0x800001, level: 4 },
  { code: "940", name: "Ritual Test Monster", kind: "monster", attack: 2500, defense: 2100, ritualMaterials: ["100", "300"] },
];

describe("full duel engine API", () => {
  it("starts a deterministic two-player duel and exposes legal responses", () => {
    const session = createDuel({ seed: 7, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const state = queryPublicState(session);
    expect(state.status).toBe("awaiting");
    expect(state.turn).toBe(1);
    expect(state.phase).toBe("main1");
    expect(state.cards.filter((card) => card.controller === 0 && card.location === "hand")).toHaveLength(2);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "normalSummon")).toBe(true);
    expect(getDuelLegalActions(session, 1)).toEqual([]);
  });

  it("exposes pending prompts as legal responses and preserves them in snapshots", () => {
    const session = createDuel({ seed: 71, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    session.state.prompt = { id: "prompt-1", type: "selectOption", player: 1, options: [0, 2], returnTo: 0 };
    session.state.waitingFor = 1;

    expect(queryPublicState(session).prompt).toEqual({ id: "prompt-1", type: "selectOption", player: 1, options: [0, 2], returnTo: 0 });
    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(queryPublicState(restored).prompt).toEqual({ id: "prompt-1", type: "selectOption", player: 1, options: [0, 2], returnTo: 0 });
    expect(getDuelLegalActions(restored, 0)).toEqual([]);

    const options = getDuelLegalActions(restored, 1);
    expect(options).toEqual([
      { type: "selectOption", player: 1, promptId: "prompt-1", option: 0, label: "Select option 0" },
      { type: "selectOption", player: 1, promptId: "prompt-1", option: 2, label: "Select option 2" },
    ]);
    const optionResult = applyResponse(restored, options[1]!);
    expect(optionResult.ok).toBe(true);
    expect(optionResult.state.prompt).toBeUndefined();
    expect(optionResult.state.waitingFor).toBe(0);
    expect(optionResult.state.log.some((entry) => entry.action === "selectOption" && entry.detail === "Selected option 2")).toBe(true);

    restored.state.prompt = { id: "prompt-2", type: "selectYesNo", player: 0, description: 123 };
    restored.state.waitingFor = 0;
    const no = getDuelLegalActions(restored, 0).find((action) => action.type === "selectYesNo" && !action.yes);
    expect(no).toEqual({ type: "selectYesNo", player: 0, promptId: "prompt-2", yes: false, label: "No" });
    const yesNoResult = applyResponse(restored, no!);
    expect(yesNoResult.ok).toBe(true);
    expect(yesNoResult.state.log.some((entry) => entry.action === "selectYesNo" && entry.detail === "Selected no")).toBe(true);
  });

  it("applies legal responses and preserves zone invariants through serialization", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon");
    expect(summon).toBeTruthy();
    expect(applyResponse(session, summon!).ok).toBe(true);
    expect(getDuelLegalActions(session, 0).filter((action) => action.type === "normalSummon")).toHaveLength(0);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    const publicState = queryPublicState(restored);
    expect(publicState.cards.filter((card) => card.location === "monsterZone" && card.controller === 0)).toHaveLength(1);
    expect(publicState.cards.map((card) => card.uid)).toHaveLength(new Set(publicState.cards.map((card) => card.uid)).size);
  });

  it("resolves registered once-per-turn effects through the chain", () => {
    const session = createDuel({ seed: 2, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand");
    expect(source).toBeTruthy();
    registerEffect(session, {
      id: "send-self",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      oncePerTurn: true,
      operation(ctx) {
        ctx.moveCard(ctx.source.uid, "graveyard");
        ctx.log("Sent itself to the Graveyard");
      },
    });

    const effect = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "send-self");
    expect(effect).toBeTruthy();
    const result = applyResponse(session, effect!);

    expect(result.ok).toBe(true);
    expect(result.state.chain).toHaveLength(0);
    expect(result.state.cards.find((card) => card.uid === source!.uid)?.location).toBe("graveyard");
    expect(result.state.log.some((entry) => entry.detail.includes("Sent itself"))).toBe(true);
  });

  it("lets an opponent quick effect chain before the original operation resolves", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const originalSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const quickSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(originalSource).toBeTruthy();
    expect(quickSource).toBeTruthy();
    registerEffect(session, {
      id: "original-effect",
      sourceUid: originalSource!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Original operation resolved");
      },
    });
    registerEffect(session, {
      id: "quick-response",
      sourceUid: quickSource!.uid,
      controller: 1,
      event: "quick",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Quick response resolved");
      },
    });

    const original = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "original-effect");
    expect(original).toBeTruthy();
    const opened = applyResponse(session, original!);

    expect(opened.ok).toBe(true);
    expect(opened.state.chain).toHaveLength(1);
    expect(opened.state.waitingFor).toBe(1);
    expect(opened.state.log.some((entry) => entry.detail === "Original operation resolved")).toBe(false);

    const response = getDuelLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.effectId === "quick-response");
    expect(response).toBeTruthy();
    const resolved = applyResponse(session, response!);
    const quickLog = resolved.state.log.find((entry) => entry.detail === "Quick response resolved");
    const originalLog = resolved.state.log.find((entry) => entry.detail === "Original operation resolved");

    expect(resolved.ok).toBe(true);
    expect(resolved.state.chain).toHaveLength(0);
    expect(quickLog).toBeTruthy();
    expect(originalLog).toBeTruthy();
    expect(quickLog!.step).toBeLessThan(originalLog!.step);
  });

  it("persists targets on delayed chain links", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const target = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "500");
    const responseSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(source).toBeTruthy();
    expect(target).toBeTruthy();
    expect(responseSource).toBeTruthy();
    registerEffect(session, {
      id: "targeted-send",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      target(ctx) {
        ctx.setTargets([target!.uid]);
        return true;
      },
      operation(ctx) {
        const [selected] = ctx.getTargets();
        if (selected) ctx.moveCard(selected.uid, "graveyard", selected.controller);
        ctx.log(`Resolved with ${ctx.targetUids.length} target`);
      },
    });
    registerEffect(session, {
      id: "target-response",
      sourceUid: responseSource!.uid,
      controller: 1,
      event: "quick",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Response resolved before target");
      },
    });

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "targeted-send");
    expect(action).toBeTruthy();
    const opened = applyResponse(session, action!);

    expect(opened.ok).toBe(true);
    expect(opened.state.chain).toHaveLength(1);
    expect(opened.state.chain[0]?.targetUids).toEqual([target!.uid]);
    expect(opened.state.cards.find((card) => card.uid === target!.uid)?.location).toBe("hand");

    const response = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "target-response");
    expect(response).toBeTruthy();
    const resolved = applyResponse(session, response!);

    expect(resolved.ok).toBe(true);
    expect(resolved.state.cards.find((card) => card.uid === target!.uid)?.location).toBe("graveyard");
    expect(resolved.state.log.some((entry) => entry.detail === "Response resolved before target")).toBe(true);
    expect(resolved.state.log.some((entry) => entry.detail === "Resolved with 1 target")).toBe(true);
  });

  it("allows quick effects to negate earlier chain links", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const originalSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const quickSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(originalSource).toBeTruthy();
    expect(quickSource).toBeTruthy();
    registerEffect(session, {
      id: "negated-original",
      sourceUid: originalSource!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation(ctx) {
        ctx.moveCard(ctx.source.uid, "graveyard");
        ctx.log("Negated operation should not resolve");
      },
    });
    registerEffect(session, {
      id: "negating-response",
      sourceUid: quickSource!.uid,
      controller: 1,
      event: "quick",
      range: ["hand"],
      operation(ctx) {
        const target = ctx.duel.chain.find((link) => link.effectId === "negated-original");
        if (target) ctx.negateChainLink(target.id);
        ctx.log("Negation resolved");
      },
    });

    const original = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "negated-original");
    expect(original).toBeTruthy();
    const opened = applyResponse(session, original!);
    expect(opened.state.chain).toHaveLength(1);

    const response = getDuelLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.effectId === "negating-response");
    expect(response).toBeTruthy();
    const resolved = applyResponse(session, response!);

    expect(resolved.ok).toBe(true);
    expect(resolved.state.chain).toHaveLength(0);
    expect(resolved.state.cards.find((card) => card.uid === originalSource!.uid)?.location).toBe("hand");
    expect(resolved.state.log.some((entry) => entry.action === "negate" && entry.detail === "negated-original")).toBe(true);
    expect(resolved.state.log.some((entry) => entry.action === "chainNegated" && entry.detail === "negated-original")).toBe(true);
    expect(resolved.state.log.some((entry) => entry.detail === "Negation resolved")).toBe(true);
    expect(resolved.state.log.some((entry) => entry.detail === "Negated operation should not resolve")).toBe(false);
  });

  it("resolves a pending chain when the responding player passes", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const originalSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const quickSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(originalSource).toBeTruthy();
    expect(quickSource).toBeTruthy();
    registerEffect(session, {
      id: "pass-original",
      sourceUid: originalSource!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Passed chain resolved");
      },
    });
    registerEffect(session, {
      id: "available-quick",
      sourceUid: quickSource!.uid,
      controller: 1,
      event: "quick",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Should not resolve");
      },
    });

    const original = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "pass-original");
    expect(original).toBeTruthy();
    expect(applyResponse(session, original!).state.chain).toHaveLength(1);

    const pass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(pass).toBeTruthy();
    const resolved = applyResponse(session, pass!);

    expect(resolved.ok).toBe(true);
    expect(resolved.state.chain).toHaveLength(0);
    expect(resolved.state.log.some((entry) => entry.detail === "Passed chain resolved")).toBe(true);
    expect(resolved.state.log.some((entry) => entry.detail === "Should not resolve")).toBe(false);
  });

  it("marks once-per-turn quick effects as used when chained", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const originalSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const playerQuickSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const opponentQuickSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(originalSource).toBeTruthy();
    expect(playerQuickSource).toBeTruthy();
    expect(opponentQuickSource).toBeTruthy();
    registerEffect(session, {
      id: "chain-starter",
      sourceUid: originalSource!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Starter resolved");
      },
    });
    registerEffect(session, {
      id: "player-quick",
      sourceUid: playerQuickSource!.uid,
      controller: 0,
      event: "quick",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Player quick resolved");
      },
    });
    registerEffect(session, {
      id: "opponent-quick-once",
      sourceUid: opponentQuickSource!.uid,
      controller: 1,
      event: "quick",
      range: ["hand"],
      oncePerTurn: true,
      operation(ctx) {
        ctx.log("Opponent quick resolved");
      },
    });

    const starter = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "chain-starter");
    expect(starter).toBeTruthy();
    expect(applyResponse(session, starter!).state.waitingFor).toBe(1);
    const opponentQuick = getDuelLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.effectId === "opponent-quick-once");
    expect(opponentQuick).toBeTruthy();
    const chained = applyResponse(session, opponentQuick!);

    expect(chained.ok).toBe(true);
    expect(chained.state.chain).toHaveLength(2);
    expect(chained.state.waitingFor).toBe(0);

    const pass = getDuelLegalActions(session, 0).find((action) => action.type === "passChain");
    expect(pass).toBeTruthy();
    const resolved = applyResponse(session, pass!);

    expect(resolved.ok).toBe(true);
    expect(resolved.state.chain).toHaveLength(0);
    expect(resolved.state.waitingFor).toBe(0);
    expect(resolved.state.log.filter((entry) => entry.detail === "Opponent quick resolved")).toHaveLength(1);
  });

  it("resets once-per-turn effect usage on a later turn", () => {
    const session = createDuel({ seed: 3, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(source).toBeTruthy();
    registerEffect(session, {
      id: "repeat-next-turn",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["monsterZone"],
      oncePerTurn: true,
      operation(ctx) {
        ctx.log(`Resolved on turn ${ctx.duel.turn}`);
      },
    });

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === source!.uid);
    expect(summon).toBeTruthy();
    expect(applyResponse(session, summon!).ok).toBe(true);

    const firstActivation = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "repeat-next-turn");
    expect(firstActivation).toBeTruthy();
    expect(applyResponse(session, firstActivation!).ok).toBe(true);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "activateEffect" && action.effectId === "repeat-next-turn")).toBe(false);

    const playerEnd = getDuelLegalActions(session, 0).find((action) => action.type === "endTurn");
    expect(playerEnd).toBeTruthy();
    expect(applyResponse(session, playerEnd!).ok).toBe(true);
    const opponentEnd = getDuelLegalActions(session, 1).find((action) => action.type === "endTurn");
    expect(opponentEnd).toBeTruthy();
    expect(applyResponse(session, opponentEnd!).ok).toBe(true);

    expect(queryPublicState(session).turn).toBe(3);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "activateEffect" && action.effectId === "repeat-next-turn")).toBe(true);
  });

  it("exposes trigger effects as pending legal responses after a normal summon", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const summoned = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(summoned).toBeTruthy();
    expect(triggerSource).toBeTruthy();

    registerEffect(session, {
      id: "on-normal-summon",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.moveCard(ctx.source.uid, "graveyard");
        ctx.log(`Saw ${ctx.eventCard?.name ?? "a card"} Normal Summoned`);
      },
    });

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeTruthy();
    const summonResult = applyResponse(session, summon!);

    expect(summonResult.ok).toBe(true);
    expect(summonResult.state.pendingTriggers).toHaveLength(1);
    expect(summonResult.state.cards.find((card) => card.uid === triggerSource!.uid)?.location).toBe("hand");
    const trigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger");
    expect(trigger).toBeTruthy();
    const triggerResult = applyResponse(session, trigger!);

    expect(triggerResult.ok).toBe(true);
    expect(triggerResult.state.pendingTriggers).toHaveLength(0);
    expect(triggerResult.state.cards.find((card) => card.uid === triggerSource!.uid)?.location).toBe("graveyard");
    expect(triggerResult.state.log.some((entry) => entry.action === "trigger" && entry.detail === "on-normal-summon")).toBe(true);
    expect(triggerResult.state.log.some((entry) => entry.detail.includes("Normal Summoned"))).toBe(true);
  });

  it("lets quick effects respond to trigger activations", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const summoned = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const quickSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(summoned).toBeTruthy();
    expect(triggerSource).toBeTruthy();
    expect(quickSource).toBeTruthy();

    registerEffect(session, {
      id: "chainable-trigger",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.log(`Trigger saw ${ctx.eventCard?.name ?? "missing card"}`);
      },
    });
    registerEffect(session, {
      id: "trigger-response",
      sourceUid: quickSource!.uid,
      controller: 1,
      event: "quick",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Quick response to trigger resolved");
      },
    });

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeTruthy();
    expect(applyResponse(session, summon!).state.pendingTriggers).toHaveLength(1);
    const trigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === "chainable-trigger");
    expect(trigger).toBeTruthy();
    const opened = applyResponse(session, trigger!);

    expect(opened.ok).toBe(true);
    expect(opened.state.chain).toHaveLength(1);
    expect(opened.state.pendingTriggers).toHaveLength(0);
    expect(opened.state.waitingFor).toBe(1);
    expect(opened.state.log.some((entry) => entry.detail.includes("Trigger saw"))).toBe(false);

    const response = getDuelLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.effectId === "trigger-response");
    expect(response).toBeTruthy();
    const resolved = applyResponse(session, response!);
    const quickLog = resolved.state.log.find((entry) => entry.detail === "Quick response to trigger resolved");
    const triggerLog = resolved.state.log.find((entry) => entry.detail.includes("Trigger saw Normal Test Monster"));

    expect(resolved.ok).toBe(true);
    expect(resolved.state.chain).toHaveLength(0);
    expect(quickLog).toBeTruthy();
    expect(triggerLog).toBeTruthy();
    expect(quickLog!.step).toBeLessThan(triggerLog!.step);
  });

  it("allows optional trigger effects to be declined", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const summoned = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(summoned).toBeTruthy();
    expect(triggerSource).toBeTruthy();

    registerEffect(session, {
      id: "optional-trigger",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.moveCard(ctx.source.uid, "graveyard");
        ctx.log("Declined effect should not resolve");
      },
    });

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeTruthy();
    expect(applyResponse(session, summon!).ok).toBe(true);

    const decline = getDuelLegalActions(session, 0).find((action) => action.type === "declineTrigger");
    expect(decline).toBeTruthy();
    const result = applyResponse(session, decline!);

    expect(result.ok).toBe(true);
    expect(result.state.pendingTriggers).toHaveLength(0);
    expect(result.state.cards.find((card) => card.uid === triggerSource!.uid)?.location).toBe("hand");
    expect(result.state.log.some((entry) => entry.detail.includes("Declined effect should not resolve"))).toBe(false);
    expect(result.state.log.some((entry) => entry.action === "declineTrigger" && entry.detail === "optional-trigger")).toBe(true);
  });

  it("lets a player choose the order of multiple pending triggers", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const publicState = queryPublicState(session);
    const summoned = publicState.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const firstSource = publicState.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const secondSource = publicState.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(summoned).toBeTruthy();
    expect(firstSource).toBeTruthy();
    expect(secondSource).toBeTruthy();

    registerEffect(session, {
      id: "first-trigger",
      sourceUid: firstSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.moveCard(ctx.source.uid, "graveyard");
        ctx.log("First trigger resolved");
      },
    });
    registerEffect(session, {
      id: "second-trigger",
      sourceUid: secondSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.moveCard(ctx.source.uid, "graveyard");
        ctx.log("Second trigger resolved");
      },
    });

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeTruthy();
    const summonResult = applyResponse(session, summon!);
    expect(summonResult.ok).toBe(true);
    expect(summonResult.state.pendingTriggers).toHaveLength(2);

    const second = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === "second-trigger");
    expect(second).toBeTruthy();
    const secondResult = applyResponse(session, second!);
    expect(secondResult.ok).toBe(true);
    expect(secondResult.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["first-trigger"]);
    expect(secondResult.state.cards.find((card) => card.uid === secondSource!.uid)?.location).toBe("graveyard");
    expect(secondResult.state.cards.find((card) => card.uid === firstSource!.uid)?.location).toBe("hand");
  });

  it("collects phase and turn-start trigger effects", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const phaseSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const turnSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(phaseSource).toBeTruthy();
    expect(turnSource).toBeTruthy();

    registerEffect(session, {
      id: "on-phase-change",
      sourceUid: phaseSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "phaseChanged",
      range: ["monsterZone"],
      operation(ctx) {
        ctx.log(`Observed ${ctx.eventName ?? "missing event"}`);
      },
    });
    registerEffect(session, {
      id: "on-turn-start",
      sourceUid: turnSource!.uid,
      controller: 1,
      event: "trigger",
      triggerEvent: "turnStarted",
      range: ["hand"],
      operation(ctx) {
        ctx.log(`Observed ${ctx.eventName ?? "missing event"}`);
      },
    });

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === phaseSource!.uid);
    expect(summon).toBeTruthy();
    expect(applyResponse(session, summon!).ok).toBe(true);
    const battlePhase = getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battlePhase).toBeTruthy();
    const phaseResult = applyResponse(session, battlePhase!);

    expect(phaseResult.ok).toBe(true);
    expect(phaseResult.state.pendingTriggers).toHaveLength(1);
    expect(phaseResult.state.pendingTriggers[0]).toMatchObject({ eventName: "phaseChanged", effectId: "on-phase-change" });
    expect(phaseResult.state.pendingTriggers[0]?.eventCardUid).toBeUndefined();
    const phaseTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === "on-phase-change");
    expect(phaseTrigger).toBeTruthy();
    expect(applyResponse(session, phaseTrigger!).ok).toBe(true);

    const endTurn = getDuelLegalActions(session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeTruthy();
    const turnResult = applyResponse(session, endTurn!);

    expect(turnResult.ok).toBe(true);
    expect(turnResult.state.turn).toBe(2);
    expect(turnResult.state.pendingTriggers).toHaveLength(1);
    expect(turnResult.state.pendingTriggers[0]).toMatchObject({ player: 1, eventName: "turnStarted", effectId: "on-turn-start" });
  });

  it("collects trigger effects after a special summon operation", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const summoned = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(source).toBeTruthy();
    expect(summoned).toBeTruthy();
    expect(triggerSource).toBeTruthy();

    registerEffect(session, {
      id: "summon-from-hand",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation(ctx) {
        specialSummonDuelCard(ctx.duel, summoned!.uid, ctx.player);
      },
    });
    registerEffect(session, {
      id: "on-special-summon",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "specialSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.log(`Saw ${ctx.eventCard?.name ?? "missing card"} Special Summoned`);
      },
    });

    const activation = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "summon-from-hand");
    expect(activation).toBeTruthy();
    const activationResult = applyResponse(session, activation!);

    expect(activationResult.ok).toBe(true);
    expect(activationResult.state.cards.find((card) => card.uid === summoned!.uid)?.location).toBe("monsterZone");
    expect(activationResult.state.pendingTriggers).toHaveLength(1);
    expect(activationResult.state.pendingTriggers[0]).toMatchObject({ eventName: "specialSummoned", eventCardUid: summoned!.uid });
    const trigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === "on-special-summon");
    expect(trigger).toBeTruthy();
    const triggerResult = applyResponse(session, trigger!);

    expect(triggerResult.ok).toBe(true);
    expect(triggerResult.state.log.some((entry) => entry.detail.includes("Second Monster Special Summoned"))).toBe(true);
  });

  it("fusion summons from the extra deck using hand materials", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["900"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const fusion = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "900");
    expect(fusion).toBeTruthy();
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "fusionSummon" && candidate.uid === fusion!.uid);
    expect(action).toBeTruthy();
    expect(action?.type).toBe("fusionSummon");
    if (!action || action.type !== "fusionSummon") throw new Error("Expected fusion summon action");
    const result = applyResponse(session, action);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === fusion!.uid)?.location).toBe("monsterZone");
    expect(result.state.cards.find((card) => card.uid === fusion!.uid)?.position).toBe("faceUpAttack");
    expect(action.materialUids.every((uid) => result.state.cards.find((card) => card.uid === uid)?.location === "graveyard")).toBe(true);
    expect(result.state.log.some((entry) => entry.action === "fusionSummon" && entry.card === "Fusion Test Monster")).toBe(true);
  });

  it("fusion summons using mixed hand and field materials and emits special summon triggers", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"], extra: ["900"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const fieldMaterial = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const fusion = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "900");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(fieldMaterial).toBeTruthy();
    expect(fusion).toBeTruthy();
    expect(triggerSource).toBeTruthy();
    moveDuelCard(session.state, fieldMaterial!.uid, "monsterZone", 0);
    registerEffect(session, {
      id: "fusion-special-trigger",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "specialSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.log(`Fusion special summoned ${ctx.eventCard?.name}`);
      },
    });

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "fusionSummon" && candidate.uid === fusion!.uid);
    expect(action).toBeTruthy();
    const fusionResult = applyResponse(session, action!);

    expect(fusionResult.ok).toBe(true);
    expect(fusionResult.state.cards.find((card) => card.uid === fieldMaterial!.uid)?.location).toBe("graveyard");
    expect(fusionResult.state.pendingTriggers).toHaveLength(1);
    expect(fusionResult.state.pendingTriggers[0]).toMatchObject({ eventName: "specialSummoned", eventCardUid: fusion!.uid });

    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.effectId === "fusion-special-trigger");
    expect(trigger).toBeTruthy();
    const result = applyResponse(session, trigger!);

    expect(result.ok).toBe(true);
    expect(result.state.log.some((entry) => entry.detail === "Fusion special summoned Fusion Test Monster")).toBe(true);
  });

  it("does not expose fusion summon actions without all materials or with no monster zone space", () => {
    const missing = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(missing, {
      0: { main: ["100"], extra: ["900"] },
      1: { main: ["400"] },
    });
    startDuel(missing);
    expect(getDuelLegalActions(missing, 0).some((candidate) => candidate.type === "fusionSummon")).toBe(false);

    const full = createDuel({ seed: 1, startingHandSize: 7, cardReader: createCardReader(cards) });
    loadDecks(full, {
      0: { main: ["100", "300", "500", "500", "500", "500", "500"], extra: ["900"] },
      1: { main: ["400", "400", "400", "400", "400", "400", "400"] },
    });
    startDuel(full);
    const blockers = queryPublicState(full).cards.filter((card) => card.controller === 0 && card.location === "hand" && card.kind === "monster" && card.code === "500");
    expect(blockers).toHaveLength(5);
    for (const blocker of blockers) moveDuelCard(full.state, blocker.uid, "monsterZone", 0);
    expect(getDuelLegalActions(full, 0).some((candidate) => candidate.type === "fusionSummon")).toBe(false);

    const fusion = queryPublicState(full).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "900");
    const materials = queryPublicState(full).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "100" || card.code === "300"));
    expect(fusion).toBeTruthy();
    expect(materials).toHaveLength(2);
    expect(() => fusionSummonDuelCard(full.state, 0, fusion!.uid, materials.map((card) => card.uid))).toThrow("monsterZone is full");
  });

  it("synchro summons from the extra deck using field materials", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["910"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const synchro = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "910");
    const materials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "100" || card.code === "300"));
    expect(synchro).toBeTruthy();
    expect(materials).toHaveLength(2);
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "synchroSummon" && candidate.uid === synchro!.uid);
    expect(action).toBeTruthy();
    expect(action?.type).toBe("synchroSummon");
    if (!action || action.type !== "synchroSummon") throw new Error("Expected synchro summon action");
    const result = applyResponse(session, action);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === synchro!.uid)?.location).toBe("monsterZone");
    expect(action.materialUids.every((uid) => result.state.cards.find((card) => card.uid === uid)?.location === "graveyard")).toBe(true);
    expect(result.state.log.some((entry) => entry.action === "synchroSummon" && entry.card === "Synchro Test Monster")).toBe(true);
  });

  it("synchro summons emit special summon triggers", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"], extra: ["910"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const synchro = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "910");
    const materials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "100" || card.code === "300"));
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(synchro).toBeTruthy();
    expect(materials).toHaveLength(2);
    expect(triggerSource).toBeTruthy();
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);
    registerEffect(session, {
      id: "synchro-special-trigger",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "specialSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.log(`Synchro special summoned ${ctx.eventCard?.name}`);
      },
    });

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "synchroSummon" && candidate.uid === synchro!.uid);
    expect(action).toBeTruthy();
    const summonResult = applyResponse(session, action!);

    expect(summonResult.ok).toBe(true);
    expect(summonResult.state.pendingTriggers).toHaveLength(1);
    expect(summonResult.state.pendingTriggers[0]).toMatchObject({ eventName: "specialSummoned", eventCardUid: synchro!.uid });
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.effectId === "synchro-special-trigger");
    expect(trigger).toBeTruthy();
    const result = applyResponse(session, trigger!);

    expect(result.ok).toBe(true);
    expect(result.state.log.some((entry) => entry.detail === "Synchro special summoned Synchro Test Monster")).toBe(true);
  });

  it("synchro summons generic monsters with one tuner and matching levels", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["110", "310"], extra: ["970"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const synchro = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "970");
    const materials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "110" || card.code === "310"));
    expect(synchro).toBeTruthy();
    expect(materials).toHaveLength(2);
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "synchroSummon" && candidate.uid === synchro!.uid);
    expect(action).toBeTruthy();
    expect(action?.type).toBe("synchroSummon");
    if (!action || action.type !== "synchroSummon") throw new Error("Expected synchro summon action");
    const result = applyResponse(session, action);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === synchro!.uid)?.location).toBe("monsterZone");
    expect(action.materialUids.every((materialUid) => result.state.cards.find((card) => card.uid === materialUid)?.location === "graveyard")).toBe(true);
  });

  it("rejects generic synchro materials with the wrong level total", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["110", "320"], extra: ["970"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const synchro = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "970");
    const materials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "110" || card.code === "320"));
    expect(synchro).toBeTruthy();
    expect(materials).toHaveLength(2);
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);

    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "synchroSummon" && candidate.uid === synchro!.uid)).toBe(false);
    expect(() => synchroSummonDuelCard(session.state, 0, synchro!.uid, materials.map((card) => card.uid))).toThrow("synchro materials are not legal");
  });

  it("rejects generic synchro materials without exactly one tuner", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["310", "320"], extra: ["970"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const synchro = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "970");
    const materials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "310" || card.code === "320"));
    expect(synchro).toBeTruthy();
    expect(materials).toHaveLength(2);
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);

    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "synchroSummon" && candidate.uid === synchro!.uid)).toBe(false);
    expect(() => synchroSummonDuelCard(session.state, 0, synchro!.uid, materials.map((card) => card.uid))).toThrow("synchro materials are not legal");
  });

  it("does not treat non-synchro extra deck ranks as generic synchro targets", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["110", "340"], extra: ["980"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const xyz = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "980");
    const materials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "110" || card.code === "340"));
    expect(xyz).toBeTruthy();
    expect(materials).toHaveLength(2);
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);

    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "synchroSummon" && candidate.uid === xyz!.uid)).toBe(false);
    expect(() => synchroSummonDuelCard(session.state, 0, xyz!.uid, materials.map((card) => card.uid))).toThrow("synchro materials are not legal");
  });

  it("does not expose synchro summon actions without field materials or with no monster zone space", () => {
    const handOnly = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(handOnly, {
      0: { main: ["100", "300"], extra: ["910"] },
      1: { main: ["400", "400"] },
    });
    startDuel(handOnly);
    expect(getDuelLegalActions(handOnly, 0).some((candidate) => candidate.type === "synchroSummon")).toBe(false);

    const missing = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(missing, {
      0: { main: ["100"], extra: ["910"] },
      1: { main: ["400"] },
    });
    startDuel(missing);
    const tuner = queryPublicState(missing).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(tuner).toBeTruthy();
    moveDuelCard(missing.state, tuner!.uid, "monsterZone", 0);
    expect(getDuelLegalActions(missing, 0).some((candidate) => candidate.type === "synchroSummon")).toBe(false);

    const full = createDuel({ seed: 1, startingHandSize: 7, cardReader: createCardReader(cards) });
    loadDecks(full, {
      0: { main: ["100", "300", "500", "500", "500", "500", "500"], extra: ["910"] },
      1: { main: ["400", "400", "400", "400", "400", "400", "400"] },
    });
    startDuel(full);
    const allMonsters = queryPublicState(full).cards.filter((card) => card.controller === 0 && card.location === "hand" && card.kind === "monster");
    expect(allMonsters).toHaveLength(7);
    for (const monster of allMonsters.slice(0, 5)) moveDuelCard(full.state, monster.uid, "monsterZone", 0);
    expect(getDuelLegalActions(full, 0).some((candidate) => candidate.type === "synchroSummon")).toBe(false);

    const synchro = queryPublicState(full).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "910");
    const materials = queryPublicState(full).cards.filter((card) => card.controller === 0 && card.location === "monsterZone" && (card.code === "100" || card.code === "300"));
    expect(synchro).toBeTruthy();
    expect(materials).toHaveLength(2);
    expect(() => synchroSummonDuelCard(full.state, 0, synchro!.uid, materials.map((card) => card.uid))).toThrow("monsterZone is full");
  });

  it("xyz summons from the extra deck using field materials as overlays", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["920"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const xyz = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "920");
    const materials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "100" || card.code === "300"));
    expect(xyz).toBeTruthy();
    expect(materials).toHaveLength(2);
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "xyzSummon" && candidate.uid === xyz!.uid);
    expect(action).toBeTruthy();
    expect(action?.type).toBe("xyzSummon");
    if (!action || action.type !== "xyzSummon") throw new Error("Expected Xyz summon action");
    const result = applyResponse(session, action);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === xyz!.uid)?.location).toBe("monsterZone");
    expect(result.state.cards.find((card) => card.uid === xyz!.uid)?.overlayCount).toBe(2);
    expect(action.materialUids.every((uid) => result.state.cards.find((card) => card.uid === uid)?.location === "overlay")).toBe(true);
    expect(result.state.log.some((entry) => entry.action === "xyzSummon" && entry.card === "Xyz Test Monster")).toBe(true);
  });

  it("xyz summons emit special summon triggers without sending materials to the graveyard", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"], extra: ["920"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const xyz = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "920");
    const materials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "100" || card.code === "300"));
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(xyz).toBeTruthy();
    expect(materials).toHaveLength(2);
    expect(triggerSource).toBeTruthy();
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);
    registerEffect(session, {
      id: "xyz-special-trigger",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "specialSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.log(`Xyz special summoned ${ctx.eventCard?.name}`);
      },
    });

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "xyzSummon" && candidate.uid === xyz!.uid);
    expect(action).toBeTruthy();
    const summonResult = applyResponse(session, action!);

    expect(summonResult.ok).toBe(true);
    expect(summonResult.state.cards.filter((card) => action && action.type === "xyzSummon" && action.materialUids.includes(card.uid) && card.location === "graveyard")).toHaveLength(0);
    expect(summonResult.state.pendingTriggers).toHaveLength(1);
    expect(summonResult.state.pendingTriggers[0]).toMatchObject({ eventName: "specialSummoned", eventCardUid: xyz!.uid });
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.effectId === "xyz-special-trigger");
    expect(trigger).toBeTruthy();
    const result = applyResponse(session, trigger!);

    expect(result.ok).toBe(true);
    expect(result.state.log.some((entry) => entry.detail === "Xyz special summoned Xyz Test Monster")).toBe(true);
  });

  it("xyz summons generic monsters with two matching-level materials", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["310", "330"], extra: ["980"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const xyz = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "980");
    const materials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "310" || card.code === "330"));
    expect(xyz).toBeTruthy();
    expect(materials).toHaveLength(2);
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "xyzSummon" && candidate.uid === xyz!.uid);
    expect(action).toBeTruthy();
    expect(action?.type).toBe("xyzSummon");
    if (!action || action.type !== "xyzSummon") throw new Error("Expected Xyz summon action");
    const result = applyResponse(session, action);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === xyz!.uid)?.location).toBe("monsterZone");
    expect(result.state.cards.find((card) => card.uid === xyz!.uid)?.overlayCount).toBe(2);
    expect(action.materialUids.every((materialUid) => result.state.cards.find((card) => card.uid === materialUid)?.location === "overlay")).toBe(true);
  });

  it("detaches Xyz overlay materials to the graveyard", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["310", "330"], extra: ["980"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const xyz = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "980");
    const materials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "310" || card.code === "330"));
    expect(xyz).toBeTruthy();
    expect(materials).toHaveLength(2);
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);
    xyzSummonDuelCard(session.state, 0, xyz!.uid, materials.map((card) => card.uid));
    const firstOverlayUid = session.state.cards.find((card) => card.uid === xyz!.uid)?.overlayUids[0];
    const firstOverlayCode = session.state.cards.find((card) => card.uid === firstOverlayUid)?.code;

    const detached = detachDuelOverlayMaterials(session.state, xyz!.uid, 1, 0);
    expect(detached.map((card) => card.code)).toEqual([firstOverlayCode]);
    expect(session.state.cards.find((card) => card.uid === xyz!.uid)?.overlayUids).toHaveLength(1);
    expect(session.state.cards.find((card) => card.uid === detached[0]!.uid)?.location).toBe("graveyard");
    expect(() => detachDuelOverlayMaterials(session.state, xyz!.uid, 2, 0)).toThrow("does not have enough overlay materials");
  });

  it("rejects generic xyz materials with mismatched levels", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["310", "320"], extra: ["980"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const xyz = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "980");
    const materials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "310" || card.code === "320"));
    expect(xyz).toBeTruthy();
    expect(materials).toHaveLength(2);
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);

    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "xyzSummon" && candidate.uid === xyz!.uid)).toBe(false);
    expect(() => xyzSummonDuelCard(session.state, 0, xyz!.uid, materials.map((card) => card.uid))).toThrow("Xyz materials are not legal");
  });

  it("rejects generic xyz summons without exactly two materials", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["310", "330", "310"], extra: ["980"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const xyz = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "980");
    const materials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "310" || card.code === "330"));
    expect(xyz).toBeTruthy();
    expect(materials).toHaveLength(3);
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "xyzSummon" && candidate.uid === xyz!.uid);
    expect(action).toBeTruthy();
    expect(action).toMatchObject({ type: "xyzSummon", materialUids: [materials[0]!.uid, materials[1]!.uid] });
    expect(() => xyzSummonDuelCard(session.state, 0, xyz!.uid, materials.map((card) => card.uid))).toThrow("Xyz materials are not legal");
  });

  it("does not expose xyz summon actions without field materials or with no monster zone space", () => {
    const handOnly = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(handOnly, {
      0: { main: ["100", "300"], extra: ["920"] },
      1: { main: ["400", "400"] },
    });
    startDuel(handOnly);
    expect(getDuelLegalActions(handOnly, 0).some((candidate) => candidate.type === "xyzSummon")).toBe(false);

    const missing = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(missing, {
      0: { main: ["100"], extra: ["920"] },
      1: { main: ["400"] },
    });
    startDuel(missing);
    const material = queryPublicState(missing).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(material).toBeTruthy();
    moveDuelCard(missing.state, material!.uid, "monsterZone", 0);
    expect(getDuelLegalActions(missing, 0).some((candidate) => candidate.type === "xyzSummon")).toBe(false);

    const full = createDuel({ seed: 1, startingHandSize: 7, cardReader: createCardReader(cards) });
    loadDecks(full, {
      0: { main: ["100", "300", "500", "500", "500", "500", "500"], extra: ["920"] },
      1: { main: ["400", "400", "400", "400", "400", "400", "400"] },
    });
    startDuel(full);
    const allMonsters = queryPublicState(full).cards.filter((card) => card.controller === 0 && card.location === "hand" && card.kind === "monster");
    expect(allMonsters).toHaveLength(7);
    for (const monster of allMonsters.slice(0, 5)) moveDuelCard(full.state, monster.uid, "monsterZone", 0);
    expect(getDuelLegalActions(full, 0).some((candidate) => candidate.type === "xyzSummon")).toBe(false);

    const xyz = queryPublicState(full).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "920");
    const materials = queryPublicState(full).cards.filter((card) => card.controller === 0 && card.location === "monsterZone" && (card.code === "100" || card.code === "300"));
    expect(xyz).toBeTruthy();
    expect(materials).toHaveLength(2);
    expect(() => xyzSummonDuelCard(full.state, 0, xyz!.uid, materials.map((card) => card.uid))).toThrow("monsterZone is full");
  });

  it("link summons from the extra deck using field materials", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["930"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const link = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "930");
    const materials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "100" || card.code === "300"));
    expect(link).toBeTruthy();
    expect(materials).toHaveLength(2);
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "linkSummon" && candidate.uid === link!.uid);
    expect(action).toBeTruthy();
    expect(action?.type).toBe("linkSummon");
    if (!action || action.type !== "linkSummon") throw new Error("Expected Link summon action");
    const result = applyResponse(session, action);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === link!.uid)?.location).toBe("monsterZone");
    expect(result.state.cards.find((card) => card.uid === link!.uid)?.position).toBe("faceUpAttack");
    expect(action.materialUids.every((uid) => result.state.cards.find((card) => card.uid === uid)?.location === "graveyard")).toBe(true);
    expect(result.state.log.some((entry) => entry.action === "linkSummon" && entry.card === "Link Test Monster")).toBe(true);
  });

  it("link summons emit special summon triggers", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"], extra: ["930"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const link = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "930");
    const materials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "100" || card.code === "300"));
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(link).toBeTruthy();
    expect(materials).toHaveLength(2);
    expect(triggerSource).toBeTruthy();
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);
    registerEffect(session, {
      id: "link-special-trigger",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "specialSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.log(`Link special summoned ${ctx.eventCard?.name}`);
      },
    });

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "linkSummon" && candidate.uid === link!.uid);
    expect(action).toBeTruthy();
    const summonResult = applyResponse(session, action!);

    expect(summonResult.ok).toBe(true);
    expect(summonResult.state.pendingTriggers).toHaveLength(1);
    expect(summonResult.state.pendingTriggers[0]).toMatchObject({ eventName: "specialSummoned", eventCardUid: link!.uid });
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.effectId === "link-special-trigger");
    expect(trigger).toBeTruthy();
    const result = applyResponse(session, trigger!);

    expect(result.ok).toBe(true);
    expect(result.state.log.some((entry) => entry.detail === "Link special summoned Link Test Monster")).toBe(true);
  });

  it("link summons generic links by material rating", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["950"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const link = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "950");
    const materials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "100" || card.code === "300"));
    expect(link).toBeTruthy();
    expect(materials).toHaveLength(2);
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "linkSummon" && candidate.uid === link!.uid);
    expect(action).toBeTruthy();
    if (!action || action.type !== "linkSummon") throw new Error("Expected Link summon action");
    expect(action.materialUids).toHaveLength(2);
    const result = applyResponse(session, action);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === link!.uid)?.location).toBe("monsterZone");
    expect(action.materialUids.every((uid) => result.state.cards.find((card) => card.uid === uid)?.location === "graveyard")).toBe(true);
  });

  it("lets a link material contribute its link rating", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"], extra: ["950", "960"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const link2 = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "950");
    const link3 = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "960");
    const firstMaterials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "100" || card.code === "300"));
    expect(link2).toBeTruthy();
    expect(link3).toBeTruthy();
    for (const material of firstMaterials) moveDuelCard(session.state, material.uid, "monsterZone", 0);

    const link2Action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "linkSummon" && candidate.uid === link2!.uid);
    expect(link2Action).toBeTruthy();
    expect(applyResponse(session, link2Action!).ok).toBe(true);

    const third = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(third).toBeTruthy();
    moveDuelCard(session.state, third!.uid, "monsterZone", 0);

    const link3Action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "linkSummon" && candidate.uid === link3!.uid);
    expect(link3Action).toBeTruthy();
    if (!link3Action || link3Action.type !== "linkSummon") throw new Error("Expected Link-3 summon action");
    expect(link3Action.materialUids).toEqual(expect.arrayContaining([link2!.uid, third!.uid]));
    const result = applyResponse(session, link3Action);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === link3!.uid)?.location).toBe("monsterZone");
    expect(result.state.cards.find((card) => card.uid === link2!.uid)?.location).toBe("graveyard");
  });

  it("rejects link summons with invalid material rating totals", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["960"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const link = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "960");
    const materials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "100" || card.code === "300"));
    expect(link).toBeTruthy();
    expect(materials).toHaveLength(2);
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);

    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "linkSummon" && candidate.uid === link!.uid)).toBe(false);
    expect(() => linkSummonDuelCard(session.state, 0, link!.uid, materials.map((material) => material.uid))).toThrow("Link materials are not legal");
  });

  it("does not expose link summon actions without field materials or with no monster zone space", () => {
    const handOnly = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(handOnly, {
      0: { main: ["100", "300"], extra: ["930"] },
      1: { main: ["400", "400"] },
    });
    startDuel(handOnly);
    expect(getDuelLegalActions(handOnly, 0).some((candidate) => candidate.type === "linkSummon")).toBe(false);

    const missing = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(missing, {
      0: { main: ["100"], extra: ["930"] },
      1: { main: ["400"] },
    });
    startDuel(missing);
    const material = queryPublicState(missing).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(material).toBeTruthy();
    moveDuelCard(missing.state, material!.uid, "monsterZone", 0);
    expect(getDuelLegalActions(missing, 0).some((candidate) => candidate.type === "linkSummon")).toBe(false);

    const full = createDuel({ seed: 1, startingHandSize: 7, cardReader: createCardReader(cards) });
    loadDecks(full, {
      0: { main: ["100", "300", "500", "500", "500", "500", "500"], extra: ["930"] },
      1: { main: ["400", "400", "400", "400", "400", "400", "400"] },
    });
    startDuel(full);
    const allMonsters = queryPublicState(full).cards.filter((card) => card.controller === 0 && card.location === "hand" && card.kind === "monster");
    expect(allMonsters).toHaveLength(7);
    for (const monster of allMonsters.slice(0, 5)) moveDuelCard(full.state, monster.uid, "monsterZone", 0);
    expect(getDuelLegalActions(full, 0).some((candidate) => candidate.type === "linkSummon")).toBe(false);

    const link = queryPublicState(full).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "930");
    const materials = queryPublicState(full).cards.filter((card) => card.controller === 0 && card.location === "monsterZone" && (card.code === "100" || card.code === "300"));
    expect(link).toBeTruthy();
    expect(materials).toHaveLength(2);
    expect(() => linkSummonDuelCard(full.state, 0, link!.uid, materials.map((card) => card.uid))).toThrow("monsterZone is full");
  });

  it("ritual summons from the hand using hand materials", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["940", "100", "300"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const ritual = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "940");
    expect(ritual).toBeTruthy();
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "ritualSummon" && candidate.uid === ritual!.uid);
    expect(action).toBeTruthy();
    expect(action?.type).toBe("ritualSummon");
    if (!action || action.type !== "ritualSummon") throw new Error("Expected ritual summon action");
    const result = applyResponse(session, action);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === ritual!.uid)?.location).toBe("monsterZone");
    expect(result.state.cards.find((card) => card.uid === ritual!.uid)?.position).toBe("faceUpAttack");
    expect(action.materialUids.every((uid) => result.state.cards.find((card) => card.uid === uid)?.location === "graveyard")).toBe(true);
    expect(result.state.log.some((entry) => entry.action === "ritualSummon" && entry.card === "Ritual Test Monster")).toBe(true);
  });

  it("ritual summons using mixed hand and field materials and emits special summon triggers", () => {
    const session = createDuel({ seed: 1, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["940", "100", "300", "500"] },
      1: { main: ["400", "400", "400", "400"] },
    });
    startDuel(session);

    const ritual = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "940");
    const fieldMaterial = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(ritual).toBeTruthy();
    expect(fieldMaterial).toBeTruthy();
    expect(triggerSource).toBeTruthy();
    moveDuelCard(session.state, fieldMaterial!.uid, "monsterZone", 0);
    registerEffect(session, {
      id: "ritual-special-trigger",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "specialSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.log(`Ritual special summoned ${ctx.eventCard?.name}`);
      },
    });

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "ritualSummon" && candidate.uid === ritual!.uid);
    expect(action).toBeTruthy();
    const summonResult = applyResponse(session, action!);

    expect(summonResult.ok).toBe(true);
    expect(summonResult.state.cards.find((card) => card.uid === fieldMaterial!.uid)?.location).toBe("graveyard");
    expect(summonResult.state.pendingTriggers).toHaveLength(1);
    expect(summonResult.state.pendingTriggers[0]).toMatchObject({ eventName: "specialSummoned", eventCardUid: ritual!.uid });
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.effectId === "ritual-special-trigger");
    expect(trigger).toBeTruthy();
    const result = applyResponse(session, trigger!);

    expect(result.ok).toBe(true);
    expect(result.state.log.some((entry) => entry.detail === "Ritual special summoned Ritual Test Monster")).toBe(true);
  });

  it("does not expose ritual summon actions without materials or with no monster zone space", () => {
    const missing = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(missing, {
      0: { main: ["940", "100"] },
      1: { main: ["400", "400"] },
    });
    startDuel(missing);
    expect(getDuelLegalActions(missing, 0).some((candidate) => candidate.type === "ritualSummon")).toBe(false);

    const duplicate = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(duplicate, {
      0: { main: ["940", "100", "300"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(duplicate);
    const duplicateRitual = queryPublicState(duplicate).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "940");
    const duplicateMaterial = queryPublicState(duplicate).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(duplicateRitual).toBeTruthy();
    expect(duplicateMaterial).toBeTruthy();
    expect(() => ritualSummonDuelCard(duplicate.state, 0, duplicateRitual!.uid, [duplicateMaterial!.uid, duplicateMaterial!.uid])).toThrow("ritual materials must be unique");

    const full = createDuel({ seed: 1, startingHandSize: 8, cardReader: createCardReader(cards) });
    loadDecks(full, {
      0: { main: ["940", "100", "300", "500", "500", "500", "500", "500"] },
      1: { main: ["400", "400", "400", "400", "400", "400", "400", "400"] },
    });
    startDuel(full);
    const blockers = queryPublicState(full).cards.filter((card) => card.controller === 0 && card.location === "hand" && card.kind === "monster" && card.code === "500");
    expect(blockers).toHaveLength(5);
    for (const blocker of blockers) moveDuelCard(full.state, blocker.uid, "monsterZone", 0);
    expect(getDuelLegalActions(full, 0).some((candidate) => candidate.type === "ritualSummon")).toBe(false);

    const ritual = queryPublicState(full).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "940");
    const materials = queryPublicState(full).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "100" || card.code === "300"));
    expect(ritual).toBeTruthy();
    expect(materials).toHaveLength(2);
    expect(() => ritualSummonDuelCard(full.state, 0, ritual!.uid, materials.map((card) => card.uid))).toThrow("monsterZone is full");
  });

  it("collects trigger effects after a card is sent to the graveyard", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const sent = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(source).toBeTruthy();
    expect(sent).toBeTruthy();
    expect(triggerSource).toBeTruthy();

    registerEffect(session, {
      id: "send-card",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation(ctx) {
        sendDuelCardToGraveyard(ctx.duel, sent!.uid, ctx.player);
      },
    });
    registerEffect(session, {
      id: "on-sent",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "sentToGraveyard",
      range: ["hand"],
      operation(ctx) {
        ctx.log(`Saw ${ctx.eventCard?.name ?? "missing card"} sent`);
      },
    });

    const activation = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "send-card");
    expect(activation).toBeTruthy();
    const activationResult = applyResponse(session, activation!);

    expect(activationResult.ok).toBe(true);
    expect(activationResult.state.cards.find((card) => card.uid === sent!.uid)?.location).toBe("graveyard");
    expect(activationResult.state.pendingTriggers).toHaveLength(1);
    expect(activationResult.state.pendingTriggers[0]).toMatchObject({ eventName: "sentToGraveyard", eventCardUid: sent!.uid });
    const trigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === "on-sent");
    expect(trigger).toBeTruthy();
    const triggerResult = applyResponse(session, trigger!);

    expect(triggerResult.ok).toBe(true);
    expect(triggerResult.state.log.some((entry) => entry.detail.includes("Second Monster sent"))).toBe(true);
  });

  it("moves cards through destroy and banish primitives", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const destroyed = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const banished = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(destroyed).toBeTruthy();
    expect(banished).toBeTruthy();

    destroyDuelCard(session.state, destroyed!.uid, 0);
    banishDuelCard(session.state, banished!.uid, 0);
    const state = queryPublicState(session);

    expect(state.cards.find((card) => card.uid === destroyed!.uid)?.location).toBe("graveyard");
    expect(state.cards.find((card) => card.uid === banished!.uid)?.location).toBe("banished");
    expect(state.log.some((entry) => entry.action === "destroy" && entry.card === "Normal Test Monster")).toBe(true);
    expect(state.log.some((entry) => entry.action === "banish" && entry.card === "Second Monster")).toBe(true);
    expect(canMoveDuelCardToLocation(session.state, destroyed!.uid, "graveyard")).toBe(false);
    expect(canMoveDuelCardToLocation(session.state, banished!.uid, "banished")).toBe(false);
    expect(() => sendDuelCardToGraveyard(session.state, destroyed!.uid, 0)).toThrow("cannot move to graveyard");
    expect(() => banishDuelCard(session.state, banished!.uid, 0)).toThrow("cannot move to banished");
  });

  it("applies destroy replacement effects before moving the destroyed card", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const threatened = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const replacement = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(threatened).toBeTruthy();
    expect(replacement).toBeTruthy();
    expect(source).toBeTruthy();

    registerEffect(session, {
      id: "destroy-replace",
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      code: 50,
      property: 0x800,
      targetRange: [1, 0],
      range: ["hand"],
      target(ctx) {
        ctx.setTargets([replacement!.uid]);
        return true;
      },
      operation(ctx) {
        const [selected] = ctx.getTargets();
        if (selected) sendDuelCardToGraveyard(ctx.duel, selected.uid, ctx.player);
      },
    });

    destroyDuelCard(session.state, threatened!.uid, 0);
    const state = queryPublicState(session);

    expect(state.cards.find((card) => card.uid === threatened!.uid)?.location).toBe("hand");
    expect(state.cards.find((card) => card.uid === replacement!.uid)?.location).toBe("graveyard");
    expect(state.log.some((entry) => entry.action === "destroyReplace" && entry.card === "Normal Test Monster")).toBe(true);
  });

  it("applies release replacement effects before moving the released card", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const threatened = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const replacement = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(threatened).toBeTruthy();
    expect(replacement).toBeTruthy();
    expect(source).toBeTruthy();

    registerEffect(session, {
      id: "release-replace",
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      code: 51,
      property: 0x800,
      targetRange: [1, 0],
      range: ["hand"],
      target(ctx) {
        ctx.setTargets([replacement!.uid]);
        return true;
      },
      operation(ctx) {
        const [selected] = ctx.getTargets();
        if (selected) sendDuelCardToGraveyard(ctx.duel, selected.uid, ctx.player, duelReason.release | duelReason.replace);
      },
    });

    sendDuelCardToGraveyard(session.state, threatened!.uid, 0, duelReason.release | duelReason.cost);
    const state = queryPublicState(session);

    expect(state.cards.find((card) => card.uid === threatened!.uid)?.location).toBe("hand");
    expect(state.cards.find((card) => card.uid === replacement!.uid)?.location).toBe("graveyard");
    expect(state.log.some((entry) => entry.action === "releaseReplace" && entry.card === "Normal Test Monster")).toBe(true);
  });

  it("applies send replacement effects before sending a card to the graveyard", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const threatened = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const replacement = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(threatened).toBeTruthy();
    expect(replacement).toBeTruthy();
    expect(source).toBeTruthy();

    registerEffect(session, {
      id: "send-replace",
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      code: 52,
      property: 0x800,
      targetRange: [1, 0],
      range: ["hand"],
      target(ctx) {
        ctx.setTargets([replacement!.uid]);
        return true;
      },
      operation(ctx) {
        const [selected] = ctx.getTargets();
        if (selected) sendDuelCardToGraveyard(ctx.duel, selected.uid, ctx.player, duelReason.effect | duelReason.replace);
      },
    });

    sendDuelCardToGraveyard(session.state, threatened!.uid, 0, duelReason.effect);
    const state = queryPublicState(session);

    expect(state.cards.find((card) => card.uid === threatened!.uid)?.location).toBe("hand");
    expect(state.cards.find((card) => card.uid === replacement!.uid)?.location).toBe("graveyard");
    expect(state.log.some((entry) => entry.action === "sendReplace" && entry.card === "Normal Test Monster")).toBe(true);
  });

  it("prevents moves with continuous cannot-move effects", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const graveBlocked = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const banishBlocked = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(graveBlocked).toBeTruthy();
    expect(banishBlocked).toBeTruthy();
    expect(source).toBeTruthy();

    registerEffect(session, {
      id: "cannot-grave",
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      code: 68,
      property: 0x800,
      targetRange: [1, 0],
      range: ["hand"],
      operation() {},
    });
    registerEffect(session, {
      id: "cannot-banish",
      sourceUid: banishBlocked!.uid,
      controller: 0,
      event: "continuous",
      code: 67,
      range: ["hand"],
      operation() {},
    });

    expect(canMoveDuelCardToLocation(session.state, graveBlocked!.uid, "graveyard")).toBe(false);
    expect(canMoveDuelCardToLocation(session.state, banishBlocked!.uid, "banished")).toBe(false);
    expect(() => sendDuelCardToGraveyard(session.state, graveBlocked!.uid, 0)).toThrow("cannot move to graveyard");
    expect(() => banishDuelCard(session.state, banishBlocked!.uid, 0)).toThrow("cannot move to banished");
  });

  it("prevents effect destruction with indestructible effects", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "500"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const protectedCard = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(protectedCard).toBeTruthy();
    expect(source).toBeTruthy();

    registerEffect(session, {
      id: "effect-indestructible",
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      code: 41,
      property: 0x800,
      targetRange: [1, 0],
      range: ["hand"],
      operation() {},
    });

    destroyDuelCard(session.state, protectedCard!.uid, 0);

    expect(queryPublicState(session).cards.find((card) => card.uid === protectedCard!.uid)?.location).toBe("hand");
    expect(queryPublicState(session).log.some((entry) => entry.action === "destroyPrevented" && entry.card === "Normal Test Monster")).toBe(true);
  });

  it("consumes counted indestructible effects", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "500"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const protectedCard = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(protectedCard).toBeTruthy();
    expect(source).toBeTruthy();

    registerEffect(session, {
      id: "counted-indestructible",
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      code: 47,
      value: 1,
      property: 0x800,
      targetRange: [1, 0],
      range: ["hand"],
      operation() {},
    });

    destroyDuelCard(session.state, protectedCard!.uid, 0);
    expect(queryPublicState(session).cards.find((card) => card.uid === protectedCard!.uid)?.location).toBe("hand");

    destroyDuelCard(session.state, protectedCard!.uid, 0);
    expect(queryPublicState(session).cards.find((card) => card.uid === protectedCard!.uid)?.location).toBe("graveyard");
  });

  it("moves pendulum monsters to the extra deck face-up", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["350", "100"], extra: ["980"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const pendulum = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "350");
    const normal = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const extra = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "980");
    expect(pendulum).toBeTruthy();
    expect(normal).toBeTruthy();
    expect(extra).toBeTruthy();

    moveDuelCard(session.state, pendulum!.uid, "monsterZone", 0);
    moveDuelCard(session.state, pendulum!.uid, "extraDeck", 0);
    moveDuelCard(session.state, extra!.uid, "graveyard", 0);
    moveDuelCard(session.state, extra!.uid, "extraDeck", 0);

    const state = queryPublicState(session);
    expect(canMoveDuelCardToLocation(session.state, normal!.uid, "extraDeck")).toBe(false);
    expect(state.cards.find((card) => card.uid === pendulum!.uid)).toMatchObject({ location: "extraDeck", faceUp: true, position: "faceDown" });
    expect(state.cards.find((card) => card.uid === extra!.uid)).toMatchObject({ location: "extraDeck", faceUp: false, position: "faceDown" });
  });

  it("special summons face-up pendulum monsters from the extra deck", () => {
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["350"], extra: ["980"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const pendulum = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "350");
    const extra = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "980");
    expect(pendulum).toBeTruthy();
    expect(extra).toBeTruthy();
    moveDuelCard(session.state, pendulum!.uid, "extraDeck", 0);

    expect(canSpecialSummonDuelCard(session.state, pendulum!.uid, 0)).toBe(true);
    expect(canSpecialSummonDuelCard(session.state, extra!.uid, 0)).toBe(false);
    expect(() => specialSummonDuelCard(session.state, extra!.uid, 0)).toThrow("cannot be Special Summoned");
    const summoned = specialSummonDuelCard(session.state, pendulum!.uid, 0);

    expect(summoned).toMatchObject({ location: "monsterZone", faceUp: true, position: "faceUpAttack", summonType: "special" });
    expect(session.state.log.some((entry) => entry.action === "specialSummon" && entry.card === "Pendulum Test Monster")).toBe(true);
  });

  it("hides normal summon actions when the monster zone is full", () => {
    const session = createDuel({ seed: 1, startingHandSize: 6, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "300", "300", "300", "500"] },
      1: { main: ["400", "400", "400", "400", "400", "400"] },
    });
    startDuel(session);

    const handMonsters = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && card.kind === "monster");
    for (const card of handMonsters.slice(0, 5)) moveDuelCard(session.state, card.uid, "monsterZone", 0);

    const legal = getDuelLegalActions(session, 0);
    expect(legal.some((action) => action.type === "normalSummon")).toBe(false);
    expect(() => specialSummonDuelCard(session.state, handMonsters[5]!.uid, 0)).toThrow("monsterZone is full");
  });

  it("tribute summons a level 5 or 6 monster with one tribute", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["600", "100", "300"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const tributeMonster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "600");
    const tribute = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(tributeMonster).toBeTruthy();
    expect(tribute).toBeTruthy();
    moveDuelCard(session.state, tribute!.uid, "monsterZone", 0);

    expect(getDuelLegalActions(session, 0).some((action) => action.type === "normalSummon" && action.uid === tributeMonster!.uid)).toBe(false);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "tributeSummon" && candidate.uid === tributeMonster!.uid && candidate.tributeUids.includes(tribute!.uid));
    expect(action).toBeTruthy();
    const result = applyResponse(session, action!);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === tribute!.uid)?.location).toBe("graveyard");
    expect(result.state.cards.find((card) => card.uid === tributeMonster!.uid)?.location).toBe("monsterZone");
    expect(result.state.players[0].normalSummonAvailable).toBe(false);
    expect(result.state.log.some((entry) => entry.action === "release" && entry.card === "Normal Test Monster")).toBe(true);
    expect(result.state.log.some((entry) => entry.action === "tributeSummon" && entry.card === "One Tribute Monster")).toBe(true);
  });

  it("tribute summons a level 7 or higher monster with two tributes even from a full monster zone", () => {
    const session = createDuel({ seed: 1, startingHandSize: 6, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["700", "100", "300", "300", "300", "500"] },
      1: { main: ["400", "400", "400", "400", "400", "400"] },
    });
    startDuel(session);

    const tributeMonster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "700");
    const tributes = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && card.kind === "monster" && card.uid !== tributeMonster!.uid);
    expect(tributeMonster).toBeTruthy();
    expect(tributes).toHaveLength(5);
    for (const card of tributes) moveDuelCard(session.state, card.uid, "monsterZone", 0);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "tributeSummon" && candidate.uid === tributeMonster!.uid && candidate.tributeUids.length === 2);
    expect(action).toBeTruthy();
    expect(action?.type).toBe("tributeSummon");
    if (!action || action.type !== "tributeSummon") throw new Error("Expected tribute summon action");
    const result = applyResponse(session, action!);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === tributeMonster!.uid)?.location).toBe("monsterZone");
    expect(action.tributeUids.every((uid) => result.state.cards.find((card) => card.uid === uid)?.location === "graveyard")).toBe(true);
    expect(result.state.cards.filter((card) => card.controller === 0 && card.location === "monsterZone")).toHaveLength(4);
    expect(() => tributeSummonDuelCard(session.state, 0, tributeMonster!.uid, action.tributeUids)).toThrow("not in hand");
  });

  it("sets a monster face-down and flip summons it later", () => {
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const monster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(monster).toBeTruthy();
    const setAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "setMonster" && candidate.uid === monster!.uid);
    expect(setAction).toBeTruthy();
    const setResult = applyResponse(session, setAction!);

    expect(setResult.ok).toBe(true);
    expect(setResult.state.cards.find((card) => card.uid === monster!.uid)?.position).toBe("faceDownDefense");
    expect(setResult.state.cards.find((card) => card.uid === monster!.uid)?.faceUp).toBe(false);
    expect(setResult.state.players[0].normalSummonAvailable).toBe(false);

    const flipAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "flipSummon" && candidate.uid === monster!.uid);
    expect(flipAction).toBeTruthy();
    const flipResult = applyResponse(session, flipAction!);

    expect(flipResult.ok).toBe(true);
    expect(flipResult.state.cards.find((card) => card.uid === monster!.uid)?.position).toBe("faceUpAttack");
    expect(flipResult.state.cards.find((card) => card.uid === monster!.uid)?.faceUp).toBe(true);
    expect(flipResult.state.log.some((entry) => entry.action === "flipSummon" && entry.card === "Normal Test Monster")).toBe(true);
  });

  it("collects flip summon trigger effects", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const monster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(monster).toBeTruthy();
    expect(triggerSource).toBeTruthy();
    moveDuelCard(session.state, monster!.uid, "monsterZone", 0).position = "faceDownDefense";
    session.state.cards.find((card) => card.uid === monster!.uid)!.faceUp = false;
    registerEffect(session, {
      id: "flip-trigger",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "flipSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.log(`Flip summoned ${ctx.eventCard?.name}`);
      },
    });

    flipSummonDuelCard(session.state, 0, monster!.uid);

    const state = queryPublicState(session);
    expect(state.pendingTriggers).toHaveLength(1);
    expect(state.pendingTriggers[0]).toMatchObject({ eventName: "flipSummoned", eventCardUid: monster!.uid });
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.effectId === "flip-trigger");
    expect(trigger).toBeTruthy();
    const result = applyResponse(session, trigger!);

    expect(result.ok).toBe(true);
    expect(result.state.log.some((entry) => entry.detail === "Flip summoned Normal Test Monster")).toBe(true);
  });

  it("hides set actions when the spell/trap zone is full", () => {
    const session = createDuel({ seed: 1, startingHandSize: 6, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["200", "200", "200", "200", "200", "200"] },
      1: { main: ["400", "400", "400", "400", "400", "400"] },
    });
    startDuel(session);

    const spells = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && card.kind === "spell");
    for (const card of spells.slice(0, 5)) moveDuelCard(session.state, card.uid, "spellTrapZone", 0);

    expect(getDuelLegalActions(session, 0).some((action) => action.type === "setSpellTrap")).toBe(false);
  });

  it("changes monster battle position once per turn", () => {
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const monster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(monster).toBeTruthy();
    specialSummonDuelCard(session.state, monster!.uid, 0);
    expect(canChangeDuelCardPosition(session.state, monster!.uid, "faceUpDefense")).toBe(true);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePosition" && candidate.uid === monster!.uid && candidate.position === "faceUpDefense");
    expect(action).toBeTruthy();
    const result = applyResponse(session, action!);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === monster!.uid)?.position).toBe("faceUpDefense");
    expect(result.state.positionsChanged).toContain(monster!.uid);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "changePosition" && candidate.uid === monster!.uid)).toBe(false);
    expect(restoreDuel(serializeDuel(session), createCardReader(cards)).state.positionsChanged).toContain(monster!.uid);
  });

  it("collects position-change trigger effects", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const monster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(monster).toBeTruthy();
    expect(triggerSource).toBeTruthy();
    specialSummonDuelCard(session.state, monster!.uid, 0);
    registerEffect(session, {
      id: "position-trigger",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "positionChanged",
      range: ["hand"],
      operation(ctx) {
        ctx.log(`Position changed ${ctx.eventCard?.name}`);
      },
    });

    changeDuelCardPosition(session.state, 0, monster!.uid, "faceUpDefense");

    const state = queryPublicState(session);
    expect(state.pendingTriggers).toHaveLength(1);
    expect(state.pendingTriggers[0]).toMatchObject({ eventName: "positionChanged", eventCardUid: monster!.uid });

    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.effectId === "position-trigger");
    expect(trigger).toBeTruthy();
    const result = applyResponse(session, trigger!);

    expect(result.ok).toBe(true);
    expect(result.state.log.some((entry) => entry.detail === "Position changed Normal Test Monster")).toBe(true);
  });

  it("declares a direct attack and tracks attackers for the battle phase", () => {
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(attacker).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);

    const battle = getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battle).toBeTruthy();
    expect(applyResponse(session, battle!).ok).toBe(true);
    expect(canDuelCardAttack(session.state, attacker!.uid)).toBe(true);
    expect(getDuelAttackTargets(session.state, attacker!.uid)).toHaveLength(0);

    const attack = getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && !action.targetUid);
    expect(attack).toBeTruthy();
    const attackResult = applyResponse(session, attack!);

    expect(attackResult.ok).toBe(true);
    expect(attackResult.state.players[1].lifePoints).toBe(6200);
    expect(attackResult.state.attacksDeclared).toContain(attacker!.uid);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid)).toBe(false);
    expect(restoreDuel(serializeDuel(session), createCardReader(cards)).state.attacksDeclared).toContain(attacker!.uid);
  });

  it("tracks summon and attack activity counts through snapshots and turn reset", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const flip = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(attacker).toBeTruthy();
    expect(flip).toBeTruthy();
    expect(session.state.activityCounts[0]).toEqual({ summon: 0, normalSummon: 0, specialSummon: 0, flipSummon: 0, attack: 0 });

    specialSummonDuelCard(session.state, attacker!.uid, 0);
    moveDuelCard(session.state, flip!.uid, "monsterZone", 0).position = "faceDownDefense";
    session.state.cards.find((card) => card.uid === flip!.uid)!.faceUp = false;
    flipSummonDuelCard(session.state, 0, flip!.uid);

    const battle = getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battle).toBeTruthy();
    expect(applyResponse(session, battle!).ok).toBe(true);
    const attack = getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid);
    expect(attack).toBeTruthy();
    expect(applyResponse(session, attack!).ok).toBe(true);

    expect(session.state.activityCounts[0]).toEqual({ summon: 2, normalSummon: 0, specialSummon: 1, flipSummon: 1, attack: 1 });
    expect(queryPublicState(session).activityCounts[0]).toEqual(session.state.activityCounts[0]);
    expect(restoreDuel(serializeDuel(session), createCardReader(cards)).state.activityCounts[0]).toEqual(session.state.activityCounts[0]);

    const end = getDuelLegalActions(session, 0).find((action) => action.type === "endTurn");
    expect(end).toBeTruthy();
    expect(applyResponse(session, end!).ok).toBe(true);
    expect(session.state.activityCounts[0]).toEqual({ summon: 0, normalSummon: 0, specialSummon: 0, flipSummon: 0, attack: 0 });
  });

  it("resolves attack-position monster battles with destruction and battle damage", () => {
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["500"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    const target = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(attacker).toBeTruthy();
    expect(target).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    specialSummonDuelCard(session.state, target!.uid, 1);

    const battle = getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battle).toBeTruthy();
    expect(applyResponse(session, battle!).ok).toBe(true);
    expect(getDuelAttackTargets(session.state, attacker!.uid).map((card) => card.uid)).toEqual([target!.uid]);

    const attack = getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.targetUid === target!.uid);
    expect(attack).toBeTruthy();
    const result = applyResponse(session, attack!);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === attacker!.uid)?.location).toBe("monsterZone");
    expect(result.state.cards.find((card) => card.uid === target!.uid)?.location).toBe("graveyard");
    expect(result.state.players[1].lifePoints).toBe(7100);
    expect(result.state.log.some((entry) => entry.action === "destroy" && entry.card === "Opponent Monster")).toBe(true);
  });

  it("prevents battle destruction with indestructible effects", () => {
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["500"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    const target = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(attacker).toBeTruthy();
    expect(target).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    specialSummonDuelCard(session.state, target!.uid, 1);
    registerEffect(session, {
      id: "battle-indestructible",
      sourceUid: target!.uid,
      controller: 1,
      event: "continuous",
      code: 42,
      range: ["monsterZone"],
      operation() {},
    });

    const battle = getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battle).toBeTruthy();
    expect(applyResponse(session, battle!).ok).toBe(true);
    const attack = getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.targetUid === target!.uid);
    expect(attack).toBeTruthy();
    const result = applyResponse(session, attack!);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === target!.uid)?.location).toBe("monsterZone");
    expect(result.state.players[1].lifePoints).toBe(7100);
    expect(result.state.pendingTriggers).toHaveLength(0);
    expect(result.state.log.some((entry) => entry.action === "destroyPrevented" && entry.card === "Opponent Monster")).toBe(true);
  });

  it("collects battle destruction trigger effects", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["500", "200"] },
      1: { main: ["400", "200"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    const target = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "200");
    expect(attacker).toBeTruthy();
    expect(target).toBeTruthy();
    expect(triggerSource).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    specialSummonDuelCard(session.state, target!.uid, 1);
    registerEffect(session, {
      id: "battle-destroyed-trigger",
      sourceUid: triggerSource!.uid,
      controller: 1,
      event: "trigger",
      triggerEvent: "battleDestroyed",
      range: ["hand"],
      operation(ctx) {
        ctx.log(`Battle destroyed ${ctx.eventCard?.name}`);
      },
    });

    const battle = getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battle).toBeTruthy();
    expect(applyResponse(session, battle!).ok).toBe(true);
    const attack = getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.targetUid === target!.uid);
    expect(attack).toBeTruthy();
    const attackResult = applyResponse(session, attack!);

    expect(attackResult.ok).toBe(true);
    expect(attackResult.state.pendingTriggers).toHaveLength(1);
    expect(attackResult.state.pendingTriggers[0]).toMatchObject({ eventName: "battleDestroyed", eventCardUid: target!.uid });

    const trigger = getDuelLegalActions(session, 1).find((action) => action.type === "activateTrigger" && action.effectId === "battle-destroyed-trigger");
    expect(trigger).toBeTruthy();
    const result = applyResponse(session, trigger!);

    expect(result.ok).toBe(true);
    expect(result.state.log.some((entry) => entry.detail === "Battle destroyed Opponent Monster")).toBe(true);
  });

  it("resolves defense-position battles without destroying the attacker", () => {
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["300"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const target = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(attacker).toBeTruthy();
    expect(target).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    specialSummonDuelCard(session.state, target!.uid, 1);
    const targetState = session.state.cards.find((card) => card.uid === target!.uid);
    expect(targetState).toBeTruthy();
    targetState!.position = "faceUpDefense";

    const battle = getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battle).toBeTruthy();
    expect(applyResponse(session, battle!).ok).toBe(true);
    declareDuelAttack(session.state, 0, attacker!.uid, target!.uid);

    const state = queryPublicState(session);
    expect(state.cards.find((card) => card.uid === attacker!.uid)?.location).toBe("monsterZone");
    expect(state.cards.find((card) => card.uid === target!.uid)?.location).toBe("monsterZone");
    expect(state.players[0].lifePoints).toBe(7400);
    expect(state.log.some((entry) => entry.action === "damage" && entry.player === 0 && entry.detail === "600")).toBe(true);
  });

  it("modifies player life points and ends the duel at zero", () => {
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    expect(damageDuelPlayer(session.state, 1, 1500)).toBe(1500);
    expect(queryPublicState(session).players[1].lifePoints).toBe(6500);
    expect(recoverDuelPlayer(session.state, 1, 500)).toBe(500);
    expect(queryPublicState(session).players[1].lifePoints).toBe(7000);
    setDuelPlayerLifePoints(session.state, 1, 0);

    const state = queryPublicState(session);
    expect(state.players[1].lifePoints).toBe(0);
    expect(state.status).toBe("ended");
    expect(state.log.some((entry) => entry.action === "damage" && entry.detail === "1500")).toBe(true);
    expect(state.log.some((entry) => entry.action === "recover" && entry.detail === "500")).toBe(true);
    expect(state.log.some((entry) => entry.action === "setLifePoints" && entry.detail === "0")).toBe(true);
  });
});
