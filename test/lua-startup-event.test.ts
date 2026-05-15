import { describe, expect, it } from "vitest";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

function expectRestoredLegalActionGroups(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

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

  it("keeps startup count limits spent after Lua snapshot restore", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Restore Startup Source", kind: "monster" }];
    const source = {
      readScript(name: string) {
        if (name !== "c100.lua") return undefined;
        return `
        c100={}
        function c100.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
          e:SetCode(EVENT_STARTUP)
          e:SetRange(LOCATION_HAND)
          e:SetCountLimit(1)
          e:SetOperation(function(e,tp)
            Debug.Message("restored startup op " .. tp .. "/" .. tostring(Duel.CheckEvent(EVENT_STARTUP)))
          end)
          c:RegisterEffect(e)
        end
        `;
      },
    };
    const session = createDuel({ seed: 204, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadCardScript(100, source);
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(host.runStartupEffects()).toBe(1);
    expect(host.messages).toContain("restored startup op 0/true");

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    expect(restored.registeredEffects).toBe(1);
    expect(restored.session.state.eventHistory).toContainEqual(expect.objectContaining({ eventName: "startup", eventCode: 1000 }));
    expect(restored.host.runStartupEffects()).toBe(0);
    expect(restored.host.messages).not.toContain("restored startup op 0/true");
  });

  it("runs unspent startup effects after Lua snapshot restore", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Unspent Startup Source", kind: "monster" }];
    const source = {
      readScript(name: string) {
        if (name !== "c100.lua") return undefined;
        return `
        c100={}
        function c100.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
          e:SetCode(EVENT_STARTUP)
          e:SetRange(LOCATION_HAND)
          e:SetCountLimit(1)
          e:SetOperation(function(e,tp)
            Debug.Message("unspent restored startup " .. tp .. "/" .. tostring(Duel.CheckEvent(EVENT_STARTUP)))
          end)
          c:RegisterEffect(e)
        end
        `;
      },
    };
    const session = createDuel({ seed: 205, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadCardScript(100, source);
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(host.messages).toEqual([]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    expect(restored.registeredEffects).toBe(1);
    expect(restored.host.runStartupEffects()).toBe(1);
    expect(restored.host.runStartupEffects()).toBe(0);
    expect(restored.host.messages).toEqual(["unspent restored startup 0/true"]);
    expect(restored.session.state.eventHistory).toContainEqual(expect.objectContaining({ eventName: "startup", eventCode: 1000 }));
  });
});
