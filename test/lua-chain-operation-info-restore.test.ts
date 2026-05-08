import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua chain operation info restore", () => {
  it("restores chain operation info for Lua response checks", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Chain Source", kind: "monster" },
      { code: "200", name: "Restore Chain Target", kind: "monster" },
      { code: "400", name: "Restore Chain Response", kind: "monster" },
    ];
    const source = operationInfoRestoreSource();
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 286, startingHandSize: 2, cardReader: reader });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: ["400"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(400, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const sourceAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(sourceAction).toBeDefined();
    const sourceResult = applyResponse(session, sourceAction!);
    expect(sourceResult.ok, sourceResult.error).toBe(true);

    const targetUid = session.state.cards.find((card) => card.code === "200")?.uid;
    expect(targetUid).toBeDefined();
    const snapshot = serializeDuel(session);
    expect(snapshot.state.chain[0]?.chainIndex).toBe(1);
    expect(snapshot.state.chain[0]?.operationInfos).toEqual([{ category: 0x8, targetUids: [targetUid], count: 1, player: 0, parameter: 0 }]);

    const restored = restoreDuelWithLuaScripts(snapshot, source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredAction = getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2");
    expect(restoredAction).toBeDefined();
    expect(restored.host.messages).toContain("restore chain operation info true/200/1/0/0");
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
  });

  it("does not leak prior chain operation info into later chains", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "First Chain Source", kind: "monster" },
      { code: "200", name: "First Chain Target", kind: "monster" },
      { code: "300", name: "Second Chain Source", kind: "monster" },
      { code: "400", name: "Second Chain Response", kind: "monster" },
    ];
    const source = operationInfoNoLeakSource();
    const session = createDuel({ seed: 287, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300"] }, 1: { main: ["400"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    for (const code of [100, 300, 400]) expect(host.loadCardScript(code, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    applyAndAssert(session, getRequiredLuaActionForCode(session, 0, "100"));
    expect(session.state.chain).toHaveLength(0);

    applyAndAssert(session, getRequiredLuaActionForCode(session, 0, "300"));
    const response = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateEffect" && cardCodeForUid(session, candidate.uid) === "400");
    expect(response).toBeDefined();
    expect(host.messages).toContain("later chain operation info false");
  });
});

function operationInfoRestoreSource() {
  return {
    readScript(name: string) {
      if (name === "c100.lua") return sourceScript();
      if (name === "c400.lua") return responseScript();
      return undefined;
    },
  };
}

function sourceScript(): string {
  return `
    c100={}
    function c100.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return true end
        local g=Duel.SelectTarget(tp, aux.FilterBoolFunction(Card.IsCode, 200), tp, LOCATION_HAND, 0, 1, 1, e:GetHandler())
        Duel.SetOperationInfo(0, CATEGORY_TOHAND, g, g:GetCount(), tp, 0)
        return true
      end)
      e:SetOperation(function(e,tp) Debug.Message("restore operation source resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function responseScript(): string {
  return `
    c400={}
    function c400.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp)
        if Duel.GetCurrentChain()~=1 then return false end
        local ok,g,count,p,param=Duel.GetOperationInfo(1, CATEGORY_TOHAND)
        Debug.Message("restore chain operation info " .. tostring(ok) .. "/" .. g:GetFirst():GetCode() .. "/" .. count .. "/" .. p .. "/" .. param)
        return ok and g:GetFirst():IsCode(200) and count==1 and p==0
      end)
      e:SetOperation(function(e,tp) Debug.Message("restore operation response resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function operationInfoNoLeakSource() {
  return {
    readScript(name: string) {
      if (name === "c100.lua") return sourceScript();
      if (name === "c300.lua") return noInfoSourceScript();
      if (name === "c400.lua") return noLeakResponseScript();
      return undefined;
    },
  };
}

function noInfoSourceScript(): string {
  return `
    c300={}
    function c300.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("no-info source resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function noLeakResponseScript(): string {
  return `
    c400={}
    function c400.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp)
        if Duel.GetCurrentChain()~=1 then return false end
        local ok=Duel.GetOperationInfo(1, CATEGORY_TOHAND)
        Debug.Message("later chain operation info " .. tostring(ok))
        return not ok
      end)
      e:SetOperation(function(e,tp) Debug.Message("no-leak response resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function getRequiredLuaActionForCode(session: Parameters<typeof getDuelLegalActions>[0], player: 0 | 1, code: string) {
  const action = getDuelLegalActions(session, player).find((candidate) => candidate.type === "activateEffect" && cardCodeForUid(session, candidate.uid) === code);
  expect(action).toBeDefined();
  return action!;
}

function applyAndAssert(session: Parameters<typeof applyResponse>[0], response: Parameters<typeof applyResponse>[1]): void {
  const result = applyResponse(session, response);
  expect(result.ok, result.error).toBe(true);
}

function cardCodeForUid(session: Parameters<typeof getDuelLegalActions>[0], uid: string): string | undefined {
  return session.state.cards.find((card) => card.uid === uid)?.code;
}
