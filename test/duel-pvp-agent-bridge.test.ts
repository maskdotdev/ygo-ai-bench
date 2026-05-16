import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions, loadDecks, queryPublicState, registerEffect, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createDuelPvpAgent } from "#playtest/duel-pvp-agent-bridge.js";
import { starterYdk } from "../src/playtest-app/ui.js";
import { cards } from "./full-duel-engine-fixtures.js";

const rodOnlyYdk = `#created by test
#main
7084129
#extra
!side`;

describe("duel pvp agent bridge", () => {
  it("starts a two-player DuelSession and exposes visible battlefield actions", () => {
    const agent = createDuelPvpAgent();

    const started = agent.start({ player0Ydk: starterYdk, player1Ydk: starterYdk, seed: "pvp-agent", handSize: 2 });

    expect(started.ok).toBe(true);
    expect(agent.status()).toMatchObject({ sessions: 1, activeSessionId: started.sessionId });
    expect(started.state.status).toBe("awaiting");
    expect(started.legalActionGroups.flatMap((group) => group.actions)).toEqual(started.legalActions);
    expect(started.visibleBattlefield.actions).toHaveLength(4);
    expect(started.visibleBattlefield.prompt).toBeUndefined();
    expect(started.visibleBattlefield.groups.flatMap((group) => group.actions).every((action) => (
      started.visibleBattlefield.actions.some((visible) => JSON.stringify(visible) === JSON.stringify(action))
    ))).toBe(true);
  });

  it("copies visible battlefield payloads at the bridge boundary", () => {
    const agent = createDuelPvpAgent();
    const started = agent.start({ player0Ydk: starterYdk, player1Ydk: starterYdk, seed: "pvp-agent-copy", handSize: 2 });
    const visible = agent.visibleBattlefield(0, started.sessionId);
    const action = visible.actions[0];
    const groupedAction = visible.groups.flatMap((group) => group.actions)[0];
    expect(action).toBeDefined();
    expect(groupedAction).toBeDefined();

    action!.label = "Mutated visible action";
    groupedAction!.label = "Mutated visible grouped action";

    const fresh = agent.visibleBattlefield(0, started.sessionId);
    expect(fresh.actions[0]?.label).not.toBe("Mutated visible action");
    expect(fresh.groups.flatMap((group) => group.actions)[0]?.label).not.toBe("Mutated visible grouped action");
  });

  it("deep-copies visible battlefield selection arrays at the bridge boundary", () => {
    const session = createDuel({ seed: 481, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["900"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const first = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const second = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    specialSummonDuelCard(session.state, first!.uid, 0);
    specialSummonDuelCard(session.state, second!.uid, 0);
    const agent = createDuelPvpAgent();
    const restored = agent.restore(serializeDuel(session));
    const visible = agent.visibleBattlefield(0, restored.sessionId);
    const fusion = visible.actions.find((action) => action.type === "fusionSummon");
    expect(fusion?.type).toBe("fusionSummon");
    if (!fusion || fusion.type !== "fusionSummon") throw new Error("Expected visible Fusion action");

    fusion.materialUids.push("mutated-material");

    const fresh = agent.visibleBattlefield(0, restored.sessionId);
    const freshFusion = fresh.actions.find((action) => action.type === "fusionSummon");
    if (!freshFusion || freshFusion.type !== "fusionSummon") throw new Error("Expected fresh visible Fusion action");
    expect(freshFusion.materialUids).toHaveLength(2);
    expect(freshFusion.materialUids).toEqual(expect.arrayContaining([first!.uid, second!.uid]));
  });

  it("deep-copies action result selection arrays at the bridge boundary", () => {
    const session = createDuel({ seed: 482, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["900"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const first = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const second = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    specialSummonDuelCard(session.state, first!.uid, 0);
    specialSummonDuelCard(session.state, second!.uid, 0);
    const agent = createDuelPvpAgent();
    const restored = agent.restore(serializeDuel(session));
    const visible = agent.visibleBattlefield(0, restored.sessionId);
    const fusion = visible.actions.find((action) => action.type === "fusionSummon");
    expect(fusion?.type).toBe("fusionSummon");
    if (!fusion || fusion.type !== "fusionSummon") throw new Error("Expected visible Fusion action");

    const result = agent.action({ ...fusion, materialUids: [first!.uid] }, restored.sessionId);
    expect(result.ok).toBe(false);
    const returnedFusion = result.legalActions.find((action) => action.type === "fusionSummon");
    const returnedGroupedFusion = result.legalActionGroups.flatMap((group) => group.actions).find((action) => action.type === "fusionSummon");
    if (!returnedFusion || returnedFusion.type !== "fusionSummon") throw new Error("Expected returned Fusion action");
    if (!returnedGroupedFusion || returnedGroupedFusion.type !== "fusionSummon") throw new Error("Expected returned grouped Fusion action");

    returnedFusion.materialUids.push("mutated-action-material");
    returnedGroupedFusion.materialUids.push("mutated-group-material");

    const fresh = agent.action({ ...fusion, materialUids: [first!.uid] }, restored.sessionId);
    expect(fresh.ok).toBe(false);
    const freshFusion = fresh.legalActions.find((action) => action.type === "fusionSummon");
    const freshGroupedFusion = fresh.legalActionGroups.flatMap((group) => group.actions).find((action) => action.type === "fusionSummon");
    if (!freshFusion || freshFusion.type !== "fusionSummon") throw new Error("Expected fresh Fusion action");
    if (!freshGroupedFusion || freshGroupedFusion.type !== "fusionSummon") throw new Error("Expected fresh grouped Fusion action");
    expect(freshFusion.materialUids).toHaveLength(2);
    expect(freshFusion.materialUids).toEqual(expect.arrayContaining([first!.uid, second!.uid]));
    expect(freshGroupedFusion.materialUids).toHaveLength(2);
    expect(freshGroupedFusion.materialUids).toEqual(expect.arrayContaining([first!.uid, second!.uid]));
  });

  it("exposes trigger-order prompts through visible bridge payloads", () => {
    const session = createDuel({ seed: 483, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "400"] },
      1: { main: ["100"] },
    });
    startDuel(session);
    const summoned = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const first = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const second = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "400");
    expect(summoned).toBeDefined();
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    registerEffect(session, {
      id: "agent-first-mandatory",
      sourceUid: first!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      optional: false,
      range: ["hand"],
      operation() {},
    });
    registerEffect(session, {
      id: "agent-second-mandatory",
      sourceUid: second!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      optional: false,
      range: ["hand"],
      operation() {},
    });
    const normalSummon = getLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(normalSummon).toBeDefined();
    expect(applyResponse(session, normalSummon).ok).toBe(true);
    expect(queryPublicState(session).triggerOrderPrompt).toMatchObject({ player: 0, triggerBucket: "turnMandatory" });

    const snapshot = serializeDuel(session);
    // The bridge has no fixture effect registry, so use static restored metadata to keep pending triggers visible.
    snapshot.state.effects = [
      { id: "agent-first-mandatory", sourceUid: first!.uid, controller: 0, event: "continuous", optional: false, range: ["hand"] },
      { id: "agent-second-mandatory", sourceUid: second!.uid, controller: 0, event: "continuous", optional: false, range: ["hand"] },
    ];
    const agent = createDuelPvpAgent();
    const restored = agent.restore(snapshot);
    const visible = agent.visibleBattlefield(0, restored.sessionId);

    expect(visible.triggerOrder).toMatchObject({
      label: "Trigger Order",
      detail: "P1 · turnMandatory · 2 triggers",
    });
    expect(visible.triggerOrder?.groups.flatMap((group) => group.actions).map((action) => (
      action.type === "activateTrigger" ? action.effectId : action.type
    ))).toEqual(["agent-first-mandatory", "agent-second-mandatory"]);
  });

  it("restores serialized sessions with the same visible action surface", () => {
    const agent = createDuelPvpAgent();
    const started = agent.start({ player0Ydk: starterYdk, player1Ydk: starterYdk, seed: "pvp-agent-restore", handSize: 2 });
    const before = agent.visibleBattlefield(0, started.sessionId);

    const snapshot = agent.serialize(started.sessionId);
    const restored = agent.restore(snapshot);

    expect(restored.sessionId).toBe(started.sessionId);
    expect(agent.status()).toMatchObject({ sessions: 1, activeSessionId: started.sessionId });
    expect(restored.state).toEqual(started.state);
    expect(restored.visibleBattlefield).toEqual(before);
    expect(agent.visibleBattlefield(0, restored.sessionId)).toEqual(before);
  });

  it("defaults visible battlefield reads to the waiting player", () => {
    const agent = createDuelPvpAgent();
    const started = agent.start({ player0Ydk: starterYdk, player1Ydk: starterYdk, seed: "pvp-agent-waiting-player", handSize: 2 });
    const snapshot = agent.serialize(started.sessionId);
    snapshot.state.prompt = { id: "agent-waiting-prompt", type: "selectOption", player: 1, options: [3, 5], returnTo: 0 };
    snapshot.state.waitingFor = 1;
    agent.restore(snapshot);

    const visible = agent.visibleBattlefield(undefined, started.sessionId);

    expect(visible.player).toBe(1);
    expect(visible.prompt).toMatchObject({ label: "Option Prompt", detail: "P2 · Prompt agent-waiting-prompt · returns P1 · options 3, 5" });
    expect(visible.actions).toContainEqual(expect.objectContaining({ type: "selectOption", player: 1, promptId: "agent-waiting-prompt", option: 5 }));
  });

  it("runs visible battlefield scripts and reports divergence through visible actions", () => {
    const agent = createDuelPvpAgent();
    const started = agent.start({ player0Ydk: starterYdk, player1Ydk: starterYdk, seed: "pvp-agent-script", handSize: 2 });

    const result = agent.runVisibleScript([{ player: 0, type: "passDamage", groupLabel: "Damage Step Response" }], started.sessionId);

    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe(0);
    expect(result.failure).toBe("No visible battlefield action matched player=0 type=passDamage groupLabel=Damage Step Response");
    expect(result.visibleActions).toHaveLength(3);
    expect(result.visibleGroups.flatMap((group) => group.actions).every((action) => (
      result.visibleActions.some((visible) => JSON.stringify(visible) === JSON.stringify(action))
    ))).toBe(true);
  });

  it("runs a battle fixture through bridge-level visible scripts", () => {
    const agent = createDuelPvpAgent();
    const started = agent.start({ player0Ydk: rodOnlyYdk, player1Ydk: rodOnlyYdk, seed: "pvp-agent-visible-battle", handSize: 1 });

    const result = agent.runVisibleScript([
      { player: 0, type: "normalSummon", labelIncludes: "Magician's Rod" },
      { player: 0, type: "changePhase", phase: "battle", windowKind: "open" },
      { player: 0, type: "declareAttack", labelIncludes: "Direct attack", directAttack: true },
      { player: 1, type: "passAttack", groupLabel: "Attack Response" },
      { player: 0, type: "passAttack", groupLabel: "Attack Response" },
      { player: 1, type: "passDamage", groupLabel: "Damage Step Response" },
      { player: 0, type: "passDamage", groupLabel: "Damage Step Response" },
      { player: 1, type: "passDamage", groupLabel: "Damage Step Response" },
      { player: 0, type: "passDamage", groupLabel: "Damage Step Response" },
      { player: 1, type: "passDamage", groupLabel: "Damage Step Response" },
      { player: 0, type: "passDamage", groupLabel: "Damage Step Response" },
      { player: 1, type: "passDamage", groupLabel: "Damage Step Response" },
      { player: 0, type: "passDamage", groupLabel: "Damage Step Response" },
      { player: 1, type: "passDamage", groupLabel: "Damage Step Response" },
      { player: 0, type: "passDamage", groupLabel: "Damage Step Response" },
    ], started.sessionId);

    expect(result.ok).toBe(true);
    expect(result.failedStep).toBeUndefined();
    expect(result.state.attacksDeclared).toHaveLength(1);
    expect(result.state.log).toContainEqual(expect.objectContaining({ action: "attack", card: "Magician's Rod", detail: "Direct attack" }));
  });

  it("auto-runs bounded visible battlefield actions without inventing hidden actions", () => {
    const agent = createDuelPvpAgent();
    const started = agent.start({ player0Ydk: starterYdk, player1Ydk: starterYdk, seed: "pvp-agent-auto", handSize: 2 });
    const firstVisibleKeys = new Set(started.visibleBattlefield.actions.map((action) => JSON.stringify(action)));

    const result = agent.autoRunVisible({ sessionId: started.sessionId, maxActions: 2 });

    expect(result.ok).toBe(true);
    expect(result.reason).toBe("maxActions");
    expect(result.steps).toHaveLength(2);
    expect(firstVisibleKeys.has(JSON.stringify(result.steps[0]?.action))).toBe(true);
    expect(result.state.id).toBe(started.sessionId);
    expect(result.visibleGroups.flatMap((group) => group.actions).every((action) => (
      result.visibleActions.some((visible) => JSON.stringify(visible) === JSON.stringify(action))
    ))).toBe(true);
  });

  it("reports zero-action visible autoplay as a bounded stop", () => {
    const agent = createDuelPvpAgent();
    const started = agent.start({ player0Ydk: starterYdk, player1Ydk: starterYdk, seed: "pvp-agent-auto-zero", handSize: 2 });

    const result = agent.autoRunVisible({ sessionId: started.sessionId, maxActions: 0 });

    expect(result.ok).toBe(true);
    expect(result.reason).toBe("maxActions");
    expect(result.steps).toEqual([]);
    expect(result.state.id).toBe(started.sessionId);
  });

  it("returns prompt views with visible autoplay stop payloads", () => {
    const agent = createDuelPvpAgent();
    const started = agent.start({ player0Ydk: starterYdk, player1Ydk: starterYdk, seed: "pvp-agent-auto-prompt", handSize: 2 });
    const snapshot = agent.serialize(started.sessionId);
    snapshot.state.prompt = { id: "agent-auto-prompt", type: "selectYesNo", player: 0, description: 901, returnTo: 1 };
    snapshot.state.waitingFor = 0;
    agent.restore(snapshot);

    const result = agent.autoRunVisible({ sessionId: started.sessionId, maxActions: 0 });

    expect(result.ok).toBe(true);
    expect(result.reason).toBe("maxActions");
    expect(result.prompt).toMatchObject({ label: "Yes / No Prompt", detail: "P1 · Prompt agent-auto-prompt · returns P2 · text 901" });
    expect(result.prompt?.groups.flatMap((group) => group.actions)).toEqual(result.visibleActions);
    expect(result.visibleActions).toContainEqual(expect.objectContaining({ type: "selectYesNo", promptId: "agent-auto-prompt", yes: true }));
  });
});
