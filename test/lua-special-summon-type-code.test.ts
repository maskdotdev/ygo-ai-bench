import { describe, expect, it } from "vitest";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { luaSummonTypeSpecial } from "#duel/summon-type-codes.js";
import type { DuelCardData, DuelEffectContext } from "#duel/types.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

function expectRestoredLegalActionGroups(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

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
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
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

  it("restores EFFECT_SPSUMMON_COST equality predicates", () => {
    const cards: DuelCardData[] = [{ code: "401", name: "Equality Cost Target", kind: "monster" }];
    const script = `
      c401={}
      function c401.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_SPSUMMON_COST)
        e:SetCost(function(e,c,tp,sumtype)return sumtype==SUMMON_TYPE_SPECIAL+181 end)
        c:RegisterEffect(e)
      end
      `;
    const session = createDuel({ seed: 181, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["401"] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, "c401.lua").ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects[0]).toMatchObject({ code: 92, luaCostDescriptor: `cost:special-summon-type-is:${luaSummonTypeSpecial + 181}` });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === "c401.lua" ? script : undefined }, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    expect(restored.host.loadScript(`
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 401), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("restored equality open " .. tostring(target:IsCanBeSpecialSummoned(nil,181,0,false,false,POS_FACEUP_ATTACK)))
      Debug.Message("restored equality blocked " .. tostring(target:IsCanBeSpecialSummoned(nil,182,0,false,false,POS_FACEUP_ATTACK)))
      `, "restored-special-summon-equality-cost-check.lua").ok).toBe(true);
    expect(restored.host.messages).toContain("restored equality open true");
    expect(restored.host.messages).toContain("restored equality blocked false");
  });

  it("restores EFFECT_SPSUMMON_COST predicates with captured numeric upvalues", () => {
    const cards: DuelCardData[] = [{ code: "402", name: "Upvalue Cost Target", kind: "monster" }];
    const script = `
      c402={}
      local summon_detail=0xb7
      function c402.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_SPSUMMON_COST)
        e:SetCost(function(e,c,tp,sumtype)return sumtype~=SUMMON_TYPE_SPECIAL+summon_detail end)
        c:RegisterEffect(e)
      end
      `;
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 183, startingHandSize: 1, cardReader: reader });
    loadDecks(session, { 0: { main: ["402"] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session);
    expect(host.loadScript(script, "c402.lua").ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects[0]).toMatchObject({ code: 92, luaCostDescriptor: `cost:special-summon-type-not:${luaSummonTypeSpecial + 183}` });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: (name) => name === "c402.lua" ? script : undefined }, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored);
    expect(restored.session.state.effects[0]).toMatchObject({ code: 92, luaCostDescriptor: `cost:special-summon-type-not:${luaSummonTypeSpecial + 183}` });
    expect(restored.session.state.cards.find((card) => card.code === "402")).toMatchObject({ location: "hand" });
    const restoredEffect = restored.session.state.effects[0]!;
    expect(typeof restoredEffect.cost).toBe("function");
    const restoredTarget = restored.session.state.cards.find((card) => card.code === "402")!;
    const ctx: DuelEffectContext = {
      duel: restored.session.state,
      source: restoredTarget,
      player: 0,
      targetUids: [],
      log: () => {},
      moveCard: () => restoredTarget,
      negateChainLink: () => false,
      setTargets: () => {},
      getTargets: () => [],
      setTargetPlayer: () => {},
      setTargetParam: () => {},
    };
    expect(restoredEffect.cost?.({ ...ctx, summonTypeCode: luaSummonTypeSpecial + 183 })).toBe(false);
    expect(restoredEffect.cost?.({ ...ctx, summonTypeCode: luaSummonTypeSpecial + 182 })).toBe(true);
  });
});
