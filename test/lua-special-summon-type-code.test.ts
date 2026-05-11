import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, startDuel } from "#duel/core.js";
import { luaSummonTypeSpecial } from "#duel/summon-type-codes.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";

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
});
