import { describe, expect, it } from "vitest";
import { createDuelPvpAgent } from "#playtest/duel-pvp-agent-bridge.js";
import { starterYdk } from "../src/playtest-app/ui.js";

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
});
