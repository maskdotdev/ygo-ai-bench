import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";

describe("Lua overlay detach grouped events", () => {
  it("binds grouped EVENT_DETACH_MATERIAL single triggers only to detached materials", () => {
    const fixture = createOverlayDetachFixture();
    const loaded = fixture.host.loadScript(
      `
      local xyz=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 920), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local overlays=xyz:GetOverlayGroup()
      local first=overlays:Filter(aux.FilterBoolFunction(Card.IsCode, 100), nil):GetFirst()
      local second=overlays:Filter(aux.FilterBoolFunction(Card.IsCode, 101), nil):GetFirst()
      local generic_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local single_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 301), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local first_trigger=Effect.CreateEffect(first)
      first_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      first_trigger:SetCode(EVENT_DETACH_MATERIAL)
      first_trigger:SetRange(LOCATION_GRAVE)
      first_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("first detach single " .. eg:GetCount() .. "/" .. Duel.GetOperatedGroup():GetCount())
      end)
      first:RegisterEffect(first_trigger)

      local second_trigger=Effect.CreateEffect(second)
      second_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      second_trigger:SetCode(EVENT_DETACH_MATERIAL)
      second_trigger:SetRange(LOCATION_GRAVE)
      second_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("second detach single " .. eg:GetCount() .. "/" .. Duel.GetOperatedGroup():GetCount())
      end)
      second:RegisterEffect(second_trigger)

      local generic_trigger=Effect.CreateEffect(generic_watcher)
      generic_trigger:SetType(EFFECT_TYPE_TRIGGER_O)
      generic_trigger:SetCode(EVENT_DETACH_MATERIAL)
      generic_trigger:SetRange(LOCATION_HAND)
      generic_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("generic detach group " .. eg:GetCount() .. "/" .. Duel.GetOperatedGroup():GetCount())
      end)
      generic_watcher:RegisterEffect(generic_trigger)

      local wrong_single=Effect.CreateEffect(single_watcher)
      wrong_single:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      wrong_single:SetCode(EVENT_DETACH_MATERIAL)
      wrong_single:SetRange(LOCATION_HAND)
      wrong_single:SetOperation(function(e,tp,eg)
        Debug.Message("wrong detach single " .. eg:GetCount())
      end)
      single_watcher:RegisterEffect(wrong_single)

      Debug.Message("detach source-only grouped " .. xyz:RemoveOverlayCard(0, 2, 2, REASON_EFFECT))
      `,
      "overlay-detach-source-only-grouped-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    const first = fixture.session.state.cards.find((card) => card.code === "100");
    const second = fixture.session.state.cards.find((card) => card.code === "101");
    const genericWatcher = fixture.session.state.cards.find((card) => card.code === "300");
    const singleWatcher = fixture.session.state.cards.find((card) => card.code === "301");
    expect(fixture.host.messages).toContain("detach source-only grouped 2");
    const detachTriggers = fixture.session.state.pendingTriggers.filter((trigger) => trigger.eventName === "detachedMaterial");
    expect(detachTriggers).toHaveLength(3);
    for (const trigger of detachTriggers) expect(trigger.eventUids).toEqual([first!.uid, second!.uid]);
    expect(detachTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: first!.uid, eventCardUid: first!.uid }),
        expect.objectContaining({ sourceUid: second!.uid, eventCardUid: second!.uid }),
        expect.objectContaining({ sourceUid: genericWatcher!.uid, eventCardUid: first!.uid }),
      ]),
    );
    expect(detachTriggers.some((trigger) => trigger.sourceUid === singleWatcher!.uid)).toBe(false);

    for (;;) {
      const player = fixture.session.state.waitingFor ?? 0;
      const trigger = getDuelLegalActions(fixture.session, player).find((candidate) => candidate.type === "activateTrigger");
      if (!trigger) break;
      applyAndAssert(fixture.session, trigger);
    }
    expect(fixture.host.messages).toEqual(expect.arrayContaining(["first detach single 2/2", "second detach single 2/2", "generic detach group 2/2"]));
    expect(fixture.host.messages).not.toContain("wrong detach single 2");
  });

  it("collects one grouped detach and grave event for Card.RemoveOverlayCard", () => {
    const fixture = createOverlayDetachFixture();
    const sourceScripts = createGroupedDetachScripts("card", "local xyz=Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 920), tp, LOCATION_MZONE, 0, 1, 1, nil):GetFirst() return xyz:RemoveOverlayCard(tp, 2, 2, REASON_EFFECT)");
    for (const code of [300, 301, 920]) {
      const loaded = fixture.host.loadCardScript(code, sourceScripts);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(fixture.host.registerInitialEffects()).toBe(3);

    const detachWatcher = fixture.session.state.cards.find((card) => card.code === "300");
    const detachAction = getDuelLegalActions(fixture.session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === detachWatcher!.uid);
    expect(detachAction).toBeDefined();
    applyAndAssert(fixture.session, detachAction!);

    assertGroupedDetach(fixture.session, fixture.host, "card detach grouped 2", { sourceScripts, cards: fixture.cards });
  });

  it("collects one grouped detach and grave event for Duel.RemoveOverlayCard", () => {
    const fixture = createOverlayDetachFixture();
    const loaded = fixture.host.loadScript(
      `
      ${registerGroupedWatchers()}
      Debug.Message("duel detach grouped " .. Duel.RemoveOverlayCard(0, LOCATION_MZONE, 0, 2, 2, REASON_EFFECT))
      `,
      "duel-overlay-detach-grouped-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);

    assertGroupedDetach(fixture.session, fixture.host, "duel detach grouped 2");
  });
});

