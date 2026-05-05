import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua summon material restore helpers", () => {
  it("applies restored Lua material triggers through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Material Trigger", kind: "monster" },
      { code: "300", name: "Restore Fusion Starter", kind: "monster" },
      { code: "400", name: "Restore Fusion Material", kind: "monster" },
      { code: "900", name: "Restore Material Fusion", kind: "extra", fusionMaterials: ["100", "400"] },
    ];
    const source = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
          c100={}
          function c100.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_TRIGGER_O)
            e:SetCode(EVENT_BE_MATERIAL)
            e:SetRange(LOCATION_GRAVE)
            e:SetOperation(function(e,tp)
              Debug.Message("restored material trigger " .. e:GetHandler():GetCode())
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
            e:SetType(EFFECT_TYPE_IGNITION)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp)
              local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_EXTRA, 0, 1, 1, nil):GetFirst()
              local materials=Duel.SelectMatchingCard(0, function(tc) return tc:IsCode(100) or tc:IsCode(400) end, 0, LOCATION_HAND, 0, 2, 2, target)
              Duel.FusionSummon(target, materials)
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 59, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "300", "400"], extra: ["900"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("300"));
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);
    const material = session.state.cards.find((card) => card.code === "100");
    expect(material).toMatchObject({ location: "graveyard" });
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toContain("usedAsMaterial");
    expect(session.state.pendingTriggers).toContainEqual(expect.objectContaining({ eventName: "usedAsMaterial", eventCode: 1108, eventCardUid: material!.uid }));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toContain("usedAsMaterial");
    expect(restored.session.state.pendingTriggers).toContainEqual(expect.objectContaining({ eventName: "usedAsMaterial", eventCode: 1108, eventCardUid: material!.uid }));
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));

    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    const triggerResult = applyLuaRestoreResponse(restored, trigger!);
    expect(triggerResult.ok).toBe(true);
    expect(triggerResult.legalActions).toEqual(getLegalActions(restored.session, triggerResult.state.waitingFor!));
    expect(triggerResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, triggerResult.state.waitingFor!));
    expect(restored.host.messages).toContain("restored material trigger 100");
  });
});
