import { describe, expect, it } from "vitest";
import {
  applyResponse,
  createDuel,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  moveDuelCard,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua effect metadata helpers", () => {
  it("lets Lua scripts activate registered legal effects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Activate Source", kind: "monster" }];
    const session = createDuel({ seed: 98, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
        Debug.Message("activate operation " .. e:GetHandler():GetCode() .. "/" .. tp)
      end)
      c:RegisterEffect(e)
      Debug.Message("activate result " .. tostring(Duel.Activate(e)))
      Debug.Message("activate repeat " .. tostring(Duel.Activate(e)))
      `,
      "duel-activate.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages.filter((message) => message === "activate operation 100/0")).toHaveLength(2);
    expect(host.messages).toContain("activate result true");
    expect(host.messages).toContain("activate repeat true");
  });

  it("tracks Lua effect count-limit usage", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Count Limit Source", kind: "monster" }];
    const session = createDuel({ seed: 95, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local e=Effect.CreateEffect(c)
      e:SetCountLimit(2, 99001)
      Debug.Message("count limit initial " .. tostring(e:CheckCountLimit(0)) .. "/" .. tostring(e:CheckCountLimit(1)))
      e:UseCountLimit(0)
      Debug.Message("count limit once " .. tostring(e:CheckCountLimit(0)) .. "/" .. tostring(e:CheckCountLimit(1)))
      e:UseCountLimit(0)
      Debug.Message("count limit spent " .. tostring(e:CheckCountLimit(0)) .. "/" .. tostring(e:CheckCountLimit(1)))
      local clone=e:Clone()
      Debug.Message("count limit shared clone " .. tostring(clone:CheckCountLimit(0)) .. "/" .. tostring(clone:CheckCountLimit(1)))
      e:Reset()
      Debug.Message("count limit reset " .. tostring(e:CheckCountLimit(0)))
      `,
      "effect-count-limit.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("count limit initial true/true");
    expect(host.messages).toContain("count limit once true/true");
    expect(host.messages).toContain("count limit spent false/true");
    expect(host.messages).toContain("count limit shared clone false/true");
    expect(host.messages).toContain("count limit reset true");
  });

  it("resets matching card effects through aux.ResetEffects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Reset Effects Source", kind: "monster" }];
    const session = createDuel({ seed: 96, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetCode(EFFECT_CANNOT_ATTACK)
      e:SetCountLimit(1, 99002)
      c:RegisterEffect(e)
      local found=c:GetCardEffect(EFFECT_CANNOT_ATTACK)
      Debug.Message("card effect found " .. tostring(found~=nil))
      found:UseCountLimit(0)
      Debug.Message("card effect spent " .. tostring(found:CheckCountLimit(0)))
      aux.ResetEffects(Group.FromCards(c), EFFECT_CANNOT_ATTACK)
      Debug.Message("card effect reset " .. tostring(found:CheckCountLimit(0)))
      `,
      "aux-reset-effects.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("card effect found true");
    expect(host.messages).toContain("card effect spent false");
    expect(host.messages).toContain("card effect reset true");
  });

  it("creates and registers Lua global effects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Global Anchor", kind: "monster" }];
    const session = createDuel({ seed: 94, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local e=Effect.GlobalEffect()
      Debug.Message("global handler nil " .. tostring(e:GetHandler()==nil))
      e:SetType(EFFECT_TYPE_FIELD)
      e:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)
      e:SetTargetRange(1,0)
      Debug.Message("global registered " .. tostring(Duel.RegisterEffect(e,0)))
      `,
      "global-effect.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["global handler nil true", "global registered true"]);
    expect(session.state.effects).toHaveLength(1);
    expect(session.state.effects[0]).toMatchObject({ controller: 0, ownerPlayer: 0, event: "continuous", code: 22 });
    expect(session.state.effects[0]?.registryKey).toBe("lua:global:lua-1-22");
  });

  it("registers Lua card procedure status helpers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Procedure Status Source", kind: "monster", level: 7 },
      { code: "200", name: "Linked Zone Source", kind: "extra", typeFlags: 0x4000001, linkMarkers: 0x20 },
      { code: "300", name: "Linked Zone Target", kind: "extra", typeFlags: 0x4000001, linkMarkers: 0x8 },
      { code: "400", name: "Extra Procedure Source", kind: "extra", typeFlags: 0x4000001, linkMarkers: 0x20 },
    ];
    const session = createDuel({ seed: 93, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"], extra: ["200", "300", "400"] },
      1: { main: [] },
    });
    startDuel(session);
    const source = session.state.cards.find((card) => card.code === "200");
    const target = session.state.cards.find((card) => card.code === "300");
    expect(source).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0).sequence = 1;
    moveDuelCard(session.state, target!.uid, "monsterZone", 0).sequence = 2;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local source=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local extra=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_EXTRA, 0, 1, 1, nil):GetFirst()
      c:GetMetatable().MaximumAttack=3900
      c:GetMetatable().is_legend=true
      local maximum_atk=c:AddMaximumAtkHandler()
      local side_grant=c:AddCenterToSideEffectHandler(maximum_atk)
      local revive=c:EnableReviveLimit()
      local cannot=c:AddCannotBeSpecialSummoned()
      local must=c:AddMustBeSpecialSummoned()
      local must_by_effect=c:AddMustBeSpecialSummonedByCardEffect()
      local must_dark_fusion=c:AddMustBeSpecialSummonedByDarkFusion()
      local must_fusion=c:AddMustBeFusionSummoned()
      local first_fusion=extra:AddMustFirstBeFusionSummoned()
      local must_ritual=c:AddMustBeRitualSummoned()
      local first_ritual=c:AddMustFirstBeRitualSummoned()
      local must_synchro=c:AddMustBeSynchroSummoned()
      local must_xyz=c:AddMustBeXyzSummoned()
      local must_link=c:AddMustBeLinkSummoned()
      local first_link=extra:AddMustFirstBeLinkSummoned()
      local must_pendulum=c:AddMustBePendulumSummoned()
      local first_pendulum=c:AddMustFirstBePendulumSummoned()
      local cannot_normal=c:AddCannotBeNormalSummoned()
      local cannot_flip=c:AddCannotBeFlipSummoned()
      local gemini=c:EnableGeminiStatus()
      c:AddDoubleTribute(160005033,aux.TRUE,aux.TRUE,0,FLAG_DOUBLE_TRIB_WINGEDBEAST,FLAG_DOUBLE_TRIB_LIGHT)
      c:RegisterFlagEffect(c:GetOriginalCode(),RESET_EVENT,0,1)
      local min,max=c:GetTributeRequirement()
      Debug.Message("card proc codes " .. revive:GetCode() .. "/" .. cannot:GetCode() .. "/" .. must:GetCode() .. "/" .. must_by_effect:GetCode() .. "/" .. must_dark_fusion:GetCode() .. "/" .. must_fusion:GetCode() .. "/" .. must_ritual:GetCode() .. "/" .. must_synchro:GetCode() .. "/" .. must_xyz:GetCode() .. "/" .. must_link:GetCode() .. "/" .. must_pendulum:GetCode() .. "/" .. cannot_normal:GetCode() .. "/" .. cannot_flip:GetCode() .. "/" .. gemini:GetCode() .. "/" .. maximum_atk:GetCode())
      Debug.Message("card proc effects " .. tostring(c:IsHasEffect(EFFECT_REVIVE_LIMIT)~=nil) .. "/" .. tostring(c:IsHasEffect(EFFECT_SPSUMMON_CONDITION)~=nil) .. "/" .. tostring(c:IsHasEffect(EFFECT_CANNOT_SUMMON)~=nil) .. "/" .. tostring(c:IsHasEffect(EFFECT_CANNOT_FLIP_SUMMON)~=nil) .. "/" .. tostring(c:IsHasEffect(EFFECT_GEMINI_STATUS)~=nil) .. "/" .. tostring(c:IsGeminiStatus()))
      local action_effect=Effect.CreateEffect(c)
      action_effect:SetType(EFFECT_TYPE_IGNITION)
      local continuous_effect=Effect.CreateEffect(c)
      continuous_effect:SetType(EFFECT_TYPE_CONTINUOUS)
      Debug.Message("card effect summon limit " .. tostring(must_by_effect:GetValue()(nil,action_effect,0,SUMMON_TYPE_SPECIAL)) .. "/" .. tostring(must_by_effect:GetValue()(nil,continuous_effect,0,SUMMON_TYPE_SPECIAL)))
      Debug.Message("dark fusion proc " .. tostring(c:GetMetatable().dark_calling) .. "/" .. tostring(c:IsHasEffect(51476410)~=nil) .. "/" .. type(must_dark_fusion:GetValue()))
      Debug.Message("fusion summon limit " .. tostring(must_fusion:GetValue()(nil,nil,0,SUMMON_TYPE_FUSION)) .. "/" .. tostring(must_fusion:GetValue()(nil,nil,0,SUMMON_TYPE_SYNCHRO)))
      Debug.Message("first fusion limit " .. tostring(first_fusion:GetValue()(first_fusion,nil,0,SUMMON_TYPE_FUSION)) .. "/" .. tostring(first_fusion:GetValue()(first_fusion,nil,0,SUMMON_TYPE_LINK)))
      Debug.Message("ritual summon limit " .. tostring(must_ritual:GetValue()(nil,nil,0,SUMMON_TYPE_RITUAL)) .. "/" .. tostring(must_ritual:GetValue()(nil,nil,0,SUMMON_TYPE_FUSION)))
      Debug.Message("first ritual limit " .. tostring(first_ritual:GetValue()(first_ritual,nil,0,SUMMON_TYPE_FUSION)) .. "/" .. tostring(first_ritual:GetValue()(first_ritual,nil,0,SUMMON_TYPE_RITUAL)))
      Debug.Message("synchro summon limit " .. tostring(must_synchro:GetValue()(nil,nil,0,SUMMON_TYPE_SYNCHRO)) .. "/" .. tostring(must_synchro:GetValue()(nil,nil,0,SUMMON_TYPE_XYZ)))
      Debug.Message("xyz summon limit " .. tostring(must_xyz:GetValue()(nil,nil,0,SUMMON_TYPE_XYZ)) .. "/" .. tostring(must_xyz:GetValue()(nil,nil,0,SUMMON_TYPE_SYNCHRO)))
      Debug.Message("link summon limit " .. tostring(must_link:GetValue()(nil,nil,0,SUMMON_TYPE_LINK)) .. "/" .. tostring(must_link:GetValue()(nil,nil,0,SUMMON_TYPE_FUSION)))
      Debug.Message("first link limit " .. tostring(first_link:GetValue()(first_link,nil,0,SUMMON_TYPE_LINK)) .. "/" .. tostring(first_link:GetValue()(first_link,nil,0,SUMMON_TYPE_FUSION)))
      Debug.Message("pendulum summon limit " .. tostring(must_pendulum:GetValue()(nil,nil,0,SUMMON_TYPE_PENDULUM)) .. "/" .. tostring(must_pendulum:GetValue()(nil,nil,0,SUMMON_TYPE_LINK)))
      Debug.Message("first pendulum limit " .. tostring(first_pendulum:GetValue()(first_pendulum,nil,0,SUMMON_TYPE_FUSION)) .. "/" .. tostring(first_pendulum:GetValue()(first_pendulum,nil,0,SUMMON_TYPE_PENDULUM)))
      Debug.Message("maximum atk handler " .. maximum_atk:GetValue() .. "/" .. maximum_atk:GetRange() .. "/" .. tostring(maximum_atk:GetCondition()(maximum_atk)))
      local grant_self,grant_opp=side_grant:GetTargetRange()
      Debug.Message("center side grant " .. side_grant:GetType() .. "/" .. side_grant:GetRange() .. "/" .. grant_self .. "/" .. grant_opp .. "/" .. tostring(side_grant:GetLabelObject()==maximum_atk) .. "/" .. tostring(side_grant:GetCondition()(side_grant)) .. "/" .. tostring(side_grant:GetTarget()(side_grant,c)))
      Debug.Message("double tribute proc " .. c:GetFlagEffect(FLAG_HAS_DOUBLE_TRIBUTE) .. "/" .. c:GetFlagEffect(FLAG_DOUBLE_TRIB_WINGEDBEAST) .. "/" .. c:GetFlagEffect(FLAG_DOUBLE_TRIB_LIGHT) .. "/" .. tostring(c:IsHasEffect(EFFECT_SUMMON_PROC)~=nil))
      Debug.Message("card proc queries " .. min .. "/" .. max .. "/" .. c:GetMaximumAttack() .. "/" .. tostring(c:IsLegend()) .. "/" .. source:GetToBeLinkedZone(target,0,true) .. "/" .. tostring(c:IsNouvellesSummoned()))
      `,
      "card-procedure-status.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("card proc codes 31/30/30/30/30/30/30/30/30/30/30/20/21/75/103");
    expect(host.messages).toContain("card proc effects true/true/true/true/true/true");
    expect(host.messages).toContain("card effect summon limit true/false");
    expect(host.messages).toContain("dark fusion proc true/true/function");
    expect(host.messages).toContain("fusion summon limit true/false");
    expect(host.messages).toContain("first fusion limit true/false");
    expect(host.messages).toContain("ritual summon limit true/false");
    expect(host.messages).toContain("first ritual limit false/true");
    expect(host.messages).toContain("synchro summon limit true/false");
    expect(host.messages).toContain("xyz summon limit true/false");
    expect(host.messages).toContain("link summon limit true/false");
    expect(host.messages).toContain("first link limit true/false");
    expect(host.messages).toContain("pendulum summon limit true/false");
    expect(host.messages).toContain("first pendulum limit false/true");
    expect(host.messages).toContain("maximum atk handler 3900/4/false");
    expect(host.messages).toContain("center side grant 8194/4/4/0/true/false/false");
    expect(host.messages).toContain("double tribute proc 1/1/1/true");
    expect(host.messages).toContain("card proc queries 2/2/3900/true/2/true");
  });

  it("stores Lua effect metadata setters on registered effects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Metadata Source", kind: "monster" }];
    const session = createDuel({ seed: 16, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetDescription(1234)
        e:SetCategory(CATEGORY_DRAW + CATEGORY_SEARCH)
        e:SetProperty(EFFECT_FLAG_CARD_TARGET + EFFECT_FLAG_DELAY)
        e:SetRange(LOCATION_HAND)
        e:SetTargetRange(LOCATION_MZONE, LOCATION_GRAVE)
        e:SetHintTiming(TIMING_END_PHASE, TIMING_MAIN_END)
        e:SetCountLimit(2, 987)
        e:SetReset(RESET_EVENT + RESETS_STANDARD, 1)
        e:SetCondition(function(e,c) return c:IsCode(100) end)
        e:SetCost(function(e,c) return true end)
        e:SetTarget(function(e,c) return true end)
        e:SetOperation(function(e,c) Debug.Message("metadata operation") end)
        local condition=e:GetCondition()
        local cost=e:GetCost()
        local target=e:GetTarget()
        local operation=e:GetOperation()
        Debug.Message("effect predicates " .. tostring(e:IsHasType(EFFECT_TYPE_IGNITION)) .. "/" .. tostring(e:IsHasCategory(CATEGORY_DRAW)) .. "/" .. tostring(e:IsHasProperty(EFFECT_FLAG_CARD_TARGET)))
        Debug.Message("effect callbacks " .. tostring(condition(e,c)) .. "/" .. tostring(cost(e,c)) .. "/" .. tostring(target(e,c)) .. "/" .. tostring(operation ~= nil))
        e:SetValue(function(e,c) return c:GetCode()+7 end)
        local value_fn=e:GetValue()
        Debug.Message("effect value function " .. value_fn(e,c))
        e:SetValue(2500)
        local own_range,opponent_range=e:GetTargetRange()
        local limit,limit_code=e:GetCountLimit()
        local reset,reset_count=e:GetReset()
        Debug.Message("effect getters " .. e:GetType() .. "/" .. e:GetCode() .. "/" .. e:GetDescription() .. "/" .. e:GetCategory() .. "/" .. e:GetProperty() .. "/" .. e:GetRange())
        Debug.Message("effect target range " .. own_range .. "/" .. opponent_range)
        Debug.Message("effect count reset " .. limit .. "/" .. limit_code .. "/" .. reset .. "/" .. reset_count)
        Debug.Message("effect value number " .. e:GetValue())
        c:RegisterEffect(e)
      end
      `,
      "effect-metadata.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.getGlobalNumber("EFFECT_TYPE_SINGLE")).toBe(0x1);
    expect(host.getGlobalNumber("EFFECT_TYPE_IGNITION")).toBe(0x40);
    expect(host.getGlobalNumber("EFFECT_TYPE_TRIGGER_O")).toBe(0x80);
    expect(host.getGlobalNumber("EFFECT_TYPE_CONTINUOUS")).toBe(0x800);
    expect(host.getGlobalNumber("EFFECT_SPSUMMON_CONDITION")).toBe(30);
    expect(host.getGlobalNumber("EFFECT_SPSUMMON_PROC")).toBe(34);
    expect(host.getGlobalNumber("EFFECT_DISABLE")).toBe(2);
    expect(host.getGlobalNumber("EFFECT_CANNOT_SPECIAL_SUMMON")).toBe(22);
    expect(host.getGlobalNumber("EFFECT_TO_GRAVE_REDIRECT")).toBe(63);
    expect(host.getGlobalNumber("EFFECT_SET_ATTACK")).toBe(101);
    expect(host.getGlobalNumber("EFFECT_CHANGE_CODE")).toBe(114);
    expect(host.getGlobalNumber("EFFECT_CHANGE_LEVEL")).toBe(131);
    expect(host.getGlobalNumber("EFFECT_DOUBLE_TRIBUTE")).toBe(150);
    expect(host.getGlobalNumber("EFFECT_PIERCE")).toBe(203);
    expect(host.getGlobalNumber("EFFECT_FUSION_SUBSTITUTE")).toBe(234);
    expect(host.getGlobalNumber("EFFECT_DISABLE_FIELD")).toBe(260);
    expect(host.getGlobalNumber("EFFECT_HAND_LIMIT")).toBe(270);
    expect(host.getGlobalNumber("EFFECT_CHANGE_LINK")).toBe(421);
    expect(host.getGlobalNumber("CATEGORY_DISABLE")).toBe(0x4000);
    expect(host.getGlobalNumber("CATEGORY_NEGATE")).toBe(0x10000000);
    expect(host.getGlobalNumber("EFFECT_FLAG_DAMAGE_STEP")).toBe(0x4000);
    expect(host.getGlobalNumber("EFFECT_FLAG_DAMAGE_CAL")).toBe(0x8000);
    expect(host.getGlobalNumber("EFFECT_FLAG_PLAYER_TARGET")).toBe(0x800);
    expect(host.getGlobalNumber("EFFECT_FLAG_IMMEDIATELY_APPLY")).toBe(0x80000000);
    expect(host.getGlobalNumber("HINT_SELECTMSG")).toBe(3);
    expect(host.getGlobalNumber("HINTMSG_TOHAND")).toBe(506);
    expect(host.getGlobalNumber("HINTMSG_TARGET")).toBe(551);
    expect(host.getGlobalNumber("PHASE_MAIN1")).toBe(0x4);
    expect(host.getGlobalNumber("PHASE_BATTLE")).toBe(0x80);
    expect(host.getGlobalNumber("EVENT_SUMMON_SUCCESS")).toBe(1100);
    expect(host.getGlobalNumber("EVENT_TO_GRAVE")).toBe(1014);
    expect(host.getGlobalNumber("EVENT_CHAINING")).toBe(1027);
    expect(host.getGlobalNumber("RESETS_STANDARD")).toBe(0x1fe0000);
    expect(host.getGlobalNumber("RESET_PHASE")).toBe(0x40000000);
    expect(host.getGlobalNumber("RESET_CHAIN")).toBe(0x80000000);
    expect(host.getGlobalNumber("REASON_LINK")).toBe(0x10000000);
    expect(host.getGlobalNumber("REASON_DRAW")).toBe(0x2000000);
    expect(host.registerInitialEffects()).toBe(2);
    expect(host.messages).toContain("effect predicates true/true/true");
    expect(host.messages).toContain("effect callbacks true/true/true/true");
    expect(host.messages).toContain("effect value function 107");
    expect(host.messages).toContain("effect getters 64/1100/1234/196608/65552/2");
    expect(host.messages).toContain("effect target range 4/16");
    expect(host.messages).toContain("effect count reset 2/987/33427456/1");
    expect(host.messages).toContain("effect value number 2500");
    expect(session.state.effects[0]).toMatchObject({
      registryKey: "lua:100:lua-1-1100",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      description: 1234,
      category: 0x30000,
      property: 0x10010,
      targetRange: [0x04, 0x10],
      hintTiming: [0x20, 0x4],
      countLimit: 2,
      countLimitCode: 987,
      reset: { flags: 0x1fe1000, count: 1 },
    });
    expect(serializeDuel(session).state.effects[0]).toMatchObject({
      id: "lua-1-1100",
      registryKey: "lua:100:lua-1-1100",
      sourceUid: session.state.effects[0]?.sourceUid,
    });
  });

  it("registers Lua normal summon and set procedure effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Procedure Source", kind: "monster", level: 7 },
      { code: "200", name: "Procedure Tribute A", kind: "monster", level: 4 },
      { code: "300", name: "Procedure Tribute B", kind: "monster", level: 4 },
      { code: "400", name: "Procedure Extra Tribute", kind: "monster", level: 4 },
    ];
    const session = createDuel({ seed: 57, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const code of ["200", "300", "400"]) {
      const tribute = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === code);
      expect(tribute).toBeDefined();
      moveDuelCard(session.state, tribute!.uid, "monsterZone", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local ns=aux.AddNormalSummonProcedure(c,true,true,1,1,SUMMON_TYPE_TRIBUTE,1234)
      local ls=aux.AddNormalSummonProcedure(c,false,false,2,2)
      local st=aux.AddNormalSetProcedure(c,true,true,1,1,SUMMON_TYPE_TRIBUTE,5678)
      local lt=aux.AddNormalSetProcedure(c,false,false,2,2)
      local rush=aux.summonproc(c,true,true,1,1,SUMMON_TYPE_TRIBUTE+100,9012)
      local rush3=aux.summonproc3trib(c,3456,aux.TRUE)
      local grant_target=aux.ThreeTribGrantTarget(function(e,tc) return tc:IsCode(100) end)
      Debug.Message("normal proc codes " .. ns:GetCode() .. "/" .. ls:GetCode() .. "/" .. st:GetCode() .. "/" .. lt:GetCode())
      Debug.Message("normal proc metadata " .. ns:GetDescription() .. "/" .. st:GetDescription() .. "/" .. ns:GetProperty() .. "/" .. ns:GetValue())
      Debug.Message("normal proc callbacks " .. tostring(ns:GetCondition()(ns,c,0,0,0,nil)) .. "/" .. tostring(ls:GetCondition()(ls,nil,0,0,0,nil)) .. "/" .. tostring(ns:GetTarget()~=nil) .. "/" .. tostring(ns:GetOperation()~=nil))
      Debug.Message("rush proc metadata " .. rush:GetCode() .. "/" .. rush:GetDescription() .. "/" .. rush:GetValue() .. "/" .. rush3:GetCode() .. "/" .. rush3:GetDescription() .. "/" .. rush3:GetValue())
      Debug.Message("rush proc registered " .. tostring(c:GetCardEffect(EFFECT_SUMMON_PROC)~=nil))
      Debug.Message("three tribute condition " .. tostring(rush3:GetCondition()(rush3,c)) .. "/" .. tostring(rush3:GetCondition()(rush3,nil)))
      Debug.Message("three tribute grant before " .. tostring(grant_target(rush3,c)))
      c:RegisterFlagEffect(FLAG_TRIPLE_TRIBUTE,RESET_EVENT,0,1)
      Debug.Message("three tribute grant after " .. FLAG_TRIPLE_TRIBUTE .. "/" .. tostring(grant_target(rush3,c)))
      Debug.Message("three tribute target " .. tostring(rush3:GetTarget()(rush3,0,nil,0,0,nil,0,0,1,c)))
      local g=rush3:GetLabelObject()
      Debug.Message("three tribute selected " .. g:GetCount())
      rush3:GetOperation()(rush3,0,nil,0,0,nil,0,0,c)
      Debug.Message("three tribute released " .. g:GetCount() .. "/" .. Duel.GetMatchingGroupCount(aux.TRUE,0,LOCATION_GRAVE,0,nil))
      `,
      "normal-procedure.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("normal proc codes 32/33/36/37");
    expect(host.messages).toContain("normal proc metadata 1234/5678/263168/285212672");
    expect(host.messages).toContain("normal proc callbacks true/true/true/true");
    expect(host.messages).toContain("rush proc metadata 32/9012/285212772/32/3456/285212673");
    expect(host.messages).toContain("rush proc registered true");
    expect(host.messages).toContain("three tribute condition true/true");
    expect(host.messages).toContain("three tribute grant before false");
    expect(host.messages).toContain("three tribute grant after 160012000/true");
    expect(host.messages).toContain("three tribute target true");
    expect(host.messages).toContain("three tribute selected 3");
    expect(host.messages).toContain("three tribute released 3/3");
  });

  it("registers Lua persistent trap procedures and target filters", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Persistent Trap", kind: "trap", typeFlags: 0x4 },
      { code: "200", name: "Own Target", kind: "monster", typeFlags: 0x21 },
      { code: "300", name: "Opposing Target", kind: "monster", typeFlags: 0x21 },
    ];
    const session = createDuel({ seed: 58, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["300"] },
    });
    startDuel(session);
    const trap = session.state.cards.find((card) => card.code === "100");
    const ownTarget = session.state.cards.find((card) => card.code === "200");
    const opposingTarget = session.state.cards.find((card) => card.code === "300");
    expect(trap).toBeDefined();
    expect(ownTarget).toBeDefined();
    expect(opposingTarget).toBeDefined();
    trap!.location = "spellTrapZone";
    trap!.sequence = 0;
    trap!.faceUp = true;
    ownTarget!.location = "monsterZone";
    ownTarget!.sequence = 0;
    ownTarget!.faceUp = true;
    opposingTarget!.location = "monsterZone";
    opposingTarget!.sequence = 0;
    opposingTarget!.faceUp = true;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local trap = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_SZONE, 0, 1, 1, nil):GetFirst()
      local own = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local opp = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, 0, LOCATION_MZONE, 1, 1, nil):GetFirst()
      local e1,e2=aux.AddPersistentProcedure(trap,0,aux.FilterBoolFunction(Card.IsFaceup),CATEGORY_DISABLE,EFFECT_FLAG_DAMAGE_STEP,TIMING_DAMAGE_STEP,TIMINGS_CHECK_MONSTER)
      Debug.Message("persistent proc metadata " .. e1:GetDescription() .. "/" .. e1:GetCategory() .. "/" .. e1:GetProperty() .. "/" .. e1:GetCode())
      Debug.Message("persistent follow metadata " .. e2:GetType() .. "/" .. e2:GetRange() .. "/" .. e2:GetCode() .. "/" .. tostring(e2:GetLabelObject()==e1))
      Debug.Message("persistent target check " .. tostring(e1:GetTarget()(e1,0,nil,0,0,nil,0,0,0)))
      Debug.Message("persistent relation before " .. tostring(aux.PersistentTargetFilter(e1,own)) .. "/" .. tostring(aux.PersistentTargetFilter(e1,opp)))
      Card.SetCardTarget(trap,own)
      Debug.Message("persistent relation after " .. tostring(aux.PersistentTargetFilter(e1,own)) .. "/" .. tostring(aux.PersistentTargetFilter(e1,opp)))
      `,
      "persistent-procedure.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("persistent proc metadata 1068/16384/16400/1002");
    expect(host.messages).toContain("persistent follow metadata 2050/8/1022/true");
    expect(host.messages).toContain("persistent target check true");
    expect(host.messages).toContain("persistent relation before false/false");
    expect(host.messages).toContain("persistent relation after true/false");
  });

  it("registers Lua union procedures and union status helpers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Union Monster", kind: "monster", typeFlags: 0x400001 },
      { code: "200", name: "Union Target", kind: "monster", typeFlags: 0x21 },
      { code: "300", name: "Equipped Union", kind: "monster", typeFlags: 0x400001 },
    ];
    const session = createDuel({ seed: 59, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);
    const union = session.state.cards.find((card) => card.code === "100");
    const target = session.state.cards.find((card) => card.code === "200");
    const equipped = session.state.cards.find((card) => card.code === "300");
    expect(union).toBeDefined();
    expect(target).toBeDefined();
    expect(equipped).toBeDefined();
    union!.location = "monsterZone";
    union!.sequence = 0;
    union!.faceUp = true;
    target!.location = "monsterZone";
    target!.sequence = 1;
    target!.faceUp = true;
    equipped!.location = "spellTrapZone";
    equipped!.sequence = 0;
    equipped!.faceUp = true;
    equipped!.equippedToUid = target!.uid;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local union = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local equipped = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_SZONE, 0, 1, 1, nil):GetFirst()
      local e1,e2,e3,e4=aux.AddUnionProcedure(union,aux.FilterBoolFunction(Card.IsFaceup),true,false)
      Debug.Message("union proc metadata " .. e1:GetDescription() .. "/" .. e1:GetCategory() .. "/" .. e1:GetProperty() .. "/" .. e1:GetRange() .. "/" .. e2:GetDescription() .. "/" .. e3:GetCode() .. "/" .. e4:GetCode())
      Debug.Message("union proc callbacks " .. tostring(e1:GetTarget()~=nil) .. "/" .. tostring(e1:GetOperation()~=nil) .. "/" .. tostring(e2:GetCondition()~=nil) .. "/" .. tostring(e3:GetValue()~=nil))
      Debug.Message("union state before " .. tostring(aux.IsUnionState(e1)))
      aux.SetUnionState(union)
      Debug.Message("union state after " .. tostring(aux.IsUnionState(e1)) .. "/" .. tostring(union:IsHasEffect(EFFECT_EQUIP_LIMIT)~=nil))
      aux.SetUnionState(equipped)
      local old_count,new_count=Card.GetUnionCount(target)
      Debug.Message("union count " .. old_count .. "/" .. new_count)
      Debug.Message("union equip checks " .. tostring(aux.CheckUnionEquip(union,target)) .. "/" .. tostring(aux.CheckUnionEquip(equipped,target)))
      `,
      "union-procedure.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("union proc metadata 1068/262144/16/4/2/45/78");
    expect(host.messages).toContain("union proc callbacks true/true/true/true");
    expect(host.messages).toContain("union state before false");
    expect(host.messages).toContain("union state after true/true");
    expect(host.messages).toContain("union count 0/1");
    expect(host.messages).toContain("union equip checks true/false");
  });

  it("creates Mysterune quick-play effect metadata", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Runick Probe", kind: "spell" }];
    const session = createDuel({ seed: 161, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.GetFieldCard(0,LOCATION_HAND,0)
      local e1=Effect.CreateMysteruneQPEffect(c,31562086,CATEGORY_SEARCH,function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return true end
        e:SetDescription(77)
      end,function(e,tp,eg,ep,ev,re,r,rp)
        Debug.Message("mysterune op")
        return true
      end,1,EFFECT_FLAG_CARD_TARGET)
      local limit,limit_code=e1:GetCountLimit()
      Debug.Message("mysterune base " .. e1:GetType() .. "/" .. e1:GetCode() .. "/" .. limit .. "/" .. limit_code .. "/" .. tostring(e1:GetTarget()~=nil) .. "/" .. tostring(e1:GetOperation()~=nil))
      e1:GetTarget()(e1,0,Group.CreateGroup(),0,0,nil,0,0,1)
      Debug.Message("mysterune unique " .. e1:GetCategory() .. "/" .. e1:GetProperty() .. "/" .. e1:GetDescription())
      local e0,e2=Effect.CreateMysteruneQPEffect(c,66712905,CATEGORY_TOGRAVE,nil,nil,2,EFFECT_FLAG_DELAY,EVENT_TO_HAND)
      local unique_limit,unique_code=e0:GetCountLimit()
      local summon_limit,summon_code=e2:GetCountLimit()
      Debug.Message("mysterune split " .. e0:GetDescription() .. "/" .. e0:GetCategory() .. "/" .. e0:GetCode() .. "/" .. unique_limit .. "/" .. unique_code)
      Debug.Message("mysterune summon " .. e2:GetDescription() .. "/" .. e2:GetCategory() .. "/" .. e2:GetCode() .. "/" .. summon_limit .. "/" .. summon_code)
      `,
      "mysterune-effect.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("mysterune base 16/1002/1/31562086/true/true");
    expect(host.messages).toContain(`mysterune unique ${0x20000 | 0x4}/${0x10}/77`);
    expect(host.messages).toContain(`mysterune split ${66712905 * 16}/${0x20 | 0x4}/1012/1/66712905`);
    expect(host.messages).toContain(`mysterune summon ${66712905 * 16 + 1}/${0x200}/1002/1/66712905`);
  });

  it("checks active effect type metadata for qli filters", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Qli Source", kind: "monster", level: 6, typeFlags: 0x1 },
      { code: "200", name: "Low Monster", kind: "monster", level: 4, typeFlags: 0x1 },
      { code: "300", name: "High Monster", kind: "monster", level: 8, typeFlags: 0x1 },
      { code: "400", name: "Xyz Monster", kind: "extra", level: 3, typeFlags: 0x800001 },
      { code: "500", name: "Link Monster", kind: "extra", level: 2, typeFlags: 0x4000001 },
      { code: "600", name: "Spell", kind: "spell", typeFlags: 0x2 },
    ];
    const session = createDuel({ seed: 162, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "600"], extra: ["400", "500"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local qli=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,100),0,LOCATION_HAND,0,nil)
      local low=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,200),0,LOCATION_HAND,0,nil)
      local high=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,300),0,LOCATION_HAND,0,nil)
      local spell=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,600),0,LOCATION_HAND,0,nil)
      local xyz=Duel.GetFieldCard(0,LOCATION_EXTRA,0)
      local link=Duel.GetFieldCard(0,LOCATION_EXTRA,1)
      local e=Effect.CreateEffect(qli)
      local low_effect=Effect.CreateEffect(low)
      low_effect:SetType(EFFECT_TYPE_ACTIVATE)
      local high_effect=Effect.CreateEffect(high)
      high_effect:SetType(EFFECT_TYPE_ACTIVATE)
      local xyz_effect=Effect.CreateEffect(xyz)
      xyz_effect:SetType(EFFECT_TYPE_ACTIVATE)
      local link_effect=Effect.CreateEffect(link)
      link_effect:SetType(EFFECT_TYPE_ACTIVATE)
      local spell_effect=Effect.CreateEffect(spell)
      spell_effect:SetType(EFFECT_TYPE_ACTIVATE)
      local inactive=Effect.CreateEffect(low)
      Debug.Message("active type " .. tostring(low_effect:IsActiveType(TYPE_MONSTER)) .. "/" .. tostring(spell_effect:IsActiveType(TYPE_MONSTER)) .. "/" .. tostring(low_effect:IsActivated()) .. "/" .. tostring(inactive:IsActivated()))
      Debug.Message("qli filter " .. tostring(aux.qlifilter(e,low_effect)) .. "/" .. tostring(aux.qlifilter(e,high_effect)) .. "/" .. tostring(aux.qlifilter(e,xyz_effect)) .. "/" .. tostring(aux.qlifilter(e,link_effect)) .. "/" .. tostring(aux.qlifilter(e,spell_effect)) .. "/" .. tostring(aux.qlifilter(e,inactive)))
      `,
      "qli-filter.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("active type true/false/true/false");
    expect(host.messages).toContain("qli filter true/false/true/false/false/false");
  });

  it("lets Lua effects clone metadata and override callbacks independently", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Clone Source", kind: "monster" },
      { code: "200", name: "Other Card", kind: "monster" },
    ];
    const session = createDuel({ seed: 27, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetDescription(111)
        e:SetLabel(5)
        e:SetValue(10)
        e:SetOperation(function(e,c)
          Debug.Message("base op " .. e:GetDescription() .. "/" .. e:GetLabel() .. "/" .. e:GetValue() .. "/" .. e:GetActivateLocation() .. "/" .. e:GetActivateSequence())
        end)
        local e2=e:Clone()
        Debug.Message("clone initial " .. e2:GetDescription() .. "/" .. e2:GetLabel() .. "/" .. e2:GetValue() .. "/" .. e2:GetRange() .. "/" .. e2:GetOwner():GetCode() .. "/" .. e2:GetActivateLocation() .. "/" .. e2:GetActivateSequence())
        e2:SetDescription(222)
        e2:SetLabel(9)
        e2:SetValue(20)
        e2:SetOperation(function(e,c)
          Debug.Message("clone op " .. e:GetDescription() .. "/" .. e:GetLabel() .. "/" .. e:GetValue() .. "/" .. e:GetActivateLocation() .. "/" .. e:GetActivateSequence())
        end)
        c:RegisterEffect(e)
        c:RegisterEffect(e2)
      end
      `,
      "effect-clone.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(host.messages).toContain("clone initial 111/5/10/2/100/2/0");
    expect(session.state.effects).toHaveLength(2);
    expect(session.state.effects[0]).toMatchObject({ description: 111, range: ["hand"], registryKey: "lua:100:lua-1" });
    expect(session.state.effects[1]).toMatchObject({ description: 222, range: ["hand"], registryKey: "lua:100:lua-2" });

    const baseAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === session.state.effects[0]?.id);
    expect(baseAction).toBeDefined();
    expect(applyResponse(session, baseAction!).ok).toBe(true);
    const cloneAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === session.state.effects[1]?.id);
    expect(cloneAction).toBeDefined();
    expect(applyResponse(session, cloneAction!).ok).toBe(true);

    expect(host.messages).toContain("base op 111/5/10/2/0");
    expect(host.messages).toContain("clone op 222/9/20/2/0");
  });

  it("stores Lua effect owner player metadata and deletes registered effects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Lifecycle Source", kind: "monster" }];
    const session = createDuel({ seed: 28, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOwnerPlayer(1)
        Debug.Message("owner player " .. e:GetOwnerPlayer())
        c:RegisterEffect(e)
        local e2=e:Clone()
        e2:SetOwnerPlayer(0)
        e2:SetOperation(function(e,c)
          Debug.Message("deleted clone should not resolve")
        end)
        c:RegisterEffect(e2)
        Debug.Message("clone owner " .. e2:GetOwnerPlayer())
        e2:Delete()
      end
      `,
      "effect-lifecycle.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(host.messages).toContain("owner player 1");
    expect(host.messages).toContain("clone owner 0");
    expect(session.state.effects).toHaveLength(1);
    expect(session.state.effects[0]).toMatchObject({ controller: 1, ownerPlayer: 1 });
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "activateEffect")).toBe(false);
  });

  it("passes chk values to upstream-style Lua cost and target callbacks", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Check Source", kind: "monster" },
      { code: "200", name: "Check Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 29, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetCost(function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then
            Debug.Message("cost check " .. tp)
            return true
          end
          Debug.Message("cost activate " .. chk)
          return true
        end)
        e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then
            Debug.Message("target check " .. tp)
            return Duel.IsExistingMatchingCard(aux.FilterBoolFunction(Card.IsCode, 200), tp, LOCATION_HAND, 0, 1, e:GetHandler())
          end
          Debug.Message("target activate " .. chk)
          local g=Duel.SelectTarget(tp, aux.FilterBoolFunction(Card.IsCode, 200), tp, LOCATION_HAND, 0, 1, 1, e:GetHandler())
          Duel.SetOperationInfo(0, CATEGORY_TOHAND, g, g:GetCount(), tp, 0)
          return true
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("operation target " .. Duel.GetFirstTarget():GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "effect-chk.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    expect(host.messages).toContain("cost check 0");
    expect(host.messages).toContain("target check 0");
    expect(host.messages).not.toContain("target activate 0");
    expect(applyResponse(session, action!).ok).toBe(true);
    expect(host.messages).toContain("cost activate 1");
    expect(host.messages).toContain("target activate 1");
    expect(host.messages).toContain("operation target 200");
  });

  it("lets Rush equip target checks call activation target filters", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Rush Equip", kind: "spell", typeFlags: 0x40002 },
      { code: "200", name: "Valid Equip Target", kind: "monster" },
      { code: "300", name: "Invalid Equip Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 101, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand")) {
      if (card.code === "100") moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
      else moveDuelCard(session.state, card.uid, "monsterZone", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local equip=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_SZONE, 0, 1, 1, nil):GetFirst()
      local valid=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local invalid=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local e=Effect.CreateEffect(equip)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk,monster)
        return monster~=nil and monster:IsCode(200) and tp==0
      end)
      equip:RegisterEffect(e)
      Debug.Message("activate effect " .. tostring(equip:GetActivateEffect()~=nil))
      Debug.Message("rush equip target " .. tostring(Card.CheckEquipTargetRush(equip,valid)) .. "/" .. tostring(Card.CheckEquipTargetRush(equip,invalid)))
      `,
      "rush-equip-target-check.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("activate effect true");
    expect(host.messages).toContain("rush equip target true/false");
  });

  it("registers Rush no-tribute check effects for cards and players", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "No Tribute Source", kind: "monster" }];
    const session = createDuel({ seed: 102, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);
    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(source).toBeTruthy();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local e1=c:AddNoTributeCheck(160001029,1,1,0)
      local self_range,opp_range=e1:GetTargetRange()
      local reset,reset_count=e1:GetReset()
      Debug.Message("card no tribute " .. e1:GetCode() .. "/" .. e1:GetDescription() .. "/" .. self_range .. "/" .. opp_range .. "/" .. reset_count .. "/" .. tostring(e1:IsHasProperty(EFFECT_FLAG_CLIENT_HINT)))
      local e2=Duel.AddNoTributeCheck(c,0,160001029,2,0,1)
      local player_effect=Duel.IsPlayerAffectedByEffect(1,FLAG_NO_TRIBUTE)
      local self2,opp2=e2:GetTargetRange()
      Debug.Message("duel no tribute " .. tostring(player_effect~=nil) .. "/" .. self2 .. "/" .. opp2)
      `,
      "rush-no-tribute-check.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages.some((message) => message.startsWith("card no tribute 160001029/") && message.endsWith("/1/0/1/true"))).toBe(true);
    expect(host.messages).toContain("duel no tribute true/0/1");
  });

  it("shares Lua keyed count limits across effect copies", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Count Source", kind: "monster" }];
    const session = createDuel({ seed: 21, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "100"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetCountLimit(1, 700)
        e:SetOperation(function(e,c)
          Debug.Message("used " .. c:GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "keyed-count-limit.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    const firstAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(firstAction).toBeDefined();
    applyResponse(session, firstAction!);
    applyResponse(session, { type: "passChain", player: 1, label: "Pass" });
    applyResponse(session, { type: "passChain", player: 0, label: "Pass" });
    expect(host.messages).toContain("used 100");
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "activateEffect")).toBe(false);
  });

  it("lets Lua effects pass labels and label objects between callbacks", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Label Source", kind: "monster" },
      { code: "200", name: "Label Object", kind: "monster" },
    ];
    const session = createDuel({ seed: 17, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetLabel(7)
        e:SetTarget(function(e,c)
          Debug.Message("target label " .. e:GetLabel())
          e:SetLabel(e:GetLabel()+1)
          local g=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, c)
          e:SetLabelObject(g)
          return true
        end)
        e:SetOperation(function(e,c)
          local g=e:GetLabelObject()
          Debug.Message("operation label " .. e:GetLabel())
          Debug.Message("label object count " .. g:GetCount())
        end)
        c:RegisterEffect(e)
      end
      `,
      "effect-labels.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    applyResponse(session, action!);
    applyResponse(session, { type: "passChain", player: 1, label: "Pass" });
    applyResponse(session, { type: "passChain", player: 0, label: "Pass" });
    expect(host.messages).toContain("target label 7");
    expect(host.messages).toContain("operation label 8");
    expect(host.messages).toContain("label object count 1");
  });

  it("lets Lua effects share operation info between target and operation callbacks", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Operation Source", kind: "monster" },
      { code: "200", name: "Operation Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 20, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetTarget(function(e,c)
          Duel.Hint(HINT_SELECTMSG, 0, HINTMSG_TOHAND)
          local g=Duel.SelectTarget(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, c)
          Duel.SetOperationInfo(0, CATEGORY_TOHAND, g, g:GetCount(), 0, 0)
          Duel.SetPossibleOperationInfo(0, CATEGORY_DRAW, nil, 0, 1, 2)
          return true
        end)
        e:SetOperation(function(e,c)
          local ok,cat,g,count,p,param=Duel.GetOperationInfo(0, CATEGORY_TOHAND)
          Debug.Message("operation info " .. tostring(ok) .. "/" .. cat .. "/" .. g:GetCount() .. "/" .. count .. "/" .. p .. "/" .. param)
          local possible,pcat,pg,pcount,pp,pparam=Duel.GetPossibleOperationInfo(0, CATEGORY_DRAW)
          Debug.Message("possible operation info " .. tostring(possible) .. "/" .. pcat .. "/" .. pg:GetCount() .. "/" .. pcount .. "/" .. pp .. "/" .. pparam)
          local committed_draw=Duel.GetOperationInfo(0, CATEGORY_DRAW)
          Debug.Message("possible separate " .. tostring(committed_draw))
          Debug.Message("target relates " .. tostring(Duel.GetFirstTarget():IsRelateToEffect(e)))
          Duel.ClearOperationInfo(0, CATEGORY_TOHAND)
          Debug.Message("operation info cleared " .. tostring(Duel.GetOperationInfo(0, CATEGORY_TOHAND)))
          local possible_after_clear=Duel.GetPossibleOperationInfo(0, CATEGORY_DRAW)
          Debug.Message("possible still present " .. tostring(possible_after_clear))
        end)
        c:RegisterEffect(e)
      end
      `,
      "operation-info.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const sourceUid = session.state.cards.find((card) => card.code === "100" && card.owner === 0)?.uid;
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === sourceUid);
    expect(action).toBeDefined();
    applyResponse(session, action!);
    applyResponse(session, { type: "passChain", player: 1, label: "Pass" });
    applyResponse(session, { type: "passChain", player: 0, label: "Pass" });
    expect(host.messages).toContain("operation info true/8/1/1/0/0");
    expect(host.messages).toContain("possible operation info true/65536/0/0/1/2");
    expect(host.messages).toContain("possible separate false");
    expect(host.messages).toContain("target relates true");
    expect(host.messages).toContain("operation info cleared false");
    expect(host.messages).toContain("possible still present true");
  });

  it("lets Lua effects seed target cards without selecting", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Manual Target Source", kind: "monster" },
      { code: "200", name: "Manual Target A", kind: "monster" },
      { code: "300", name: "Manual Target B", kind: "monster" },
    ];
    const session = createDuel({ seed: 48, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then return true end
          local g=Duel.GetMatchingGroup(function(tc) return tc:IsCode(200) or tc:IsCode(300) end, tp, LOCATION_HAND, 0, e:GetHandler())
          Duel.SetTargetCard(g)
          Debug.Message("manual target set " .. Duel.GetTargetCards():GetCount() .. "/" .. Duel.GetTargetGroup():GetCount())
          local replacement=Duel.GetMatchingGroup(aux.FilterBoolFunction(Card.IsCode, 300), tp, LOCATION_HAND, 0, e:GetHandler())
          Duel.SetTargetCard(replacement)
          Debug.Message("manual target replaced " .. Duel.GetTargetGroup():GetCount() .. "/" .. Duel.GetFirstTarget():GetCode())
          Duel.ClearTargetCard()
          Debug.Message("manual target clear alias " .. Duel.GetTargetGroup():GetCount() .. "/" .. tostring(Duel.GetFirstTarget()==nil))
          Duel.SetTargetCard(g)
          Duel.SetTargetCard(nil)
          Debug.Message("manual target cleared " .. Duel.GetTargetCards():GetCount() .. "/" .. tostring(Duel.GetFirstTarget()==nil))
          Duel.SetTargetCard(g)
          return true
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          local tg=Duel.GetTargetGroup()
          Debug.Message("manual target cards " .. tg:GetCount() .. "/" .. Duel.GetFirstTarget():GetCode())
          local changed=Duel.GetMatchingGroup(aux.FilterBoolFunction(Card.IsCode, 300), tp, LOCATION_HAND, 0, e:GetHandler())
          Duel.ChangeTargetCard(changed)
          Debug.Message("manual target changed " .. Duel.GetTargetGroup():GetCount() .. "/" .. Duel.GetFirstTarget():GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "manual-target-card.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyResponse(session, action!);
    applyResponse(session, { type: "passChain", player: 1, label: "Pass" });
    applyResponse(session, { type: "passChain", player: 0, label: "Pass" });
    expect(host.messages).toContain("manual target set 2/2");
    expect(host.messages).toContain("manual target replaced 1/300");
    expect(host.messages).toContain("manual target clear alias 0/true");
    expect(host.messages).toContain("manual target cleared 0/true");
    expect(host.messages.join("\n")).toContain("manual target cards 2/");
    expect(host.messages).toContain("manual target changed 1/300");
  });
});
