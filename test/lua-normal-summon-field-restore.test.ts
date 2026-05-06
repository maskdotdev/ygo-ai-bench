import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua normal summon field restore helpers", () => {
  it("restores SSet missed timing after later event boundaries", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore SSet Later Source", kind: "monster" },
      { code: "300", name: "Restore When SSet Watcher", kind: "monster" },
      { code: "400", name: "Restore If SSet Watcher", kind: "monster" },
      { code: "500", name: "Restore SSet Later Spell", kind: "spell", typeFlags: 0x2 },
      { code: "600", name: "Restore SSet Damage Watcher", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
          c100={}
          function c100.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_IGNITION)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp)
              local spell=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil)
              Duel.SSet(spell)
              Duel.Damage(1, 100, REASON_EFFECT)
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c300.lua") {
          return `
          c300={}
          function c300.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_TRIGGER_O)
            e:SetCode(EVENT_SSET)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("when sset resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c400.lua") {
          return `
          c400={}
          function c400.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_TRIGGER_O)
            e:SetCode(EVENT_SSET)
            e:SetProperty(EFFECT_FLAG_DELAY)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("if sset resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c600.lua") {
          return `
          c600={}
          function c600.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_TRIGGER_O)
            e:SetCode(EVENT_DAMAGE)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("damage boundary resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 162, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "300", "400", "500", "600"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    for (const code of [100, 300, 400, 600]) {
      const loaded = host.loadCardScript(code, source);
      expect(loaded.ok, loaded.error).toBe(true);
    }
    expect(host.registerInitialEffects()).toBe(4);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    const pendingEffectIds = session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(pendingEffectIds).not.toContain("lua-2-1107");
    expect(pendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1107", "lua-4-1111"]));
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "spellTrapSet", eventCode: 1107 }), expect.objectContaining({ eventName: "damageDealt", eventCode: 1111 })]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredPendingEffectIds = restored.session.state.pendingTriggers.map((trigger) => trigger.effectId);
    expect(restoredPendingEffectIds).not.toContain("lua-2-1107");
    expect(restoredPendingEffectIds).toEqual(expect.arrayContaining(["lua-3-1107", "lua-4-1111"]));
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual([]);
    const restoredLegalEffectIds = getLuaRestoreTriggerEffectIds(restored, 0);
    expect(restoredLegalEffectIds).not.toContain("lua-2-1107");
    expect(restoredLegalEffectIds).toEqual(expect.arrayContaining(["lua-3-1107", "lua-4-1111"]));
    expect(hasGroupedTrigger(restored, 0, "lua-3-1107")).toBe(true);
    expect(hasGroupedTrigger(restored, 0, "lua-4-1111")).toBe(true);
    expect(hasGroupedTrigger(restored, 0, "lua-2-1107")).toBe(false);
  });
});

function getLuaRestoreTriggerEffectIds(restored: Parameters<typeof getLuaRestoreLegalActions>[0], player: 0 | 1): string[] {
  return getLuaRestoreLegalActions(restored, player).flatMap((action) => (action.type === "activateTrigger" ? [action.effectId] : []));
}

function hasGroupedTrigger(restored: Parameters<typeof getLuaRestoreLegalActions>[0], player: 0 | 1, effectId: string): boolean {
  return getLuaRestoreLegalActionGroups(restored, player).some((group) => group.actions.some((action) => action.type === "activateTrigger" && action.effectId === effectId));
}

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
