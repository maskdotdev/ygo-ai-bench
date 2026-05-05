import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua ended activity helpers", () => {
  it("keeps custom activity counters from registering after duel end", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Allowed Activity", kind: "monster" },
      { code: "200", name: "Blocked Activity", kind: "monster" },
    ];
    const session = createDuel({ seed: 228, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);
    const blocked = session.state.cards.find((card) => card.code === "200");
    expect(blocked).toBeDefined();
    specialSummonDuelCard(session.state, blocked!.uid, 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Duel.Win(0, WIN_REASON_EXODIA)
      Duel.AddCustomActivityCounter(9900, ACTIVITY_SPSUMMON, aux.FilterBoolFunction(Card.IsCode, 100))
      Debug.Message("ended custom activity " .. Duel.GetCustomActivityCount(9900, 0, ACTIVITY_SPSUMMON))
      `,
      "ended-custom-activity.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["ended custom activity 0"]);
    expect(session.state.status).toBe("ended");
    expect(session.state.activityHistory.filter((record) => record.activity === 0x4)).toHaveLength(1);
  });
});
