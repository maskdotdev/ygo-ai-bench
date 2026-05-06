import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua random restore helpers", () => {
  it("restores dice missed timing after later event boundaries", () => {
    runRandomBoundaryRestore({
      boundaryCode: "EVENT_TOSS_DICE",
      boundaryEventCode: 1150,
      boundaryEventName: "diceTossed",
      boundaryOperation: "Duel.TossDice(0, 1)",
      delayedMessage: "if dice resolved",
      seed: 172,
      staleEffectId: "lua-2-1150",
      survivingEffectId: "lua-3-1150",
      whenMessage: "when dice resolved",
    });
  });

  it("restores coin missed timing after later event boundaries", () => {
    runRandomBoundaryRestore({
      boundaryCode: "EVENT_TOSS_COIN",
      boundaryEventCode: 1151,
      boundaryEventName: "coinTossed",
      boundaryOperation: "Duel.TossCoin(0, 1)",
      delayedMessage: "if coin resolved",
      seed: 173,
      staleEffectId: "lua-2-1151",
      survivingEffectId: "lua-3-1151",
      whenMessage: "when coin resolved",
    });
  });
});

function runRandomBoundaryRestore(options: {
  boundaryCode: string;
  boundaryEventCode: number;
  boundaryEventName: string;
  boundaryOperation: string;
  delayedMessage: string;
  seed: number;
  staleEffectId: string;
  survivingEffectId: string;
  whenMessage: string;
}): void {
  const randomCards: DuelCardData[] = [
    { code: "100", name: "Restore Random Boundary Source", kind: "monster" },
    { code: "300", name: "Restore When Random Watcher", kind: "monster" },
    { code: "400", name: "Restore If Random Watcher", kind: "monster" },
    { code: "500", name: "Restore Damage Boundary Watcher", kind: "monster" },
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
            ${options.boundaryOperation}
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
          e:SetCode(${options.boundaryCode})
          e:SetRange(LOCATION_HAND)
          e:SetOperation(function(e,tp) Debug.Message("${options.whenMessage}") end)
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
          e:SetCode(${options.boundaryCode})
          e:SetProperty(EFFECT_FLAG_DELAY)
          e:SetRange(LOCATION_HAND)
          e:SetOperation(function(e,tp) Debug.Message("${options.delayedMessage}") end)
          c:RegisterEffect(e)
        end
        `;
      }
      if (name === "c500.lua") {
        return `
        c500={}
        function c500.initial_effect(c)
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
  const session = createDuel({ seed: options.seed, startingHandSize: 4, cardReader: createCardReader(randomCards) });
  loadDecks(session, { 0: { main: ["100", "300", "400", "500"] }, 1: { main: [] } });
  startDuel(session);

  const host = createLuaScriptHost(session);
  for (const code of [100, 300, 400, 500]) {
    const loaded = host.loadCardScript(code, source);
    expect(loaded.ok, loaded.error).toBe(true);
  }
  expect(host.registerInitialEffects()).toBe(4);

  const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
  expect(action).toBeDefined();
  applyAndAssert(session, action!);

  const pendingEffectIds = session.state.pendingTriggers.map((trigger) => trigger.effectId);
  expect(pendingEffectIds).not.toContain(options.staleEffectId);
  expect(pendingEffectIds).toEqual(expect.arrayContaining([options.survivingEffectId, "lua-4-1111"]));
  expect(session.state.eventHistory).toEqual(
    expect.arrayContaining([expect.objectContaining({ eventName: options.boundaryEventName, eventCode: options.boundaryEventCode }), expect.objectContaining({ eventName: "damageDealt", eventCode: 1111 })]),
  );

  const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(randomCards));
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  const restoredPendingEffectIds = restored.session.state.pendingTriggers.map((trigger) => trigger.effectId);
  expect(restoredPendingEffectIds).not.toContain(options.staleEffectId);
  expect(restoredPendingEffectIds).toEqual(expect.arrayContaining([options.survivingEffectId, "lua-4-1111"]));
  expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
  expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
  expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
  const restoredLegalEffectIds = getLuaRestoreTriggerEffectIds(restored, 0);
  expect(restoredLegalEffectIds).not.toContain(options.staleEffectId);
  expect(restoredLegalEffectIds).toEqual(expect.arrayContaining([options.survivingEffectId, "lua-4-1111"]));
}

function getLuaRestoreTriggerEffectIds(restored: Parameters<typeof getLuaRestoreLegalActions>[0], player: 0 | 1): string[] {
  return getLuaRestoreLegalActions(restored, player).flatMap((action) => (action.type === "activateTrigger" ? [action.effectId] : []));
}

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
