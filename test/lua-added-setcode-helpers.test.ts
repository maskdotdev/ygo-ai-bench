import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua added setcode helpers", () => {
  it("applies EFFECT_ADD_SETCODE to current card setcode checks and chain info", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Dynamic Setcode Source", kind: "monster" },
      { code: "400", name: "Dynamic Setcode Inspector", kind: "monster" },
    ];
    const session = createDuel({ seed: 250, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        c:AddSetcodesRule(100,true,SET_SOLFACHORD)
        Debug.Message("added setcode " .. tostring(c:IsSetCard(SET_SOLFACHORD)) .. "/" .. tostring(c:IsOriginalSetCard(SET_SOLFACHORD)) .. "/" .. c:GetSetCard())
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("added setcode source resolved")
        end)
        c:RegisterEffect(e)
      end
      c400={}
      function c400.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          if Duel.GetCurrentChain()~=1 then return false end
          local setcodes=Duel.GetChainInfo(1, CHAININFO_TRIGGERING_SETCODES)
          Debug.Message("added chain setcodes " .. #setcodes .. "/" .. setcodes[1])
          for _,setcode in ipairs(setcodes) do
            if (SET_SOLFACHORD&0xfff)==(setcode&0xfff) and (SET_SOLFACHORD&setcode)==SET_SOLFACHORD then
              return true
            end
          end
          return false
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("added setcode inspector resolved")
        end)
        c:RegisterEffect(e)
      end
      `,
      "added-setcode.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const sourceUid = session.state.cards.find((card) => card.code === "100" && card.owner === 0)?.uid;
    const sourceAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === sourceUid);
    expect(sourceAction).toBeDefined();
    applyAndAssert(session, sourceAction!);
    const quickAction = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateEffect");
    expect(quickAction).toBeDefined();
    applyAndAssert(session, quickAction!);
    passChainIfAvailable(session);
    passChainIfAvailable(session);

    expect(host.messages).toContain("added setcode true/false/356");
    expect(host.messages).toContain("added chain setcodes 1/356");
    expect(host.messages).toContain("added setcode inspector resolved");
    expect(host.messages).toContain("added setcode source resolved");
  });
});

function passChainIfAvailable(session: ReturnType<typeof createDuel>): boolean {
  const player = session.state.waitingFor;
  if (player === undefined) return false;
  const pass = getDuelLegalActions(session, player).find((candidate) => candidate.type === "passChain");
  return Boolean(pass && applyResponse(session, pass).ok);
}

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
