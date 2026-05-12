import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
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
            e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
              Debug.Message("restored detach trigger " .. eg:GetFirst():GetCode())
              Debug.Message("restored detach reason effect " .. tostring(Duel.GetReasonEffect():GetHandler():IsCode(920)))
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
    const xyzScript = host.loadCardScript(920, source);
    const watcherScript = host.loadCardScript(300, source);
    expect(xyzScript.ok, xyzScript.error).toBe(true);
    expect(watcherScript.ok, watcherScript.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === xyz!.uid);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);
    expect(session.state.cards.find((card) => card.uid === material!.uid)).toMatchObject({ location: "graveyard" });
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["detachedMaterial"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1202, eventCardUid: material!.uid, eventReason: 0x80, eventReasonPlayer: 0, eventReasonCardUid: xyz!.uid, eventReasonEffectId: 2 });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["detachedMaterial"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1202, eventCardUid: material!.uid, eventReason: 0x80, eventReasonPlayer: 0, eventReasonCardUid: xyz!.uid, eventReasonEffectId: 2 });
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual([]);

    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expect(getLuaRestoreLegalActionGroups(restored, 0).some((group) => group.actions.some((action) => action.type === "activateTrigger" && action.effectId === trigger!.effectId))).toBe(true);
    const staleTrigger = applyLuaRestoreResponse(restored, { ...trigger!, windowId: trigger!.windowId! - 1 });
    expect(staleTrigger.ok).toBe(false);
    expect(staleTrigger.error).toContain("Response is not currently legal");
    expect(staleTrigger.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleTrigger.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(staleTrigger.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    assertLuaRestoreLegalWindow(restored, staleTrigger, 0);
    expect(restored.session.state.pendingTriggers.map((pending) => pending.eventName)).toEqual(["detachedMaterial"]);
    expect(restored.host.messages).not.toContain("restored detach trigger 100");

    applyLuaRestoreAndAssert(restored, trigger!);
    expect(restored.host.messages).toContain("restored detach trigger 100");
    expect(restored.host.messages).toContain("restored detach reason effect true");
    const staleReplay = applyLuaRestoreResponse(restored, trigger!);
    expect(staleReplay.ok).toBe(false);
    expect(staleReplay.error).toContain("Response is not currently legal");
    expect(staleReplay.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleReplay.legalActions).toEqual(getDuelLegalActions(restored.session, staleReplay.state.waitingFor!));
    expect(staleReplay.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, staleReplay.state.waitingFor!));
    assertLuaRestoreLegalWindow(restored, staleReplay, staleReplay.state.waitingFor!);
  });
});

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
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
  assertLuaRestoreLegalWindow(restored, response, response.state.waitingFor!);
  return response;
}

function assertLuaRestoreLegalWindow(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: ReturnType<typeof applyLuaRestoreResponse>, player: 0 | 1): void {
  const windowId = restored.session.state.actionWindowId;
  const publicState = queryPublicState(restored.session);
  expect(response.state.actionWindowId).toBe(windowId);
  expect(response.state.pendingTriggerBuckets).toEqual(publicState.pendingTriggerBuckets);
  if ("triggerOrderPrompt" in publicState) expect(response.state.triggerOrderPrompt).toEqual(publicState.triggerOrderPrompt);
  else expect(response.state).not.toHaveProperty("triggerOrderPrompt");
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, player));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  for (const legalAction of response.legalActions) expect(legalAction).toMatchObject({ windowId, windowKind: response.state.windowKind });
  for (const group of response.legalActionGroups) expect(group).toMatchObject({ windowId, windowKind: response.state.windowKind });
}
