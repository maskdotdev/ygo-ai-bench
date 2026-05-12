import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
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

  it("preserves numeric alias codes from Lua-raised events", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Alias Event Card", kind: "monster" },
      { code: "200", name: "Primary Alias Watcher", kind: "monster" },
      { code: "300", name: "Secondary Alias Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 213, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local primary = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local secondary = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local p=Effect.CreateEffect(primary)
      p:SetType(EFFECT_TYPE_TRIGGER_O)
      p:SetCode(EVENT_LEAVE_FIELD)
      p:SetRange(LOCATION_HAND)
      p:SetOperation(function(e,tp,eg) Debug.Message("primary alias should not queue") end)
      primary:RegisterEffect(p)
      local s=Effect.CreateEffect(secondary)
      s:SetType(EFFECT_TYPE_TRIGGER_O)
      s:SetCode(EVENT_LEAVE_FIELD_P)
      s:SetRange(LOCATION_HAND)
      s:SetOperation(function(e,tp,eg) Debug.Message("secondary alias queued " .. eg:GetFirst():GetCode()) end)
      secondary:RegisterEffect(s)
      Duel.RaiseEvent(target, EVENT_LEAVE_FIELD_P, nil, REASON_EFFECT, 0, 0, 0)
      Debug.Message("raised alias check " .. tostring(Duel.CheckEvent(EVENT_LEAVE_FIELD_P)) .. "/" .. tostring(Duel.CheckEvent(EVENT_LEAVE_FIELD)))
      `,
      "check-event-raised-alias.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("raised alias check true/false");
    expect(session.state.eventHistory.at(-1)).toMatchObject({ eventName: "leftField", eventCode: 1019 });
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventCode)).toEqual([1019]);
  });

  it("restores queued Lua triggers raised with numeric alias event codes", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Alias Restored Event Card", kind: "monster" },
      { code: "200", name: "Alias Restored Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 214, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: [] } });
    startDuel(session);
    const source = {
      readScript(name: string) {
        if (name !== "c200.lua") return undefined;
        return `
        c200={}
        function c200.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_TRIGGER_O)
          e:SetCode(EVENT_LEAVE_FIELD_P)
          e:SetRange(LOCATION_HAND)
          e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
            Debug.Message("restored alias trigger " .. eg:GetFirst():GetCode() .. "/" .. ep .. "/" .. ev .. "/" .. r .. "/" .. rp)
          end)
          c:RegisterEffect(e)
        end
        `;
      },
    };
    const host = createLuaScriptHost(session);
    const loaded = host.loadCardScript(200, source);
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const result = host.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Duel.RaiseEvent(target, EVENT_LEAVE_FIELD_P, nil, REASON_EFFECT, 1, 0, 23)
      `,
      "queue-restored-alias-event.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventName: "leftField", eventCode: 1019, eventPlayer: 0, eventValue: 23, eventReason: 64, eventReasonPlayer: 1 });
    const originalTrigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(originalTrigger).toBeDefined();

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.session.state.pendingTriggers).toEqual(session.state.pendingTriggers);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    const originalTriggerPreapply = applyLuaRestoreResponse(restored, originalTrigger!);
    expect(originalTriggerPreapply.ok).toBe(false);
    expect(originalTriggerPreapply.error).toContain("Response is not currently legal");
    assertPublicRestoreMetadata(restored, originalTriggerPreapply);
    expect(originalTriggerPreapply.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    applyLuaRestoreAndAssert(restored, trigger!);
    expect(restored.host.messages).toContain("restored alias trigger 100/0/23/64/1");
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
    const started = applyResponse(session, startAction!);
    expect(started.ok, started.error).toBe(true);
    expect(started.legalActions).toEqual(getDuelLegalActions(session, started.state.waitingFor!));
    expect(started.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, started.state.waitingFor!));
    expect(started.legalActionGroups.flatMap((group) => group.actions)).toEqual(started.legalActions);

    const check = host.loadScript(
      `
      local ok,eg,ep,ev,re,r,rp = Duel.CheckEvent(EVENT_CHAINING,true)
      Debug.Message("check chaining " .. tostring(ok) .. "/" .. eg:GetFirst():GetCode() .. "/" .. ep .. "/" .. ev .. "/" .. tostring(re:GetLabel()) .. "/" .. tostring(re:GetHandler():IsCode(100)) .. "/" .. rp)
      `,
      "check-event-chaining-read.lua",
    );
    expect(check.ok, check.error).toBe(true);

    expect(host.messages).toContain("check chaining true/100/0/1/912/true/0");
  });
});

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: Parameters<typeof applyLuaRestoreResponse>[1]) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  assertPublicRestoreMetadata(restored, response);
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function assertPublicRestoreMetadata(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: ReturnType<typeof applyLuaRestoreResponse>): void {
  const publicState = queryPublicState(restored.session);
  expect(response.state.pendingTriggerBuckets).toEqual(publicState.pendingTriggerBuckets);
  if ("triggerOrderPrompt" in publicState) expect(response.state.triggerOrderPrompt).toEqual(publicState.triggerOrderPrompt);
  else expect(response.state).not.toHaveProperty("triggerOrderPrompt");
}
