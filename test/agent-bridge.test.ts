import { describe, expect, it } from "vitest";
import { createPlaytestAgent, toStartOptions } from "#playtest/agent-bridge.js";
import { groupLegalActions } from "#playtest/api.js";
import { parseYdk } from "#playtest/ydk.js";
import type { PlaytestAction } from "#engine/types.js";
import { DARK_MAGICIAN_CARD_IDS as IDS } from "#cards/definitions.js";

describe("playtest agent bridge", () => {
  it("starts from an app-style serialized deck", () => {
    const agent = createPlaytestAgent({
      deck: {
        main: {
          [IDS.magiciansRod]: 1,
          [IDS.darkMagicalCircle]: 1,
          [IDS.darkMagician]: 1,
        },
        extra: {
          [IDS.theDarkMagicians]: 1,
        },
      },
    });

    const started = agent.start({ seed: 1, handSize: 2 });

    expect(started.ok).toBe(true);
    expect(agent.status().sessions).toBe(1);
    expect(started.state.hand).toHaveLength(2);
    expect(started.legalActionGroups.flatMap((group) => group.actions)).toEqual(started.legalActions);
  });

  it("starts from YDK text and can auto-run", () => {
    const ydk = `#main
${IDS.magiciansRod}
${IDS.darkMagicalCircle}
${IDS.darkMagician}
#extra
${IDS.theDarkMagicians}
!side`;
    const agent = createPlaytestAgent();

    const started = agent.start({ ydk, seed: 2, handSize: 2 });
    const result = agent.autoRun({ sessionId: started.sessionId, maxActions: 3 });

    expect(result.ok).toBe(true);
    expect(result.state.log.length).toBe(5);
  });

  it("normalizes record zones into repeated ids", () => {
    const options = toStartOptions({
      deck: { [IDS.darkMagician]: 2, [IDS.magiciansRod]: 1 },
      extraDeck: { [IDS.theDarkMagicians]: 1 },
    });

    expect(options.deck.filter((id) => id === IDS.darkMagician)).toHaveLength(2);
    expect(options.deck.filter((id) => id === IDS.magiciansRod)).toHaveLength(1);
    expect(options.extraDeck).toEqual([IDS.theDarkMagicians]);
  });

  it("parses YDK text through the bridge inputs", () => {
    const parsed = parseYdk(`#main\n${IDS.darkMagician}\n#extra\n${IDS.theDarkMagicians}\n!side\n`);

    expect(parsed.main).toEqual([IDS.darkMagician]);
    expect(parsed.extra).toEqual([IDS.theDarkMagicians]);
  });

  it("exposes grouped legal actions for app and agent consumers", () => {
    const agent = createPlaytestAgent({
      deck: {
        main: {
          [IDS.magiciansRod]: 1,
          [IDS.darkMagicalCircle]: 1,
          [IDS.darkMagician]: 1,
        },
      },
    });

    const started = agent.start({ seed: 1, handSize: 2 });
    const groups = agent.legalActionGroups(started.sessionId);

    expect(groups).toHaveLength(4);
    expect(groups.flatMap((group) => group.actions)).toEqual(agent.legalActions(started.sessionId));
    expect(groups.every((group) => group.key && group.label)).toBe(true);
  });

  it("copies grouped legal action payloads at the agent boundary", () => {
    const agent = createPlaytestAgent({
      deck: {
        main: {
          [IDS.magiciansRod]: 1,
          [IDS.darkMagicalCircle]: 1,
          [IDS.darkMagician]: 1,
        },
      },
    });
    const started = agent.start({ seed: 1, handSize: 2 });
    const groups = agent.legalActionGroups(started.sessionId);
    const groupedAction = groups[0]?.actions[0];
    expect(groupedAction).toBeDefined();

    groupedAction!.label = "Mutated action";

    expect(agent.legalActions(started.sessionId)[0]?.label).not.toBe("Mutated action");
    expect(agent.state(started.sessionId).legalActions[0]?.label).not.toBe("Mutated action");
  });

  it("copies grouped legal action payloads away from the source action list", () => {
    const actions: PlaytestAction[] = [{ type: "normalSummon", uid: "card-a", label: "Normal Summon card-a" }];
    const groups = groupLegalActions(actions);
    const groupedAction = groups[0]?.actions[0];
    expect(groupedAction).toBeDefined();

    groupedAction!.label = "Mutated action";

    expect(actions[0]).toEqual({ type: "normalSummon", uid: "card-a", label: "Normal Summon card-a" });
  });

  it("returns grouped legal actions after applying an action", () => {
    const agent = createPlaytestAgent({
      deck: {
        main: {
          [IDS.magiciansRod]: 1,
          [IDS.darkMagicalCircle]: 1,
          [IDS.darkMagician]: 1,
        },
      },
    });
    const started = agent.start({ seed: 1, handSize: 2 });
    const action = started.legalActions.find((candidate) => candidate.type !== "end");

    const result = agent.action(action!, started.sessionId);

    expect(result.ok).toBe(true);
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  });

  it("rejects malformed agent actions through the public action boundary", () => {
    const agent = createPlaytestAgent({
      deck: {
        main: {
          [IDS.magiciansRod]: 1,
          [IDS.darkMagician]: 1,
        },
      },
    });
    const started = agent.start({ seed: 2, handSize: 2 });

    const result = agent.action(null, started.sessionId);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Action is not currently legal");
    expect(result.state.hand.map((card) => card.uid)).toEqual(started.state.hand.map((card) => card.uid));
  });

  it("runs fixture-style scripted actions through the agent bridge", () => {
    const agent = createPlaytestAgent({
      deck: {
        main: {
          [IDS.magiciansRod]: 1,
          [IDS.darkMagicalCircle]: 1,
          [IDS.darkMagician]: 1,
        },
      },
    });
    const started = agent.start({ seed: 1, handSize: 2 });
    const firstAction = started.legalActions.find((candidate) => candidate.type !== "end")!;

    const result = agent.runScripted([{ type: firstAction.type, labelIncludes: firstAction.label }], started.sessionId);

    expect(result.ok).toBe(true);
    expect(result.failedStep).toBeUndefined();
    expect(result.state.log.length).toBe(started.state.log.length + 2);
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  });

  it("reports the diverging scripted action step", () => {
    const agent = createPlaytestAgent({
      deck: {
        main: {
          [IDS.magiciansRod]: 1,
          [IDS.darkMagicalCircle]: 1,
          [IDS.darkMagician]: 1,
        },
      },
    });
    const started = agent.start({ seed: 1, handSize: 2 });

    const result = agent.runScripted([{ type: "activateEffect", effectId: "missing-effect" }], started.sessionId);

    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe(0);
    expect(result.failure).toBe("No legal action matched type=activateEffect effectId=missing-effect");
    expect(result.divergenceGroupKey).toBe(result.legalActionGroups[0]?.key);
    expect(result.divergenceGroupLabel).toBe(result.legalActionGroups[0]?.label);
    expect(result.divergenceActions).toEqual(result.legalActions);
    expect(result.divergenceActions).toHaveLength(4);
    expect(result.divergenceActions).not.toBe(result.legalActions);
    expect(result.sessionId).toBe(started.sessionId);
  });
});
