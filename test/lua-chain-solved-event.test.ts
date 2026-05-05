import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua chain-solved events", () => {
  it("queues Lua chain-solved triggers after a chain link resolves", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Chain Starter", kind: "monster" },
      { code: "200", name: "Chain Solved Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 182, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

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
          Debug.Message("chain starter resolved")
        end)
        c:RegisterEffect(e)
      end
      `;
        }
        if (name === "c200.lua") {
          return `

      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_CHAIN_SOLVED)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("chain solved resolved " .. tp .. "/" .. ep .. "/" .. ev .. "/" .. rp)
        end)
        c:RegisterEffect(e)
      end
      `;
        }
        return undefined;
      },
    };
    const host = createLuaScriptHost(session);
    const starterScript = host.loadCardScript(100, source);
    const watcherScript = host.loadCardScript(200, source);
    expect(starterScript.ok, starterScript.error).toBe(true);
    expect(watcherScript.ok, watcherScript.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);
    expect(host.messages).toContain("chain starter resolved");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["chainSolved"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1022, eventPlayer: 0, eventValue: 1, eventReasonPlayer: 0 });
    expect(session.state.eventHistory.at(-1)).toMatchObject({ eventName: "chainSolved", eventCode: 1022, eventPlayer: 0, eventValue: 1, eventReasonPlayer: 0 });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.loadedScripts).toEqual([{ ok: true, name: "c100.lua" }, { ok: true, name: "c200.lua" }]);
    expect(restored.session.state.pendingTriggers).toEqual(session.state.pendingTriggers);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    const result = applyLuaRestoreResponse(restored, trigger!);
    expect(result.ok).toBe(true);
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, result.state.waitingFor!));
    expect(restored.host.messages).toContain("chain solved resolved 0/0/1/0");
  });
});
