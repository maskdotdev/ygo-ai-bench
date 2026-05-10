import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua operation info category masks", () => {
  it("matches combined operation categories by component across restore", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Masked Operation Source", kind: "monster" },
      { code: "200", name: "Masked Operation Target", kind: "monster" },
      { code: "400", name: "Masked Operation Response", kind: "monster" },
    ];
    const reader = createCardReader(cards);
    const source = maskedOperationInfoSource();
    const session = createDuel({ seed: 261, startingHandSize: 2, cardReader: reader });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: ["400"] } });
    startDuel(session);

    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(400, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const sourceCard = session.state.cards.find((card) => card.code === "100");
    const target = session.state.cards.find((card) => card.code === "200");
    expect(sourceCard).toBeDefined();
    expect(target).toBeDefined();

    const action = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === sourceCard!.uid);
    expect(action).toBeDefined();
    const response = applyResponse(session, action!);
    expect(response.ok, response.error).toBe(true);
    expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);

    const responseAction = getLegalActions(session, 1).find((candidate) => candidate.type === "activateEffect" && cardCodeForUid(session, candidate.uid) === "400");
    expect(responseAction).toBeDefined();
    expect(host.messages).toContain("masked operation info true/true/false/200/1/0/1");
    const snapshot = serializeDuel(session);
    expect(snapshot.state.chain[0]?.operationInfos).toEqual([{ category: 0x20008, targetUids: [target!.uid], count: 1, player: 0, parameter: 1 }]);

    const restored = restoreDuelWithLuaScripts(snapshot, source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredAction = getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "activateEffect" && cardCodeForUid(restored.session, candidate.uid) === "400");
    expect(restoredAction).toBeDefined();
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(restored.host.messages).toContain("masked operation info true/true/false/200/1/0/1");
  });
});

function maskedOperationInfoSource() {
  return {
    readScript(name: string) {
      if (name === "c100.lua") return maskedOperationInfoSourceScript();
      if (name === "c400.lua") return maskedOperationInfoResponseScript();
      return undefined;
    },
  };
}

function maskedOperationInfoSourceScript(): string {
  return `
    c100={}
    function c100.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return true end
        local g=Duel.SelectTarget(tp, aux.FilterBoolFunction(Card.IsCode, 200), tp, LOCATION_HAND, 0, 1, 1, e:GetHandler())
        Duel.SetOperationInfo(0, CATEGORY_TOHAND+CATEGORY_SEARCH, g, g:GetCount(), tp, LOCATION_DECK)
        return true
      end)
      e:SetOperation(function(e,tp) Debug.Message("masked source resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function maskedOperationInfoResponseScript(): string {
  return `
    c400={}
    function c400.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp)
        if Duel.GetCurrentChain()~=1 then return false end
        local tohand,g,count,p,param=Duel.GetOperationInfo(1, CATEGORY_TOHAND)
        local search=Duel.GetOperationInfo(1, CATEGORY_SEARCH)
        local destroy=Duel.GetOperationInfo(1, CATEGORY_DESTROY)
        local code=0
        if tohand and g and g:GetFirst() then code=g:GetFirst():GetCode() end
        Debug.Message("masked operation info " .. tostring(tohand) .. "/" .. tostring(search) .. "/" .. tostring(destroy) .. "/" .. code .. "/" .. count .. "/" .. p .. "/" .. param)
        return tohand and search and not destroy and code==200 and count==1 and p==0 and param==LOCATION_DECK
      end)
      e:SetOperation(function(e,tp) Debug.Message("masked response resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function cardCodeForUid(session: Parameters<typeof getLegalActions>[0], uid: string): string | undefined {
  return session.state.cards.find((card) => card.uid === uid)?.code;
}
