import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { createDuel, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua effect script missing restore", () => {
  it("keeps missing Lua effect scripts fail-closed after snapshot restore", () => {
    const source = {
      readScript(name: string) {
        if (name === "c100.lua") return ignitionScript();
        return undefined;
      },
    };
    const missingSource = { readScript: () => undefined };
    const cards = normalizeCdbRows([{ id: 100, type: 1 }], []);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 610, startingHandSize: 1, cardReader: reader });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const action = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(action).toBeDefined();

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), missingSource, reader);
    expect(restored.restoreComplete).toBe(false);
    expect(restored.loadedScripts).toEqual([expect.objectContaining({ ok: false, name: "c100.lua", error: "Script c100.lua was not found" })]);
    expect(restored.missingRegistryKeys).toEqual(["lua:100:lua-1"]);
    expect(restored.incompleteReasons).toEqual(["script c100.lua: Script c100.lua was not found", "missing Lua effect registry keys: lua:100:lua-1"]);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual([]);
    expect(applyLuaRestoreResponse(restored, { ...action!, windowToken: restored.session.state.actionWindowToken })).toMatchObject({
      ok: false,
      error: "Lua snapshot restore is incomplete: script c100.lua: Script c100.lua was not found; missing Lua effect registry keys: lua:100:lua-1",
      legalActions: [],
      legalActionGroups: [],
    });
  });

  it("keeps Lua effect script load errors fail-closed after snapshot restore", () => {
    const source = {
      readScript(name: string) {
        if (name === "c100.lua") return ignitionScript();
        return undefined;
      },
    };
    const brokenSource = {
      readScript(name: string) {
        if (name === "c100.lua") return "this is not valid lua";
        return undefined;
      },
    };
    const cards = normalizeCdbRows([{ id: 100, type: 1 }], []);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 611, startingHandSize: 1, cardReader: reader });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const action = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(action).toBeDefined();

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), brokenSource, reader);
    expect(restored.restoreComplete).toBe(false);
    expect(restored.loadedScripts).toEqual([expect.objectContaining({ ok: false, name: "c100.lua" })]);
    expect(restored.incompleteReasons[0]).toContain("script c100.lua:");
    expect(restored.incompleteReasons[1]).toBe("missing Lua effect registry keys: lua:100:lua-1");
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual([]);
    const response = applyLuaRestoreResponse(restored, { ...action!, windowToken: restored.session.state.actionWindowToken });
    expect(response).toMatchObject({ ok: false, legalActions: [], legalActionGroups: [] });
    expect(response.error).toContain("Lua snapshot restore is incomplete: script c100.lua:");
    expect(response.error).toContain("missing Lua effect registry keys: lua:100:lua-1");
  });
});

function ignitionScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("missing script source resolved") end)
      c:RegisterEffect(e)
    end
  `;
}
