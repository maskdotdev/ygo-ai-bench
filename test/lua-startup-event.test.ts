import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua startup events", () => {
  it("runs registered EVENT_STARTUP effects through the Lua host startup hook", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Startup Source", kind: "monster" }];
    const session = createDuel({ seed: 203, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
        e:SetCode(EVENT_STARTUP)
        e:SetRange(LOCATION_HAND)
        e:SetCountLimit(1)
        e:SetOperation(function(e,tp)
          Debug.Message("startup op " .. tp .. "/" .. tostring(Duel.CheckEvent(EVENT_STARTUP)))
        end)
        c:RegisterEffect(e)
      end
      `,
      "startup-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(host.runStartupEffects()).toBe(1);
    expect(host.runStartupEffects()).toBe(0);
    expect(host.messages).toContain("startup op 0/true");
    expect(session.state.eventHistory).toContainEqual(expect.objectContaining({ eventName: "startup", eventCode: 1000 }));
  });
});