function createOverlayDetachFixture() {
  const cards: DuelCardData[] = [
    { code: "100", name: "Grouped Overlay First", kind: "monster" },
    { code: "101", name: "Grouped Overlay Second", kind: "monster" },
    { code: "300", name: "Grouped Overlay Detach Watcher", kind: "monster" },
    { code: "301", name: "Grouped Overlay Grave Watcher", kind: "monster" },
    { code: "920", name: "Grouped Overlay Xyz", kind: "extra" },
  ];
  const session = createDuel({ seed: 109, startingHandSize: 4, cardReader: createCardReader(cards) });
  loadDecks(session, { 0: { main: ["100", "101", "300", "301"], extra: ["920"] }, 1: { main: [] } });
  startDuel(session);

  const xyz = session.state.cards.find((card) => card.code === "920");
  expect(xyz).toBeDefined();
  moveDuelCard(session.state, xyz!.uid, "monsterZone", 0);
  for (const code of ["100", "101"]) {
    const material = session.state.cards.find((card) => card.code === code);
    expect(material).toBeDefined();
    moveDuelCard(session.state, material!.uid, "overlay", 0);
    xyz!.overlayUids.push(material!.uid);
  }

  return { session, host: createLuaScriptHost(session), cards };
}

function registerGroupedWatchers(): string {
  return `
      local detach_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local grave_watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 301), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local detach_effect=Effect.CreateEffect(detach_watcher)
      detach_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      detach_effect:SetCode(EVENT_DETACH_MATERIAL)
      detach_effect:SetRange(LOCATION_HAND)
      detach_effect:SetOperation(function(e,tp,eg)
        Debug.Message("detach group " .. eg:GetCount())
      end)
      detach_watcher:RegisterEffect(detach_effect)

      local grave_effect=Effect.CreateEffect(grave_watcher)
      grave_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      grave_effect:SetCode(EVENT_TO_GRAVE)
      grave_effect:SetRange(LOCATION_HAND)
      grave_effect:SetOperation(function(e,tp,eg)
        Debug.Message("grave group " .. eg:GetCount())
      end)
      grave_watcher:RegisterEffect(grave_effect)
  `;
}

