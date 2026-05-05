import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData } from "#duel/types.js";

const cards: DuelCardData[] = [{ code: "100", name: "Restore Toss Negate Watcher", kind: "monster" }];

describe("Lua random negate restore helpers", () => {
  it("applies restored Lua coin-toss-negate triggers through restore responses", () => {
    const result = runTossNegateRestore("EVENT_TOSS_COIN_NEGATE", 1152, "coinTossNegated", "restored coin negate");
    expect(result.messages).toContain("restored coin negate 100");
  });

  it("applies restored Lua dice-toss-negate triggers through restore responses", () => {
    const result = runTossNegateRestore("EVENT_TOSS_DICE_NEGATE", 1153, "diceTossNegated", "restored dice negate");
    expect(result.messages).toContain("restored dice negate 100");
  });
});

function runTossNegateRestore(eventCode: string, numericCode: number, eventName: "coinTossNegated" | "diceTossNegated", message: string): { messages: string[] } {
  const source = {
    readScript(name: string) {
      if (name !== "c100.lua") return undefined;
      return `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(${eventCode})
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg)
          Debug.Message("${message} " .. eg:GetFirst():GetCode())
        end)
        c:RegisterEffect(e)
      end
      `;
    },
  };
  const session = createDuel({ seed: numericCode, startingHandSize: 1, cardReader: createCardReader(cards) });
  loadDecks(session, { 0: { main: ["100"] }, 1: { main: [] } });
  startDuel(session);

  const host = createLuaScriptHost(session);
  expect(host.loadCardScript(100, source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  const raise = host.loadScript(
    `
    local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
    Duel.RaiseEvent(watcher, ${eventCode}, nil, REASON_EFFECT, 0, 0, 0)
    `,
    `restore-toss-negate-${numericCode}.lua`,
  );
  expect(raise.ok, raise.error).toBe(true);
  const watcher = session.state.cards.find((card) => card.code === "100");
  expect(watcher).toBeDefined();
  expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual([eventName]);
  expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: numericCode, eventCardUid: watcher!.uid });

  const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
  expect(restored.restoreComplete).toBe(true);
  expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual([eventName]);
  expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: numericCode, eventCardUid: watcher!.uid });

  const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
  expect(trigger).toBeDefined();
  const triggerResult = applyLuaRestoreResponse(restored, trigger!);
  expect(triggerResult.ok).toBe(true);
  expect(triggerResult.legalActions).toEqual(getDuelLegalActions(restored.session, triggerResult.state.waitingFor!));
  expect(triggerResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, triggerResult.state.waitingFor!));

  const originalTrigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
  expect(originalTrigger).toBeDefined();
  expect(applyResponse(session, originalTrigger!).ok).toBe(true);
  expect(host.messages).toContain(`${message} 100`);
  return { messages: restored.host.messages };
}
