import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua bit compatibility API", () => {
  it("provides EDOPro-style bit extract and replace helpers", () => {
    const session = createDuel({ seed: 826, startingHandSize: 0, drawPerTurn: 0, cardReader: createCardReader([]) });
    loadDecks(session, { 0: { main: [] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("bit replace " .. bit.replace(0,0x1,2))
      Debug.Message("bit extract " .. bit.extract(4,2))
      Debug.Message("bit clear " .. bit.replace(15,0,1,2))
      Debug.Message("bit ops " .. bit.band(7,3) .. "/" .. bit.bor(4,2) .. "/" .. bit.bxor(7,3))
      `,
      "bit-api.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["bit replace 4", "bit extract 1", "bit clear 9", "bit ops 3/6/4"]);
  });
});
