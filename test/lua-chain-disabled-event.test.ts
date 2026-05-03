import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActions, type LuaSnapshotRestoreResult, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua chain-disabled events", () => {
  it("queues Lua chain-disabled triggers after a disabled chain link is skipped", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Disabled Source", kind: "monster" },
      { code: "200", name: "Disabler", kind: "monster" },
      { code: "300", name: "Disable Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 184, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["200"] },
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
          Debug.Message("disabled source resolved")
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
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,tp)
          return Duel.GetCurrentChain()>0 and Duel.IsChainDisablable(1)
        end)
        e:SetOperation(function(e,tp)
          Debug.Message("disable result " .. tostring(Duel.NegateEffect(1)))
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
        e:SetCode(EVENT_CHAIN_DISABLED)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("chain disabled resolved " .. tp .. "/" .. ep .. "/" .. ev .. "/" .. rp)
        end)
        c:RegisterEffect(e)
      end
      `;
        }
        return undefined;
      },
    };
    const host = createLuaScriptHost(session);
    const sourceScript = host.loadCardScript(100, source);
    const disablerScript = host.loadCardScript(200, source);
    const watcherScript = host.loadCardScript(300, source);
    expect(sourceScript.ok, sourceScript.error).toBe(true);
    expect(disablerScript.ok, disablerScript.error).toBe(true);
    expect(watcherScript.ok, watcherScript.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const sourceAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(sourceAction).toBeDefined();
    expect(applyResponse(session, sourceAction!).ok).toBe(true);
    const disablerAction = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateEffect");
    expect(disablerAction).toBeDefined();
    expect(applyResponse(session, disablerAction!).ok).toBe(true);
    drainChain(session);

    expect(host.messages).toContain("disable result true");
    expect(host.messages).not.toContain("disabled source resolved");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["chainDisabled"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1025, eventPlayer: 0, eventValue: 1, eventReasonPlayer: 0 });
    expect(session.state.eventHistory).toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "chainDisabled", eventCode: 1025, eventPlayer: 0, eventValue: 1, eventReasonPlayer: 0 })]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.loadedScripts.map((script) => script.name).sort()).toEqual(["c100.lua", "c200.lua", "c300.lua"]);
    expect(restored.loadedScripts.every((script) => script.ok)).toBe(true);
    expect(restored.session.state.pendingTriggers).toEqual(session.state.pendingTriggers);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expect(applyLuaRestoreResponse(restored, trigger!).ok).toBe(true);
    drainRestoredChain(restored);
    expect(restored.host.messages).toContain("chain disabled resolved 0/0/1/0");
  });
});

function drainChain(session: ReturnType<typeof createDuel>): void {
  while (session.state.chain.length > 0) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const pass = getDuelLegalActions(session, player).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    expect(applyResponse(session, pass!).ok).toBe(true);
  }
}

function drainRestoredChain(restored: LuaSnapshotRestoreResult): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    expect(applyLuaRestoreResponse(restored, pass!).ok).toBe(true);
  }
}
