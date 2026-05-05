import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua overlay restore helpers", () => {
  it("applies restored Lua detach-material triggers through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Detach Material", kind: "monster" },
      { code: "300", name: "Restore Detach Watcher", kind: "monster" },
      { code: "920", name: "Restore Detach Xyz", kind: "extra", xyzMaterials: ["100", "300"] },
    ];
    const source = {
      readScript(name: string) {
        if (name === "c920.lua") {
          return `
          c920={}
          function c920.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_IGNITION)
            e:SetRange(LOCATION_MZONE)
            e:SetOperation(function(e,tp)
              e:GetHandler():RemoveOverlayCard(tp,1,1,REASON_COST)
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
            e:SetCode(EVENT_DETACH_MATERIAL)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp,eg)
              Debug.Message("restored detach trigger " .. eg:GetFirst():GetCode())
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 175, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "300"], extra: ["920"] }, 1: { main: [] } });
    startDuel(session);

    const material = session.state.cards.find((card) => card.code === "100");
    const xyz = session.state.cards.find((card) => card.code === "920");
    expect(material).toBeDefined();
    expect(xyz).toBeDefined();
    moveDuelCard(session.state, xyz!.uid, "monsterZone", 0);
    moveDuelCard(session.state, material!.uid, "overlay", 0);
    xyz!.overlayUids.push(material!.uid);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(920, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === xyz!.uid);
    expect(action).toBeDefined();
    const response = applyResponse(session, action!);
    expect(response.ok).toBe(true);
    expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
    expect(session.state.cards.find((card) => card.uid === material!.uid)).toMatchObject({ location: "graveyard" });
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["detachedMaterial"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1202, eventCardUid: material!.uid });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["detachedMaterial"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1202, eventCardUid: material!.uid });
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    const triggerResult = applyLuaRestoreResponse(restored, trigger!);
    expect(triggerResult.ok).toBe(true);
    expect(triggerResult.legalActions).toEqual(getDuelLegalActions(restored.session, triggerResult.state.waitingFor!));
    expect(triggerResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, triggerResult.state.waitingFor!));
    expect(triggerResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(triggerResult.legalActions);
    expect(restored.host.messages).toContain("restored detach trigger 100");
  });
});
