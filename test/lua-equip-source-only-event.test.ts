import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";

describe("Lua source-only equip events", () => {
  it("binds EVENT_EQUIP single triggers only to the equipped source card", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Equip Source-Only Target", kind: "monster" },
      { code: "500", name: "Equip Source-Only Spell", kind: "spell", typeFlags: 0x40002 },
      { code: "700", name: "Equip Generic Watcher", kind: "monster" },
      { code: "701", name: "Unequipped Single Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 118, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "500", "700", "701"] }, 1: { main: [] } });
    startDuel(session);

    const target = session.state.cards.find((card) => card.code === "100");
    expect(target).toBeDefined();
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const source = {
      readScript(name: string) {
        if (name === "c500.lua") return `
      c500={}
      function c500.initial_effect(c)
      local source_trigger=Effect.CreateEffect(c)
      source_trigger:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      source_trigger:SetCode(EVENT_EQUIP)
      source_trigger:SetRange(LOCATION_SZONE)
      source_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("source equip single " .. eg:GetCount() .. "/" .. eg:GetFirst():GetCode())
      end)
      c:RegisterEffect(source_trigger)
      end
      `;
        if (name === "c700.lua") return `
      c700={}
      function c700.initial_effect(c)
      local generic_trigger=Effect.CreateEffect(c)
      generic_trigger:SetType(EFFECT_TYPE_TRIGGER_O)
      generic_trigger:SetCode(EVENT_EQUIP)
      generic_trigger:SetRange(LOCATION_HAND)
      generic_trigger:SetOperation(function(e,tp,eg)
        Debug.Message("generic equip " .. eg:GetCount() .. "/" .. eg:GetFirst():GetCode())
      end)
      c:RegisterEffect(generic_trigger)
      end
      `;
        if (name === "c701.lua") return `
      c701={}
      function c701.initial_effect(c)
      local wrong_single=Effect.CreateEffect(c)
      wrong_single:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
      wrong_single:SetCode(EVENT_EQUIP)
      wrong_single:SetRange(LOCATION_HAND)
      wrong_single:SetOperation(function(e,tp,eg)
        Debug.Message("wrong equip single " .. eg:GetCount())
      end)
      c:RegisterEffect(wrong_single)
      end
      `;
        return undefined;
      },
    };
    for (const code of [500, 700, 701]) {
      const loaded = host.loadCardScript(code, source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(3);
    const equipped = host.loadScript(
      `
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local equip=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("equip source-only " .. tostring(Duel.Equip(0, equip, target)))
      `,
      "equip-source-only-event.lua",
    );
    expect(equipped.ok, equipped.error).toBe(true);

    const equip = session.state.cards.find((card) => card.code === "500");
    const genericWatcher = session.state.cards.find((card) => card.code === "700");
    const singleWatcher = session.state.cards.find((card) => card.code === "701");
    expect(host.messages).toContain("equip source-only true");
    const equipTriggers = session.state.pendingTriggers.filter((trigger) => trigger.eventName === "equipped");
    expect(equipTriggers).toHaveLength(2);
    expect(equipTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: equip!.uid, eventCardUid: equip!.uid }),
        expect.objectContaining({ sourceUid: genericWatcher!.uid, eventCardUid: equip!.uid }),
      ]),
    );
    expect(equipTriggers.some((trigger) => trigger.sourceUid === singleWatcher!.uid)).toBe(false);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored);
    const restoredEquipTriggers = restored.session.state.pendingTriggers.filter((trigger) => trigger.eventName === "equipped");
    expect(restoredEquipTriggers).toHaveLength(2);
    expect(restoredEquipTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: equip!.uid, eventCardUid: equip!.uid }),
        expect.objectContaining({ sourceUid: genericWatcher!.uid, eventCardUid: equip!.uid }),
      ]),
    );
    expect(restoredEquipTriggers.some((trigger) => trigger.sourceUid === singleWatcher!.uid)).toBe(false);
    activateAllRestoredTriggers(restored);
    expect(restored.host.messages).toEqual(expect.arrayContaining(["source equip single 1/500", "generic equip 1/500"]));
    expect(restored.host.messages).not.toContain("wrong equip single 1");

    activateAllTriggers(session);
    expect(host.messages).toEqual(expect.arrayContaining(["source equip single 1/500", "generic equip 1/500"]));
    expect(host.messages).not.toContain("wrong equip single 1");
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
