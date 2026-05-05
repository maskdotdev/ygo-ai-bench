import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, flipSummonDuelCard, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua Flip Summon restore helpers", () => {
  it("applies restored Lua EVENT_FLIP alias triggers through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Flip Alias Source", kind: "monster" },
      { code: "300", name: "Restore Flip Alias Watcher", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name !== "c300.lua") return undefined;
        return `
        c300={}
        function c300.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_TRIGGER_O)
          e:SetCode(EVENT_FLIP)
          e:SetRange(LOCATION_HAND)
          e:SetOperation(function(e,tp,eg)
            local tc=eg:GetFirst()
            Debug.Message("restored flip alias " .. tc:GetCode() .. "/" .. tostring(tc:IsFlipSummoned()))
          end)
          c:RegisterEffect(e)
        end
        `;
      },
    };
    const session = createDuel({ seed: 66, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "300"] }, 1: { main: [] } });
    startDuel(session);

    const monster = session.state.cards.find((card) => card.code === "100");
    expect(monster).toBeDefined();
    moveDuelCard(session.state, monster!.uid, "monsterZone", 0).position = "faceDownDefense";
    monster!.faceUp = false;

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    flipSummonDuelCard(session.state, 0, monster!.uid);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["flipSummoned"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1101, eventCardUid: monster!.uid });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["flipSummoned"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1101, eventCardUid: monster!.uid });

    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    const triggerResult = applyLuaRestoreResponse(restored, trigger!);
    expect(triggerResult.ok).toBe(true);
    expect(triggerResult.legalActions).toEqual(getDuelLegalActions(restored.session, triggerResult.state.waitingFor!));
    expect(triggerResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, triggerResult.state.waitingFor!));
    expect(restored.host.messages).toContain("restored flip alias 100/true");

    const originalTrigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(originalTrigger).toBeDefined();
    expect(applyResponse(session, originalTrigger!).ok).toBe(true);
    expect(host.messages).toContain("restored flip alias 100/true");
  });

  it("applies restored Lua flip-summon success triggers through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Flip Source", kind: "monster" },
      { code: "300", name: "Restore Flip Watcher", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name !== "c300.lua") return undefined;
        return `
        c300={}
        function c300.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_TRIGGER_O)
          e:SetCode(EVENT_FLIP_SUMMON_SUCCESS)
          e:SetRange(LOCATION_HAND)
          e:SetOperation(function(e,tp,eg)
            local tc=eg:GetFirst()
            Debug.Message("restored flip summon success " .. tc:GetCode() .. "/" .. tostring(tc:IsFlipSummoned()) .. "/" .. tc:GetSummonType())
          end)
          c:RegisterEffect(e)
        end
        `;
      },
    };
    const session = createDuel({ seed: 65, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "300"] }, 1: { main: [] } });
    startDuel(session);

    const monster = session.state.cards.find((card) => card.code === "100");
    expect(monster).toBeDefined();
    moveDuelCard(session.state, monster!.uid, "monsterZone", 0).position = "faceDownDefense";
    monster!.faceUp = false;

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    flipSummonDuelCard(session.state, 0, monster!.uid);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["flipSummoned"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1101, eventCardUid: monster!.uid });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["flipSummoned"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1101, eventCardUid: monster!.uid });

    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    const triggerResult = applyLuaRestoreResponse(restored, trigger!);
    expect(triggerResult.ok).toBe(true);
    expect(triggerResult.legalActions).toEqual(getDuelLegalActions(restored.session, triggerResult.state.waitingFor!));
    expect(triggerResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, triggerResult.state.waitingFor!));
    expect(restored.host.messages).toContain("restored flip summon success 100/true/536870912");

    const originalTrigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(originalTrigger).toBeDefined();
    expect(applyResponse(session, originalTrigger!).ok).toBe(true);
    expect(host.messages).toContain("restored flip summon success 100/true/536870912");
  });
});
