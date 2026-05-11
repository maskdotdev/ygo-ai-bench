import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { luaSummonTypeSpecial } from "#duel/summon-type-codes.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua Special Summon type codes", () => {
  it("normalizes SUMMON_WITH_* reasons into special summon type masks", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Reborn Source", kind: "monster" },
      { code: "200", name: "Reborn Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 1010, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local e=Effect.CreateEffect(target)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetCode(EFFECT_SPSUMMON_CONDITION)
      e:SetValue(function(e,se,sp,st)
        Debug.Message("condition summon type " .. st)
        return st==SUMMON_TYPE_SPECIAL+SUMMON_WITH_MONSTER_REBORN
      end)
      target:RegisterEffect(e)
      Debug.Message("reborn can " .. tostring(target:IsCanBeSpecialSummoned(nil,SUMMON_WITH_MONSTER_REBORN,0,false,false,POS_FACEUP_ATTACK)))
      Debug.Message("reborn summon " .. Duel.SpecialSummon(target,SUMMON_WITH_MONSTER_REBORN,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("reborn summon type " .. target:GetSummonType() .. "/" .. tostring(target:IsSummonType(SUMMON_TYPE_SPECIAL+SUMMON_WITH_MONSTER_REBORN)))
      `,
      "special-summon-type-code.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain(`condition summon type ${luaSummonTypeSpecial + 1010}`);
    expect(host.messages).toContain("reborn can true");
    expect(host.messages).toContain("reborn summon 1");
    expect(host.messages).toContain(`reborn summon type ${luaSummonTypeSpecial + 1010}/true`);
    const target = session.state.cards.find((card) => card.code === "200");
    expect(target).toMatchObject({ location: "monsterZone", summonType: "special", summonTypeCode: luaSummonTypeSpecial + 1010 });
  });

  it("normalizes low custom reasons through staged Special Summons", () => {
    const cards: DuelCardData[] = [{ code: "300", name: "Contact Follow-Up Target", kind: "monster" }];
    const session = createDuel({ seed: 123, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["300"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_DECK, 0, 1, 1, nil):GetFirst()
      local e=Effect.CreateEffect(target)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetCode(EFFECT_SPSUMMON_CONDITION)
      e:SetValue(function(e,se,sp,st)
        Debug.Message("step condition summon type " .. st)
        return st==SUMMON_TYPE_SPECIAL+123
      end)
      target:RegisterEffect(e)
      Debug.Message("step can " .. tostring(target:IsCanBeSpecialSummoned(nil,123,0,false,false,POS_FACEUP_ATTACK)))
      Debug.Message("step summon " .. tostring(Duel.SpecialSummonStep(target,123,0,0,false,false,POS_FACEUP_ATTACK)))
      Duel.SpecialSummonComplete()
      Debug.Message("step summon type " .. target:GetSummonType() .. "/" .. tostring(target:IsSummonType(SUMMON_TYPE_SPECIAL+123)))
      `,
      "staged-special-summon-type-code.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain(`step condition summon type ${luaSummonTypeSpecial + 123}`);
    expect(host.messages).toContain("step can true");
    expect(host.messages).toContain("step summon true");
    expect(host.messages).toContain(`step summon type ${luaSummonTypeSpecial + 123}/true`);
    const target = session.state.cards.find((card) => card.code === "300");
    expect(target).toMatchObject({ location: "monsterZone", summonType: "special", summonTypeCode: luaSummonTypeSpecial + 123 });
  });

  it("checks EFFECT_SPSUMMON_COST against normalized custom summon types", () => {
    const cards: DuelCardData[] = [{ code: "400", name: "Custom Cost Target", kind: "monster" }];
    const session = createDuel({ seed: 182, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["400"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c400={}
      function c400.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_SPSUMMON_COST)
        e:SetCost(function(e,c,tp,sumtype)
          Debug.Message("spsummon cost " .. tp .. "/" .. sumtype)
          return sumtype~=SUMMON_TYPE_SPECIAL+182
        end)
        c:RegisterEffect(e)
      end
      `,
      "c400.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual([expect.objectContaining({ code: 92, event: "continuous", range: ["hand"], luaCostDescriptor: `cost:special-summon-type-not:${luaSummonTypeSpecial + 182}`, cost: expect.any(Function) })]);
    const target = session.state.cards.find((card) => card.code === "400");
    expect(session.state.effects[0]!.sourceUid).toBe(target!.uid);
    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === "c400.lua" ? `
      c400={}
      function c400.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_SPSUMMON_COST)
        e:SetCost(function(e,c,tp,sumtype)return sumtype~=SUMMON_TYPE_SPECIAL+182 end)
        c:RegisterEffect(e)
      end
      ` : undefined }, createCardReader(cards));
    expect(restored.session.state.effects).toEqual([expect.objectContaining({ code: 92, luaCostDescriptor: `cost:special-summon-type-not:${luaSummonTypeSpecial + 182}`, cost: expect.any(Function) })]);
    expect(restored.host.loadScript(`
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("restored cost custom blocked " .. tostring(target:IsCanBeSpecialSummoned(nil,182,0,false,false,POS_FACEUP_ATTACK)))
      Debug.Message("restored cost custom open " .. tostring(target:IsCanBeSpecialSummoned(nil,181,0,false,false,POS_FACEUP_ATTACK)))
      `, "restored-special-summon-cost-check.lua").ok).toBe(true);
    expect(restored.host.messages).toContain("restored cost custom blocked false");
    expect(restored.host.messages).toContain("restored cost custom open true");

    const check = host.loadScript(
      `
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("cost custom blocked " .. tostring(target:IsCanBeSpecialSummoned(nil,182,0,false,false,POS_FACEUP_ATTACK)))
      Debug.Message("cost custom open " .. tostring(target:IsCanBeSpecialSummoned(nil,181,0,false,false,POS_FACEUP_ATTACK)))
      `,
      "special-summon-cost-check.lua",
    );
    expect(check.ok, check.error).toBe(true);
    expect(host.messages).toContain(`spsummon cost 0/${luaSummonTypeSpecial + 182}`);
    expect(host.messages).toContain("cost custom blocked false");
    expect(host.messages).toContain("cost custom open true");
  });
});
