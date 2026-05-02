import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua CheckEvent payloads", () => {
  it("returns stored event payloads when requested", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Checked Event Card", kind: "monster" }];
    const session = createDuel({ seed: 210, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Duel.RaiseEvent(target, EVENT_TO_GRAVE, nil, REASON_EFFECT, 0, 0, 0)
      local ok,eg,ep,ev,re,r,rp=Duel.CheckEvent(EVENT_TO_GRAVE,true)
      Debug.Message("check payload " .. tostring(ok) .. "/" .. eg:GetFirst():GetCode() .. "/" .. ep .. "/" .. ev .. "/" .. tostring(re==nil) .. "/" .. r .. "/" .. rp)
      `,
      "check-event-payload.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("check payload true/100/0/0/true/64/0");
  });

  it("matches CheckEvent by numeric event code when event-name aliases share a bucket", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Moved Event Card", kind: "monster" }];
    const session = createDuel({ seed: 211, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil)
      Duel.SendtoGrave(target, REASON_EFFECT)
      Debug.Message("check event codes " .. tostring(Duel.CheckEvent(EVENT_TO_GRAVE)) .. "/" .. tostring(Duel.CheckEvent(EVENT_LEAVE_FIELD_P)))
      `,
      "check-event-code-match.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("check event codes true/false");
  });

  it("returns EVENT_CHAINING payloads from the active chain window", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Chain Starter", kind: "monster" },
    ];
    const session = createDuel({ seed: 212, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const register = host.loadScript(
      `
      local starter = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local start = Effect.CreateEffect(starter)
      start:SetType(EFFECT_TYPE_IGNITION)
      start:SetRange(LOCATION_HAND)
      start:SetLabel(912)
      start:SetOperation(function(e,tp) Debug.Message("starter resolved") end)
      starter:RegisterEffect(start)
      `,
      "check-event-chaining-register.lua",
    );
    expect(register.ok, register.error).toBe(true);

    const startAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(startAction).toBeDefined();
    expect(applyResponse(session, startAction!).ok).toBe(true);

    const check = host.loadScript(
      `
      local ok,eg,ep,ev,re,r,rp = Duel.CheckEvent(EVENT_CHAINING,true)
      Debug.Message("check chaining " .. tostring(ok) .. "/" .. eg:GetFirst():GetCode() .. "/" .. ep .. "/" .. ev .. "/" .. tostring(re:GetLabel()) .. "/" .. rp)
      `,
      "check-event-chaining-read.lua",
    );
    expect(check.ok, check.error).toBe(true);

    expect(host.messages).toContain("check chaining true/100/0/1/912/0");
  });
});
