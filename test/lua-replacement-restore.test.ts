import { describe, expect, it } from "vitest";
import { createDuel, destroyDuelCard, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua replacement restore", () => {
  it("preserves used Lua replacement count limits across snapshot restore", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Counted Replacement Source", kind: "monster" },
      { code: "200", name: "First Threatened Monster", kind: "monster" },
      { code: "201", name: "Second Threatened Monster", kind: "monster" },
      { code: "300", name: "First Replacement Cost", kind: "monster" },
      { code: "301", name: "Second Replacement Cost", kind: "monster" },
    ];
    const session = createDuel({ seed: 281, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "201", "300", "301"] },
      1: { main: [] },
    });
    startDuel(session);

    const firstThreatened = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    const secondThreatened = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "201");
    const secondCost = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "301");
    expect(firstThreatened).toBeTruthy();
    expect(secondThreatened).toBeTruthy();
    expect(secondCost).toBeTruthy();

    const source = replacementScriptSource();
    const host = createLuaScriptHost(session);
    const setup = host.loadCardScript(100, source);
    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    destroyDuelCard(session.state, firstThreatened!.uid, 0);
    expect(host.messages).toContain("counted replacement target 2");
    expect(host.messages).toContain("counted replacement op 300");
    expect(session.state.cards.find((card) => card.uid === firstThreatened!.uid)).toMatchObject({ location: "hand" });
    expect(session.state.usedCountKeys).toHaveLength(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.loadedScripts).toEqual([{ ok: true, name: "c100.lua" }]);
    expect(restored.registeredEffects).toBe(1);
    expect(restored.session.state.usedCountKeys).toEqual(session.state.usedCountKeys);

    destroyDuelCard(restored.session.state, secondThreatened!.uid, 0);
    expect(restored.host.messages).not.toContain("counted replacement op 301");
    expect(restored.session.state.cards.find((card) => card.uid === secondThreatened!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === secondCost!.uid)).toMatchObject({ location: "hand" });
  });
});

function replacementScriptSource() {
  const script = `
    local s={}
    c100={}
    function c100.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
      e:SetCode(EFFECT_DESTROY_REPLACE)
      e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
      e:SetRange(LOCATION_HAND)
      e:SetCountLimit(1)
      e:SetTargetRange(1,0)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.IsExistingMatchingCard(s.repfilter, tp, LOCATION_HAND, 0, 1, e:GetHandler()) end
        local g=Duel.GetMatchingGroup(s.repfilter, tp, LOCATION_HAND, 0, e:GetHandler())
        Duel.SetTargetCard(g)
        Debug.Message("counted replacement target " .. Duel.GetTargetCards():GetCount())
        return true
      end)
      e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
        local g=Duel.GetTargetCards()
        local first=g:Filter(Card.IsCode,nil,300):GetFirst()
        if not first then first=g:GetFirst() end
        Debug.Message("counted replacement op " .. first:GetCode())
        Duel.SendtoGrave(Group.FromCards(first), REASON_EFFECT+REASON_REPLACE)
      end)
      c:RegisterEffect(e)
    end
    function s.repfilter(c)
      return c:IsCode(300) or c:IsCode(301)
    end
  `;
  return { readScript: (name: string) => name === "c100.lua" ? script : undefined };
}
