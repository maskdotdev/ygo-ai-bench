import { describe, expect, it } from "vitest";
import { createDuel, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua special summon procedure restore", () => {
  it("rolls back restored Lua procedure costs when release count falls short", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Rollback Procedure Source", kind: "monster" },
      { code: "200", name: "Rollback Release Material", kind: "monster" },
      { code: "300", name: "Rollback Replacement", kind: "monster" },
    ];
    const session = createDuel({ seed: 82, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const material = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    const replacement = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(source).toBeTruthy();
    expect(material).toBeTruthy();
    expect(replacement).toBeTruthy();
    moveDuelCard(session.state, material!.uid, "monsterZone", 0);

    const sourceScript = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_SPSUMMON_PROC)
        e:SetRange(LOCATION_HAND)
        e:SetCost(function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then return Duel.CheckReleaseGroup(tp, aux.FilterBoolFunction(Card.IsCode, 200), 1, e:GetHandler()) end
          local g=Duel.SelectReleaseGroup(tp, aux.FilterBoolFunction(Card.IsCode, 200), 1, 1, e:GetHandler())
          local released=Duel.Release(g, REASON_COST)
          Debug.Message("restored rollback release cost " .. released .. "/" .. g:GetCount())
          return released==g:GetCount()
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
        e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
        e:SetCode(EFFECT_RELEASE_REPLACE)
        e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e:SetRange(LOCATION_HAND)
        e:SetTargetRange(1,0)
        e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then return true end
          Duel.SetTargetCard(Group.FromCards(e:GetHandler()))
          return true
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Duel.Release(Duel.GetTargetCards(), REASON_EFFECT+REASON_REPLACE)
        end)
        c:RegisterEffect(e)
      end
      `;
        }
        return undefined;
      },
    };
    const host = createLuaScriptHost(session);
    const sourceLoad = host.loadCardScript(100, sourceScript);
    const replacementLoad = host.loadCardScript(300, sourceScript);
    expect(sourceLoad.ok, sourceLoad.error).toBe(true);
    expect(replacementLoad.ok, replacementLoad.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), sourceScript, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.loadedScripts.map((script) => script.name).sort()).toEqual(["c100.lua", "c300.lua"]);
    expect(restored.loadedScripts.every((script) => script.ok)).toBe(true);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid === source!.uid);
    expect(action).toBeDefined();

    const result = applyLuaRestoreResponse(restored, action!);
    expect(result.ok).toBe(false);
    expect(restored.host.messages).toContain("restored rollback release cost 0/1");
    expect(restored.session.state.cards.find((card) => card.uid === source!.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.cards.find((card) => card.uid === material!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.cards.find((card) => card.uid === replacement!.uid)).toMatchObject({ location: "hand" });
  });
});
