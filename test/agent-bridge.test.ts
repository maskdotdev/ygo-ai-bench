import { describe, expect, it } from "vitest";
import { createPlaytestAgent, toStartOptions } from "#playtest/agent-bridge.js";
import { parseYdk } from "#playtest/ydk.js";
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
    expect(result.state.log.length).toBeGreaterThanOrEqual(2);
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
});
