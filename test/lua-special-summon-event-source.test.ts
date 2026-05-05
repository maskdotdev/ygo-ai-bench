import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua special summon event sources", () => {
  it("preserves active Lua effect sources on restored special summon events", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summon Source Starter", kind: "monster" },
      { code: "200", name: "Summon Source Target", kind: "monster" },
      { code: "300", name: "Summon Source Watcher", kind: "monster" },
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
              local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
              Duel.SpecialSummon(target, 0, tp, tp, false, false, POS_FACEUP_ATTACK)
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
            e:SetCode(EVENT_SPSUMMON_SUCCESS)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
              Debug.Message("restored special summon trigger " .. eg:GetFirst():GetCode() .. "/" .. r .. "/" .. rp)
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 149, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);

    const starter = session.state.cards.find((card) => card.code === "100");
    const summoned = session.state.cards.find((card) => card.code === "200");
    expect(starter).toBeDefined();
    expect(summoned).toMatchObject({ location: "monsterZone", controller: 0, faceUp: true });
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["specialSummoned"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({
      eventCode: 1102,
      eventCardUid: summoned!.uid,
      eventReason: 0x810,
      eventReasonPlayer: 0,
      eventReasonCardUid: starter!.uid,
      eventReasonEffectId: 1,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({
      eventCode: 1102,
      eventCardUid: summoned!.uid,
      eventReasonCardUid: starter!.uid,
      eventReasonEffectId: 1,
    });
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    const result = applyLuaRestoreResponse(restored, trigger!);
    expect(result.ok, result.error).toBe(true);
    expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, result.state.waitingFor!));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, result.state.waitingFor!));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expect(restored.host.messages).toContain("restored special summon trigger 200/2064/0");
  });
});
