import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";

const cards: DuelCardData[] = [{ code: "100", name: "Random Probe", kind: "monster" }];

describe("Lua random helpers", () => {
  it("lets Lua scripts toss deterministic dice", () => {
    const first = setupSession(152);
    const second = setupSession(152);

    const firstMessages = tossDiceMessages(first);
    const secondMessages = tossDiceMessages(second);

    expect(firstMessages).toEqual(secondMessages);
    expect(firstMessages[0]).toMatch(/^dice one [1-6]$/);
    expect(firstMessages[1]).toMatch(/^dice two [1-6],[1-6]$/);
    expect(first.state.randomCounter).toBe(3);
    expect(first.state.log.some((entry) => entry.action === "tossDice" && entry.detail.includes(","))).toBe(true);
  });

  it("preserves dice progression across snapshots", () => {
    const original = setupSession(153);
    const firstHost = createLuaScriptHost(original);
    const first = firstHost.loadScript(
      `
      local a=Duel.TossDice(0,1)
      Debug.Message("before snapshot " .. a)
      `,
      "dice-before-snapshot.lua",
    );
    expect(first.ok, first.error).toBe(true);

    const restored = restoreDuel(serializeDuel(original), createCardReader(cards));
    const restoredHost = createLuaScriptHost(restored);
    const restoredRoll = restoredHost.loadScript(
      `
      local a=Duel.TossDice(0,1)
      Debug.Message("after snapshot " .. a)
      `,
      "dice-after-snapshot.lua",
    );
    expect(restoredRoll.ok, restoredRoll.error).toBe(true);

    const continuousHost = createLuaScriptHost(original);
    const continuousRoll = continuousHost.loadScript(
      `
      local a=Duel.TossDice(0,1)
      Debug.Message("continuous " .. a)
      `,
      "dice-continuous.lua",
    );
    expect(continuousRoll.ok, continuousRoll.error).toBe(true);
    expect(restoredHost.messages[0]?.replace("after snapshot", "continuous")).toBe(continuousHost.messages[0]);
  });
});

function setupSession(seed: number): DuelSession {
  const session = createDuel({ seed, startingHandSize: 1, cardReader: createCardReader(cards) });
  loadDecks(session, {
    0: { main: ["100"] },
    1: { main: ["100"] },
  });
  startDuel(session);
  return session;
}

function tossDiceMessages(session: DuelSession): string[] {
  const host = createLuaScriptHost(session);
  const result = host.loadScript(
    `
    local a=Duel.TossDice(0,1)
    local b,c=Duel.TossDice(1,2)
    Debug.Message("dice one " .. a)
    Debug.Message("dice two " .. b .. "," .. c)
    `,
    "dice-toss.lua",
  );
  expect(result.ok, result.error).toBe(true);
  return host.messages;
}
