import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";

describe("Lua source-only pre-material events", () => {
  it("binds EVENT_BE_PRE_MATERIAL single triggers only to the material source card", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Source-Only Pre-Material Fusion Material", kind: "monster" },
      { code: "300", name: "Pre-Material Generic Watcher", kind: "monster" },
      { code: "301", name: "Unused Pre-Material Single Watcher", kind: "monster" },
      { code: "900", name: "Source-Only Pre-Material Fusion", kind: "extra", fusionMaterials: ["100"] },
    ];
    const session = createDuel({ seed: 122, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "300", "301"], extra: ["900"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const sourceScripts = {
      readScript(name: string) {
        if (name === "c100.lua") return `
      c100={}
      function c100.initial_effect(c)
      local source_trigger=Effect.CreateEffect(c)
      source_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      source_trigger:SetCode(EVENT_BE_PRE_MATERIAL)
      source_trigger:SetRange(LOCATION_HAND)
      source_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("source pre material single " .. eg:GetCount() .. "/" .. eg:GetFirst():GetCode())
      end)
      c:RegisterEffect(source_trigger)
      end
      `;
        if (name === "c300.lua") return `
      c300={}
      function c300.initial_effect(c)
      local generic_trigger=Effect.CreateEffect(c)
      generic_trigger:SetType(EFFECT_TYPE_TRIGGER_O)
      generic_trigger:SetCode(EVENT_BE_PRE_MATERIAL)
      generic_trigger:SetRange(LOCATION_HAND)
      generic_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("generic pre material " .. eg:GetCount() .. "/" .. eg:GetFirst():GetCode())
      end)
      c:RegisterEffect(generic_trigger)
      end
      `;
        if (name === "c301.lua") return `
      c301={}
      function c301.initial_effect(c)
      local wrong_single=Effect.CreateEffect(c)
      wrong_single:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      wrong_single:SetCode(EVENT_BE_PRE_MATERIAL)
      wrong_single:SetRange(LOCATION_HAND)
      wrong_single:SetOperation(function(e,tp,eg)
        Debug.Message("wrong pre material single " .. eg:GetCount())
      end)
      c:RegisterEffect(wrong_single)
      end
      `;
        return undefined;
      },
    };
    for (const code of [100, 300, 301]) {
      const loaded = host.loadCardScript(code, sourceScripts);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(3);

    const material = session.state.cards.find((card) => card.code === "100");
    const fusion = session.state.cards.find((card) => card.code === "900");
    const genericWatcher = session.state.cards.find((card) => card.code === "300");
    const singleWatcher = session.state.cards.find((card) => card.code === "301");
    expect(material).toBeDefined();
    expect(fusion).toBeDefined();

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "fusionSummon" && candidate.uid === fusion!.uid);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    expect(session.state.cards.find((card) => card.uid === material!.uid)).toMatchObject({ location: "graveyard" });
    const preMaterialTriggers = session.state.pendingTriggers.filter((trigger) => trigger.eventName === "preUsedAsMaterial");
    expect(preMaterialTriggers).toHaveLength(2);
    expect(preMaterialTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: material!.uid, eventCardUid: material!.uid, eventCode: 1109 }),
        expect.objectContaining({ sourceUid: genericWatcher!.uid, eventCardUid: material!.uid, eventCode: 1109 }),
      ]),
    );
    expect(preMaterialTriggers.some((trigger) => trigger.sourceUid === singleWatcher!.uid)).toBe(false);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), sourceScripts, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredPreMaterialTriggers = restored.session.state.pendingTriggers.filter((trigger) => trigger.eventName === "preUsedAsMaterial");
    expect(restoredPreMaterialTriggers).toHaveLength(2);
    expect(restoredPreMaterialTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: material!.uid, eventCardUid: material!.uid, eventCode: 1109 }),
        expect.objectContaining({ sourceUid: genericWatcher!.uid, eventCardUid: material!.uid, eventCode: 1109 }),
      ]),
    );
    expect(restoredPreMaterialTriggers.some((trigger) => trigger.sourceUid === singleWatcher!.uid)).toBe(false);
    activateAllRestoredTriggers(restored);
    expect(restored.host.messages).toEqual(expect.arrayContaining(["source pre material single 1/100", "generic pre material 1/100"]));
    expect(restored.host.messages).not.toContain("wrong pre material single 1");

    activateAllTriggers(session);
    expect(host.messages).toEqual(expect.arrayContaining(["source pre material single 1/100", "generic pre material 1/100"]));
    expect(host.messages).not.toContain("wrong pre material single 1");
  });
});

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
