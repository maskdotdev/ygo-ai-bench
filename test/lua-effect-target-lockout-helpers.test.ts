import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua effect target lockout helpers", () => {
  it("filters Duel.SelectTarget through effect targetability without changing raw matching selection", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Targeting Source", kind: "monster" },
      { code: "200", name: "Protected Target", kind: "monster" },
      { code: "300", name: "Open Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 223, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    for (const code of ["100", "200", "300"]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeDefined();
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
      card!.faceUp = true;
      card!.position = "faceUpAttack";
    }

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_MZONE)
        e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then
            return Duel.IsExistingMatchingCard(aux.TRUE,tp,LOCATION_MZONE,0,1,e:GetHandler())
          end
          local g=Duel.SelectTarget(tp,aux.TRUE,tp,LOCATION_MZONE,0,1,1,e:GetHandler())
          local raw=Duel.SelectMatchingCard(tp,aux.TRUE,tp,LOCATION_MZONE,0,1,2,e:GetHandler())
          Debug.Message("selected target " .. g:GetFirst():GetCode())
          Debug.Message("raw target count " .. raw:GetCount())
          return true
        end)
        e:SetOperation(function(e,tp)
          Debug.Message("resolved target " .. Duel.GetFirstTarget():GetCode())
        end)
        c:RegisterEffect(e)
      end

      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)
        e:SetRange(LOCATION_MZONE)
        e:SetValue(function(e,re,rp) return true end)
        c:RegisterEffect(e)
      end
      `,
      "effect-target-lockout.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    const response = applyResponse(session, action!);
    expect(response.ok).toBe(true);
    expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);

    expect(host.messages).toContain("selected target 300");
    expect(host.messages).toContain("raw target count 2");
    expect(host.messages).toContain("resolved target 300");
  });

  it("applies cannot-select-effect-target to target existence checks and selection", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Selecting Source", kind: "monster" },
      { code: "200", name: "Selection Lock Source", kind: "monster" },
      { code: "300", name: "Blocked Target", kind: "monster" },
      { code: "400", name: "Open Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 224, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400"] },
      1: { main: [] },
    });
    startDuel(session);

    for (const code of ["100", "200", "300", "400"]) {
      const card = session.state.cards.find((candidate) => candidate.code === code);
      expect(card).toBeDefined();
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
      card!.faceUp = true;
      card!.position = "faceUpAttack";
    }

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      local function target_filter(c)
        return c:IsCode(300) or c:IsCode(400)
      end
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_MZONE)
        e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then
            local blocked_exists=Duel.IsExistingTarget(aux.FilterBoolFunction(Card.IsCode,300),tp,LOCATION_MZONE,0,1,e:GetHandler())
            local open_exists=Duel.IsExistingTarget(aux.FilterBoolFunction(Card.IsCode,400),tp,LOCATION_MZONE,0,1,e:GetHandler())
            Debug.Message("blocked target exists " .. tostring(blocked_exists))
            Debug.Message("open target exists " .. tostring(open_exists))
            return open_exists
          end
          local g=Duel.SelectTarget(tp,target_filter,tp,LOCATION_MZONE,0,1,1,e:GetHandler())
          local raw=Duel.SelectMatchingCard(tp,target_filter,tp,LOCATION_MZONE,0,1,2,e:GetHandler())
          Debug.Message("selected target " .. g:GetFirst():GetCode())
          Debug.Message("raw target count " .. raw:GetCount())
          return true
        end)
        e:SetOperation(function(e,tp)
          Debug.Message("resolved target " .. Duel.GetFirstTarget():GetCode())
        end)
        c:RegisterEffect(e)
      end

      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_CANNOT_SELECT_EFFECT_TARGET)
        e:SetRange(LOCATION_MZONE)
        e:SetTargetRange(LOCATION_MZONE,0)
        e:SetValue(function(e,c) return c:IsCode(300) end)
        c:RegisterEffect(e)
      end
      `,
      "cannot-select-effect-target.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    const response = applyResponse(session, action!);
    expect(response.ok).toBe(true);
    expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);

    expect(host.messages).toContain("blocked target exists false");
    expect(host.messages).toContain("open target exists true");
    expect(host.messages).toContain("selected target 400");
    expect(host.messages).toContain("raw target count 2");
    expect(host.messages).toContain("resolved target 400");
  });
});
