import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { chooseHighestPriority, runPlaytest, startPlaytest } from "#playtest/api.js";
import { parseYdk } from "#playtest/ydk.js";

describe("included Dark Magician deck", () => {
  it("runs fixed-seed opening playtests without impossible zone state", () => {
    const ydk = parseYdk(fs.readFileSync(path.join(process.cwd(), "dark-magical-blast-tcg-branded-dm.ydk"), "utf8"));

    for (const [seed, expectedLogLength] of [[1, 20], [7, 18], [42, 11]] as const) {
      const session = startPlaytest({ deck: ydk.main, extraDeck: ydk.extra, seed, handSize: 5 });
      const result = runPlaytest(session, chooseHighestPriority, 10);
      const uids = Object.values(session.engine.state.zones).flat().map((card) => card.uid);

      expect(result.ok).toBe(true);
      expect(uids).toHaveLength(new Set(uids).size);
      const mainCardsOnField = result.state.field.filter((card) => card.type !== "extra").length;
      expect(result.state.deckCount + result.state.hand.length + mainCardsOnField + result.state.graveyard.length + result.state.banished.length).toBe(ydk.main.length);
      expect(result.state.extraDeck.length + result.state.field.filter((card) => card.type === "extra").length).toBeLessThanOrEqual(ydk.extra.length);
      expect(result.state.log.length).toBe(expectedLogLength);
    }
  });
});
