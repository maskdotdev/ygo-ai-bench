import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua temporary removal flag resets", () => {
  const cards: DuelCardData[] = [{ code: "102", name: "Flag Remove Source", kind: "monster" }];

  it("expires card flags on temporary removal without treating it as ordinary remove or leave", () => {
    const { session, host } = createFlagRemoveProbe(144);

    const result = host.loadScript(
      `
      local c=Duel.GetFieldGroup(0, LOCATION_HAND, 0):GetFirst()
      c:RegisterFlagEffect(928, RESET_EVENT + RESET_TEMP_REMOVE, 0, 1)
      c:RegisterFlagEffect(929, RESET_EVENT + RESET_REMOVE, 0, 1)
      c:RegisterFlagEffect(930, RESET_EVENT + RESET_LEAVE, 0, 1)
      Debug.Message("temporary remove " .. Duel.Remove(c, POS_FACEUP, REASON_EFFECT + REASON_TEMPORARY))
      Debug.Message("temporary flags " .. c:GetFlagEffect(928) .. "/" .. c:GetFlagEffect(929) .. "/" .. c:GetFlagEffect(930))
      `,
      "flag-temp-remove-reset.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["temporary remove 1", "temporary flags 0/1/1"]);
    expect(session.state.flagEffects.map((flag) => flag.code).sort()).toEqual([929, 930]);
  });

  it("expires card flags on ordinary removal without treating it as temporary removal", () => {
    const { session, host } = createFlagRemoveProbe(145);

    const result = host.loadScript(
      `
      local c=Duel.GetFieldGroup(0, LOCATION_HAND, 0):GetFirst()
      c:RegisterFlagEffect(928, RESET_EVENT + RESET_TEMP_REMOVE, 0, 1)
      c:RegisterFlagEffect(929, RESET_EVENT + RESET_REMOVE, 0, 1)
      c:RegisterFlagEffect(930, RESET_EVENT + RESET_LEAVE, 0, 1)
      Debug.Message("ordinary remove " .. Duel.Remove(c, POS_FACEUP, REASON_EFFECT))
      Debug.Message("ordinary flags " .. c:GetFlagEffect(928) .. "/" .. c:GetFlagEffect(929) .. "/" .. c:GetFlagEffect(930))
      `,
      "flag-ordinary-remove-reset.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["ordinary remove 1", "ordinary flags 1/0/0"]);
    expect(session.state.flagEffects).toEqual([expect.objectContaining({ code: 928 })]);
  });

  function createFlagRemoveProbe(seed: number) {
    const session = createDuel({ seed, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["102"] },
      1: { main: [] },
    });
    startDuel(session);
    return { session, host: createLuaScriptHost(session) };
  }
});