function createGroupedDetachScripts(label: string, detachCall: string): { readScript(name: string): string | undefined } {
  return {
    readScript(name: string) {
      if (name === "c300.lua") return `
      c300={}
      function c300.initial_effect(c)
      local detach=Effect.CreateEffect(c)
      detach:SetType(EFFECT_TYPE_IGNITION)
      detach:SetRange(LOCATION_HAND)
      detach:SetOperation(function(e,tp)
        Debug.Message("${label} detach grouped " .. (function() ${detachCall} end)())
      end)
      c:RegisterEffect(detach)

      local detach_effect=Effect.CreateEffect(c)
      detach_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      detach_effect:SetCode(EVENT_DETACH_MATERIAL)
      detach_effect:SetRange(LOCATION_HAND)
      detach_effect:SetOperation(function(e,tp,eg)
        Debug.Message("detach group " .. eg:GetCount())
      end)
      c:RegisterEffect(detach_effect)
      end
      `;
      if (name === "c301.lua") return `
      c301={}
      function c301.initial_effect(c)
      local grave_effect=Effect.CreateEffect(c)
      grave_effect:SetType(EFFECT_TYPE_TRIGGER_O)
      grave_effect:SetCode(EVENT_TO_GRAVE)
      grave_effect:SetRange(LOCATION_HAND)
      grave_effect:SetOperation(function(e,tp,eg)
        Debug.Message("grave group " .. eg:GetCount())
      end)
      c:RegisterEffect(grave_effect)
      end
      `;
      if (name === "c920.lua") return `
      c920={}
      function c920.initial_effect(c)
      end
      `;
      return undefined;
    },
  };
}

function assertGroupedDetach(
  session: DuelSession,
  host: ReturnType<typeof createLuaScriptHost>,
  message: string,
  restore?: { sourceScripts: { readScript(name: string): string | undefined }; cards: DuelCardData[] },
): void {
  const first = session.state.cards.find((card) => card.code === "100");
  const second = session.state.cards.find((card) => card.code === "101");
  const detachWatcher = session.state.cards.find((card) => card.code === "300");
  const graveWatcher = session.state.cards.find((card) => card.code === "301");
  expect(host.messages).toContain(message);
  expect(first).toMatchObject({ location: "graveyard" });
  expect(second).toMatchObject({ location: "graveyard" });
  expect(session.state.pendingTriggers).toHaveLength(2);
  for (const trigger of session.state.pendingTriggers) expect(trigger.eventUids).toEqual([first!.uid, second!.uid]);
  expect(session.state.pendingTriggers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ eventName: "sentToGraveyard", eventCardUid: first!.uid }),
      expect.objectContaining({ eventName: "detachedMaterial", eventCardUid: first!.uid }),
    ]),
  );

  if (restore) {
    const restored = restoreDuelWithLuaScripts(serializeDuel(session), restore.sourceScripts, createCardReader(restore.cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored);
    expect(restored.session.state.pendingTriggers).toHaveLength(2);
    for (const trigger of restored.session.state.pendingTriggers) expect(trigger.eventUids).toEqual([first!.uid, second!.uid]);
    expect(restored.session.state.pendingTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: graveWatcher!.uid, eventName: "sentToGraveyard", eventCardUid: first!.uid }),
        expect.objectContaining({ sourceUid: detachWatcher!.uid, eventName: "detachedMaterial", eventCardUid: first!.uid }),
      ]),
    );
    activateAllRestoredTriggers(restored);
    expect(restored.host.messages).toEqual(expect.arrayContaining(["detach group 2", "grave group 2"]));
  }

  activateAllTriggers(session);
  expect(host.messages).toEqual(expect.arrayContaining(["detach group 2", "grave group 2"]));
}

function activateAllTriggers(session: DuelSession): void {
  for (;;) {
    const player = session.state.waitingFor ?? 0;
    const trigger = getDuelLegalActions(session, player).find((candidate) => candidate.type === "activateTrigger");
    if (!trigger) break;
    applyAndAssert(session, trigger);
  }
}

function activateAllRestoredTriggers(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  for (;;) {
    const player = restored.session.state.waitingFor ?? 0;
    const trigger = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "activateTrigger");
    if (!trigger) break;
    applyLuaRestoreAndAssert(restored, trigger);
  }
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyAndAssert(session: DuelSession, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: Parameters<typeof applyLuaRestoreResponse>[1]) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, response.state.waitingFor!));
  expect(queryPublicState(restored.session)).toEqual(response.state);
  return response;
}
