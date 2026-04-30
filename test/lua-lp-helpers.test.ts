import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, queryPublicState, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua LP helpers", () => {
  it("lets Lua scripts end the duel with a win reason", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Win Condition", kind: "monster" }];
    const session = createDuel({ seed: 94, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Duel.Win(0, WIN_REASON_EXODIA)
      Debug.Message("winner set")
      `,
      "win.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("winner set");
    expect(session.state.status).toBe("ended");
    expect(session.state.winner).toBe(0);
    expect(session.state.winReason).toBe(0x10);
    expect(session.state.waitingFor).toBeUndefined();
    expect(session.state.log).toContainEqual(expect.objectContaining({ action: "win", player: 0, detail: "16" }));
    expect(queryPublicState(session)).toMatchObject({ status: "ended", winner: 0, winReason: 0x10 });
  });

  it("lets Lua scripts declare a draw result", () => {
    const session = createDuel({ seed: 95, startingHandSize: 0 });
    loadDecks(session, {
      0: { main: [] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Duel.Win(PLAYER_NONE, WIN_REASON_DEUCE)
      `,
      "draw-win.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(session.state.status).toBe("ended");
    expect(session.state.winner).toBe("draw");
    expect(session.state.winReason).toBe(0x54);
    expect(session.state.log).toContainEqual(expect.objectContaining({ action: "win", detail: "84" }));
  });
});
