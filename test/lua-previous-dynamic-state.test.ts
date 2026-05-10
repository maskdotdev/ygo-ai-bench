import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua previous dynamic state", () => {
  it("captures current on-field identity and stats for previous-state helpers across restore", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Dynamic Previous-State Source", kind: "monster", typeFlags: 0x1, attack: 1000, defense: 1000, level: 4, race: 0x1, attribute: 0x10 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 260, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: [] } });
    startDuel(session);
    const card = session.state.cards.find((candidate) => candidate.code === "100" && candidate.location === "deck");
    expect(card).toBeDefined();
    moveDuelCard(session.state, card!.uid, "monsterZone", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = { readScript: previousDynamicStateScript };
    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const action = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === card!.uid);
    expect(action).toBeDefined();
    const response = applyResponse(session, action!);
    expect(response.ok, response.error).toBe(true);
    expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
    expect(host.messages).toContain("previous dynamic identity 901/true/false/true/true");
    expect(host.messages).toContain("previous dynamic stats 33/true/1800/true/1200/true/7/true");
    expect(host.messages).toContain("previous dynamic traits 2/true/32/true");

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const restoredCard = restored.session.state.cards.find((candidate) => candidate.uid === card!.uid);
    expect(restoredCard).toMatchObject({
      previousCodes: ["901"],
      previousSetcodes: [0x321],
      previousTypeFlags: 0x21,
      previousAttack: 1800,
      previousDefense: 1200,
      previousLevel: 7,
      previousRace: 0x2,
      previousAttribute: 0x20,
    });
    const probe = restored.host.loadScript(
      `
      local c=Duel.GetFieldCard(0,LOCATION_GRAVE,0)
      Debug.Message("restored previous dynamic identity " .. c:GetPreviousCode() .. "/" .. tostring(c:IsPreviousCode(901)) .. "/" .. tostring(c:IsPreviousCode(100)) .. "/" .. tostring(c:IsPreviousCodeOnField(901)) .. "/" .. tostring(c:IsPreviousSetCard(0x321)))
      Debug.Message("restored previous dynamic stats " .. c:GetPreviousTypeOnField() .. "/" .. tostring(c:IsPreviousTypeOnField(TYPE_EFFECT)) .. "/" .. c:GetPreviousAttackOnField() .. "/" .. tostring(c:IsPreviousAttackOnField(1800)) .. "/" .. c:GetPreviousDefenseOnField() .. "/" .. tostring(c:IsPreviousDefenseOnField(1200)) .. "/" .. c:GetPreviousLevelOnField() .. "/" .. tostring(c:IsPreviousLevelOnField(7)))
      Debug.Message("restored previous dynamic traits " .. c:GetPreviousRaceOnField() .. "/" .. tostring(c:IsPreviousRaceOnField(RACE_SPELLCASTER)) .. "/" .. c:GetPreviousAttributeOnField() .. "/" .. tostring(c:IsPreviousAttributeOnField(ATTRIBUTE_DARK)))
      `,
      "restored-previous-dynamic-state.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toContain("restored previous dynamic identity 901/true/false/true/true");
    expect(restored.host.messages).toContain("restored previous dynamic stats 33/true/1800/true/1200/true/7/true");
    expect(restored.host.messages).toContain("restored previous dynamic traits 2/true/32/true");
  });
});

function previousDynamicStateScript(name: string): string | undefined {
  if (name !== "c100.lua") return undefined;
  return `
    c100={}
    function c100.initial_effect(c)
      local e0=Effect.CreateEffect(c)
      e0:SetType(EFFECT_TYPE_SINGLE)
      e0:SetCode(EFFECT_CHANGE_CODE)
      e0:SetValue(901)
      c:RegisterEffect(e0)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_SINGLE)
      e1:SetCode(EFFECT_ADD_SETCODE)
      e1:SetValue(0x321)
      c:RegisterEffect(e1)
      local e2=Effect.CreateEffect(c)
      e2:SetType(EFFECT_TYPE_SINGLE)
      e2:SetCode(EFFECT_ADD_TYPE)
      e2:SetValue(TYPE_EFFECT)
      c:RegisterEffect(e2)
      local e3=Effect.CreateEffect(c)
      e3:SetType(EFFECT_TYPE_SINGLE)
      e3:SetCode(EFFECT_SET_ATTACK)
      e3:SetValue(1800)
      c:RegisterEffect(e3)
      local e4=Effect.CreateEffect(c)
      e4:SetType(EFFECT_TYPE_SINGLE)
      e4:SetCode(EFFECT_SET_DEFENSE)
      e4:SetValue(1200)
      c:RegisterEffect(e4)
      local e5=Effect.CreateEffect(c)
      e5:SetType(EFFECT_TYPE_SINGLE)
      e5:SetCode(EFFECT_CHANGE_LEVEL)
      e5:SetValue(7)
      c:RegisterEffect(e5)
      local e6=Effect.CreateEffect(c)
      e6:SetType(EFFECT_TYPE_SINGLE)
      e6:SetCode(EFFECT_CHANGE_RACE)
      e6:SetValue(RACE_SPELLCASTER)
      c:RegisterEffect(e6)
      local e7=Effect.CreateEffect(c)
      e7:SetType(EFFECT_TYPE_SINGLE)
      e7:SetCode(EFFECT_CHANGE_ATTRIBUTE)
      e7:SetValue(ATTRIBUTE_DARK)
      c:RegisterEffect(e7)
      local e8=Effect.CreateEffect(c)
      e8:SetType(EFFECT_TYPE_IGNITION)
      e8:SetRange(LOCATION_MZONE)
      e8:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
        local c=e:GetHandler()
        Duel.SendtoGrave(c,REASON_EFFECT)
        local g=Duel.GetFieldCard(tp,LOCATION_GRAVE,0)
        Debug.Message("previous dynamic identity " .. g:GetPreviousCode() .. "/" .. tostring(g:IsPreviousCode(901)) .. "/" .. tostring(g:IsPreviousCode(100)) .. "/" .. tostring(g:IsPreviousCodeOnField(901)) .. "/" .. tostring(g:IsPreviousSetCard(0x321)))
        Debug.Message("previous dynamic stats " .. g:GetPreviousTypeOnField() .. "/" .. tostring(g:IsPreviousTypeOnField(TYPE_EFFECT)) .. "/" .. g:GetPreviousAttackOnField() .. "/" .. tostring(g:IsPreviousAttackOnField(1800)) .. "/" .. g:GetPreviousDefenseOnField() .. "/" .. tostring(g:IsPreviousDefenseOnField(1200)) .. "/" .. g:GetPreviousLevelOnField() .. "/" .. tostring(g:IsPreviousLevelOnField(7)))
        Debug.Message("previous dynamic traits " .. g:GetPreviousRaceOnField() .. "/" .. tostring(g:IsPreviousRaceOnField(RACE_SPELLCASTER)) .. "/" .. g:GetPreviousAttributeOnField() .. "/" .. tostring(g:IsPreviousAttributeOnField(ATTRIBUTE_DARK)))
      end)
      c:RegisterEffect(e8)
    end
  `;
}
