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

  it("resets card effects by reset flag and effect code through Card.ResetEffect", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Card ResetEffect Source", kind: "monster" }];
    const session = createDuel({ seed: 97, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_SINGLE)
      e1:SetCode(EFFECT_UPDATE_ATTACK)
      e1:SetValue(500)
      e1:SetReset(RESET_EVENT|RESET_DISABLE)
      c:RegisterEffect(e1)
      local e2=Effect.CreateEffect(c)
      e2:SetType(EFFECT_TYPE_SINGLE)
      e2:SetCode(EFFECT_UPDATE_DEFENSE)
      e2:SetValue(600)
      c:RegisterEffect(e2)
      Debug.Message("reset effect before " .. tostring(c:IsHasEffect(EFFECT_UPDATE_ATTACK)~=nil) .. "/" .. tostring(c:IsHasEffect(EFFECT_UPDATE_DEFENSE)~=nil))
      c:ResetEffect(RESET_DISABLE, RESET_EVENT)
      Debug.Message("reset effect after flag " .. tostring(c:IsHasEffect(EFFECT_UPDATE_ATTACK)~=nil) .. "/" .. tostring(c:IsHasEffect(EFFECT_UPDATE_DEFENSE)~=nil))
      c:ResetEffect(EFFECT_UPDATE_DEFENSE, RESET_CODE)
      Debug.Message("reset effect after code " .. tostring(c:IsHasEffect(EFFECT_UPDATE_ATTACK)~=nil) .. "/" .. tostring(c:IsHasEffect(EFFECT_UPDATE_DEFENSE)~=nil))
      `,
      "card-reset-effect.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("reset effect before true/true");
    expect(host.messages).toContain("reset effect after flag false/true");
    expect(host.messages).toContain("reset effect after code false/false");
  });

  it("copies card effects and resets them by RESET_COPY copy id", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "CopyEffect Receiver", kind: "monster" }];
    const session = createDuel({ seed: 98, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_UPDATE_ATTACK)
        e:SetValue(700)
        c:RegisterEffect(e)
      end
      local receiver=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local copy_id=receiver:CopyEffect(200, RESET_EVENT|RESETS_STANDARD, 1)
      local copied=receiver:GetCardEffect(EFFECT_UPDATE_ATTACK)
      Debug.Message("copy effect id " .. tostring(copy_id>0))
      Debug.Message("copy effect found " .. tostring(copied~=nil) .. "/" .. copied:GetHandler():GetCode() .. "/" .. copied:GetReset())
      receiver:ResetEffect(copy_id, RESET_COPY)
      Debug.Message("copy effect reset " .. tostring(receiver:IsHasEffect(EFFECT_UPDATE_ATTACK)~=nil))
      `,
      "card-copy-effect.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("copy effect id true");
    expect(host.messages).toContain("copy effect found true/100/33427456");
    expect(host.messages).toContain("copy effect reset false");
    expect(session.state.effects.every((effect) => effect.copyId === undefined)).toBe(true);
  });

  it("loads copied card scripts through Card.CopyEffect", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "CopyEffect Source Load Receiver", kind: "monster" }];
    const session = createDuel({ seed: 99, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session, {
      readScript(name) {
        if (name !== "c201.lua") return undefined;
        return `
          c201={}
          function c201.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_SINGLE)
            e:SetCode(EFFECT_UPDATE_DEFENSE)
            e:SetValue(800)
            c:RegisterEffect(e)
          end
        `;
      },
    });
    const result = host.loadScript(
      `
      local receiver=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local copy_id=receiver:CopyEffect(201, RESET_EVENT|RESETS_STANDARD, 1)
      local copied=receiver:GetCardEffect(EFFECT_UPDATE_DEFENSE)
      Debug.Message("loaded copy effect " .. tostring(copy_id>0) .. "/" .. tostring(copied~=nil) .. "/" .. copied:GetValue())
      `,
      "card-copy-effect-load.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("loaded copy effect true/true/800");
  });

  it("does not re-offer face-up Spell/Trap card activations", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Persistent Field Spell", kind: "spell", typeFlags: 0x2 | 0x80000 }];
    const session = createDuel({ seed: 101, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local activate=Effect.CreateEffect(c)
      activate:SetType(EFFECT_TYPE_ACTIVATE)
      activate:SetCode(EVENT_FREE_CHAIN)
      c:RegisterEffect(activate)
      local ignition=Effect.CreateEffect(c)
      ignition:SetType(EFFECT_TYPE_IGNITION)
      ignition:SetRange(LOCATION_FZONE)
      ignition:SetOperation(function(e,tp) Debug.Message("field ignition resolved " .. tp) end)
      c:RegisterEffect(ignition)
      `,
      "persistent-spell-activation.lua",
    );
    expect(result.ok, result.error).toBe(true);

    const activation = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "lua-1-1002");
    expect(activation).toBeDefined();
    const activationResult = applyResponse(session, activation!);
    expect(activationResult.ok, activationResult.error).toBe(true);
    expect(session.state.cards.find((card) => card.code === "100")).toMatchObject({ location: "spellTrapZone", faceUp: true });

    const afterActivation = getDuelLegalActions(session, 0).filter((action) => action.type === "activateEffect");
    expect(afterActivation.some((action) => action.effectId === "lua-1-1002")).toBe(false);
    expect(afterActivation.some((action) => action.effectId === "lua-2")).toBe(true);
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

  it("registers Lua skill procedure startup effects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Skill Source", kind: "monster", race: 7 }];
    const session = createDuel({ seed: 84, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local e1=aux.AddSkillProcedure(c,2,true,function(e,tp) return tp==0 end,function(e,tp) Debug.Message("skill op " .. tp) end,1)
      local e2=aux.AddPreDrawSkillProcedure(c,3,2,nil,function(e,tp) Debug.Message("predraw op " .. tp) end,2)
      local e3,e4=aux.AddFieldSkillProcedure(c,4,false)
      local e5,e6=aux.AddContinuousSkillProcedure(c,5,true,true)
      Debug.Message("skill cover " .. aux.GetCover(c,2) .. "/" .. e1:GetLabel() .. "/" .. e2:GetCode() .. "/" .. e5:GetValue())
      Debug.Message("skill drawless " .. aux.Drawless[c])
      Debug.Message("skill field " .. e3:GetCountLimit() .. "/" .. e4:GetCode() .. "/" .. e6:GetCode())
      `,
      "skill-procedure.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("skill cover 302000007/302000007/1000/1");
    expect(host.messages).toContain("skill drawless 1");
    expect(host.messages).toContain("skill field 1/66/66");
    expect(session.state.effects.filter((effect) => effect.sourceUid === session.state.cards[0]?.uid)).toHaveLength(6);
  });

  it("registers Lua Vrains skill procedures and negation checks", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Vrains Skill", kind: "monster" }];
    const session = createDuel({ seed: 85, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local startup=aux.AddVrainsSkillProcedure(c,function(e,tp) return tp==0 end,function(e,tp) Debug.Message("vrains op " .. tp) return true end)
      Debug.Message("vrains startup " .. startup:GetCode() .. "/" .. startup:GetLabel())
      startup:GetOperation()(startup,0,Group.CreateGroup(),0,0,nil,0,0)
      local free=Duel.GetPlayerEffect(0,EVENT_FREE_CHAIN)
      local chain_end=Duel.GetPlayerEffect(0,EVENT_CHAIN_END)
      Debug.Message("vrains registered " .. tostring(free~=nil) .. "/" .. tostring(chain_end~=nil) .. "/" .. free:GetCode() .. "/" .. chain_end:GetCode())
      local negate=Effect.CreateEffect(c)
      negate:SetType(EFFECT_TYPE_FIELD)
      negate:SetCode(EFFECT_NEGATE_SKILL)
      negate:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
      negate:SetTargetRange(0,1)
      negate:SetCondition(function(e,tp,target) return true end)
      negate:SetOperation(function(e,tp,target) Debug.Message("negate target " .. target:GetCode()) return true end)
      c:RegisterEffect(negate)
      Debug.Message("skill negation " .. tostring(aux.CheckSkillNegation(free,0)))
      `,
      "vrains-skill-procedure.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("vrains startup 1000/300000001");
    expect(host.messages).toContain("vrains registered true/true/1002/1026");
    expect(host.messages).toContain("negate target 1002");
    expect(host.messages).toContain("skill negation true");
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
      local setcodes=c:AddSetcodesRule(100,true,0x123,0x456)
      local piercing=c:AddPiercing(RESETS_STANDARD_PHASE_END,c,function(e) return true end,EFFECT_FLAG_OATH)
      local side_grant=c:AddCenterToSideEffectHandler(maximum_atk)
      source:AddSideMaximumHandler(maximum_atk)
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
      local first_synchro=extra:AddMustFirstBeSynchroSummoned()
      local must_xyz=c:AddMustBeXyzSummoned()
      local first_xyz=extra:AddMustFirstBeXyzSummoned()
      local must_link=c:AddMustBeLinkSummoned()
      local first_link=extra:AddMustFirstBeLinkSummoned()
      local must_pendulum=c:AddMustBePendulumSummoned()
      local first_pendulum=c:AddMustFirstBePendulumSummoned()
      local cannot_normal=c:AddCannotBeNormalSummoned()
      local cannot_flip=c:AddCannotBeFlipSummoned()
      local gemini=c:EnableGeminiStatus()
      local gemini_state=c:EnableGeminiState()
      Debug.Message("double tribute available " .. tostring(c:CanBeDoubleTribute(FLAG_DOUBLE_TRIB_WINGEDBEAST,FLAG_DOUBLE_TRIB_LIGHT)))
      c:AddDoubleTribute(160005033,aux.TRUE,aux.TRUE,0,FLAG_DOUBLE_TRIB_WINGEDBEAST,FLAG_DOUBLE_TRIB_LIGHT)
      Debug.Message("double tribute unavailable " .. tostring(c:CanBeDoubleTribute(FLAG_DOUBLE_TRIB_WINGEDBEAST,FLAG_DOUBLE_TRIB_LIGHT)))
      Debug.Message("double tribute flags " .. tostring(c:IsDoubleTribute(FLAG_DOUBLE_TRIB_WINGEDBEAST,FLAG_DOUBLE_TRIB_LIGHT)) .. "/" .. tostring(c:IsDoubleTribute(FLAG_DOUBLE_TRIB_WINGEDBEAST,FLAG_DOUBLE_TRIB_MACHINE)))
      c:RegisterFlagEffect(c:GetOriginalCode(),RESET_EVENT,0,1)
      local min,max=c:GetTributeRequirement()
      Debug.Message("card proc codes " .. revive:GetCode() .. "/" .. cannot:GetCode() .. "/" .. must:GetCode() .. "/" .. must_by_effect:GetCode() .. "/" .. must_dark_fusion:GetCode() .. "/" .. must_fusion:GetCode() .. "/" .. must_ritual:GetCode() .. "/" .. must_synchro:GetCode() .. "/" .. must_xyz:GetCode() .. "/" .. must_link:GetCode() .. "/" .. must_pendulum:GetCode() .. "/" .. cannot_normal:GetCode() .. "/" .. cannot_flip:GetCode() .. "/" .. gemini:GetCode() .. "/" .. gemini_state:GetCode() .. "/" .. maximum_atk:GetCode())
      Debug.Message("card proc effects " .. tostring(c:IsHasEffect(EFFECT_REVIVE_LIMIT)~=nil) .. "/" .. tostring(c:IsHasEffect(EFFECT_SPSUMMON_CONDITION)~=nil) .. "/" .. tostring(c:IsHasEffect(EFFECT_CANNOT_SUMMON)~=nil) .. "/" .. tostring(c:IsHasEffect(EFFECT_CANNOT_FLIP_SUMMON)~=nil) .. "/" .. tostring(c:IsHasEffect(EFFECT_GEMINI_STATUS)~=nil) .. "/" .. tostring(c:IsGeminiStatus()) .. "/" .. tostring(c:IsGeminiState()))
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
      Debug.Message("first synchro limit " .. tostring(first_synchro:GetValue()(first_synchro,nil,0,SUMMON_TYPE_SYNCHRO)) .. "/" .. tostring(first_synchro:GetValue()(first_synchro,nil,0,SUMMON_TYPE_LINK)))
      Debug.Message("xyz summon limit " .. tostring(must_xyz:GetValue()(nil,nil,0,SUMMON_TYPE_XYZ)) .. "/" .. tostring(must_xyz:GetValue()(nil,nil,0,SUMMON_TYPE_SYNCHRO)))
      Debug.Message("first xyz limit " .. tostring(first_xyz:GetValue()(first_xyz,nil,0,SUMMON_TYPE_XYZ)) .. "/" .. tostring(first_xyz:GetValue()(first_xyz,nil,0,SUMMON_TYPE_FUSION)))
      Debug.Message("link summon limit " .. tostring(must_link:GetValue()(nil,nil,0,SUMMON_TYPE_LINK)) .. "/" .. tostring(must_link:GetValue()(nil,nil,0,SUMMON_TYPE_FUSION)))
      Debug.Message("first link limit " .. tostring(first_link:GetValue()(first_link,nil,0,SUMMON_TYPE_LINK)) .. "/" .. tostring(first_link:GetValue()(first_link,nil,0,SUMMON_TYPE_FUSION)))
      Debug.Message("pendulum summon limit " .. tostring(must_pendulum:GetValue()(nil,nil,0,SUMMON_TYPE_PENDULUM)) .. "/" .. tostring(must_pendulum:GetValue()(nil,nil,0,SUMMON_TYPE_LINK)))
      Debug.Message("first pendulum limit " .. tostring(first_pendulum:GetValue()(first_pendulum,nil,0,SUMMON_TYPE_FUSION)) .. "/" .. tostring(first_pendulum:GetValue()(first_pendulum,nil,0,SUMMON_TYPE_PENDULUM)))
      Debug.Message("maximum atk handler " .. maximum_atk:GetValue() .. "/" .. maximum_atk:GetRange() .. "/" .. tostring(maximum_atk:GetCondition()(maximum_atk)))
      local first_setcode=math.min(setcodes[1]:GetValue(),setcodes[2]:GetValue())
      local second_setcode=math.max(setcodes[1]:GetValue(),setcodes[2]:GetValue())
      Debug.Message("setcodes rule " .. #setcodes .. "/" .. setcodes[1]:GetCode() .. "/" .. first_setcode .. "/" .. second_setcode .. "/" .. tostring(setcodes[1]:GetCondition()(setcodes[1])))
      local piercing_reset,piercing_reset_count=piercing:GetReset()
      Debug.Message("piercing rule " .. piercing:GetCode() .. "/" .. piercing:GetDescription() .. "/" .. piercing:GetProperty() .. "/" .. piercing_reset_count .. "/" .. tostring(piercing:GetCondition()(piercing)))
      local grant_self,grant_opp=side_grant:GetTargetRange()
      Debug.Message("center side grant " .. side_grant:GetType() .. "/" .. side_grant:GetRange() .. "/" .. grant_self .. "/" .. grant_opp .. "/" .. tostring(side_grant:GetLabelObject()==maximum_atk) .. "/" .. tostring(side_grant:GetCondition()(side_grant)) .. "/" .. tostring(side_grant:GetTarget()(side_grant,c)))
      local side_base=source:GetCardEffect(EFFECT_SET_BASE_ATTACK)
      local side_material=source:GetCardEffect(EFFECT_CANNOT_BE_MATERIAL)
      local side_def=source:GetCardEffect(EFFECT_UPDATE_DEFENSE)
      Debug.Message("side maximum effects " .. tostring(side_base~=nil) .. "/" .. tostring(source:GetCardEffect(EFFECT_CHANGE_LEVEL)~=nil) .. "/" .. tostring(source:GetCardEffect(EFFECT_CANNOT_ATTACK)~=nil) .. "/" .. tostring(side_material~=nil) .. "/" .. tostring(source:GetCardEffect(EFFECT_SELF_DESTROY)~=nil) .. "/" .. side_def:GetValue())
      Debug.Message("side maximum callbacks " .. tostring(side_base:GetCondition()(side_base)) .. "/" .. tostring(side_base:GetValue()(side_base,c)) .. "/" .. tostring(side_material:GetValue()(nil,nil,SUMMON_TYPE_FUSION,0)) .. "/" .. tostring(side_material:GetValue()(nil,nil,SUMMON_TYPE_RITUAL,0)))
      Debug.Message("double tribute proc " .. c:GetFlagEffect(FLAG_HAS_DOUBLE_TRIBUTE) .. "/" .. c:GetFlagEffect(FLAG_DOUBLE_TRIB_WINGEDBEAST) .. "/" .. c:GetFlagEffect(FLAG_DOUBLE_TRIB_LIGHT) .. "/" .. tostring(c:IsHasEffect(EFFECT_SUMMON_PROC)~=nil))
      Debug.Message("card proc queries " .. min .. "/" .. max .. "/" .. c:GetMaximumAttack() .. "/" .. tostring(c:IsLegend()) .. "/" .. source:GetToBeLinkedZone(target,0,true) .. "/" .. tostring(c:IsNouvellesSummoned()))
      `,
      "card-procedure-status.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("card proc codes 31/30/30/30/30/30/30/30/30/30/30/20/21/75/75/103");
    expect(host.messages).toContain("card proc effects true/true/true/true/true/true/true");
    expect(host.messages).toContain("card effect summon limit true/false");
    expect(host.messages).toContain("dark fusion proc true/true/function");
    expect(host.messages).toContain("fusion summon limit true/false");
    expect(host.messages).toContain("first fusion limit true/false");
    expect(host.messages).toContain("ritual summon limit true/false");
    expect(host.messages).toContain("first ritual limit false/true");
    expect(host.messages).toContain("synchro summon limit true/false");
    expect(host.messages).toContain("first synchro limit true/false");
    expect(host.messages).toContain("xyz summon limit true/false");
    expect(host.messages).toContain("first xyz limit true/false");
    expect(host.messages).toContain("link summon limit true/false");
    expect(host.messages).toContain("first link limit true/false");
    expect(host.messages).toContain("pendulum summon limit true/false");
    expect(host.messages).toContain("first pendulum limit false/true");
    expect(host.messages).toContain("maximum atk handler 3900/4/false");
    expect(host.messages).toContain("setcodes rule 2/334/291/1110/true");
    expect(host.messages).toContain("piercing rule 203/3208/67633152/0/true");
    expect(host.messages).toContain("center side grant 8194/4/4/0/true/false/false");
    expect(host.messages).toContain("side maximum effects true/true/true/true/false/-1000000");
    expect(host.messages).toContain("side maximum callbacks nil/nil/true/false");
    expect(host.messages).toContain("double tribute available true");
    expect(host.messages).toContain("double tribute unavailable false");
    expect(host.messages).toContain("double tribute flags true/false");
    expect(host.messages.some((message) => message.startsWith("double tribute proc 1/1/1/"))).toBe(true);
    expect(host.messages).toContain("card proc queries 2/2/3900/true/4/true");
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

  it("classifies Lua effect cost helper families", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Cost Metadata Source", kind: "monster", typeFlags: 0x1 },
      { code: "200", name: "Spell Cost Metadata Source", kind: "spell", typeFlags: 0x2 },
      { code: "300", name: "Trap Cost Metadata Source", kind: "trap", typeFlags: 0x4 },
    ];
    const session = createDuel({ seed: 166, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local spell=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local trap=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local detach=Effect.CreateEffect(c)
      detach:SetCost(Cost.DetachFromSelf(1))
      local spell_effect=Effect.CreateEffect(spell)
      local trap_effect=Effect.CreateEffect(trap)
      local remain=Effect.CreateEffect(c)
      remain:SetCost(aux.RemainFieldCost)
      local to_grave=Effect.CreateEffect(c)
      to_grave:SetCost(Cost.SelfToGrave)
      local discard=Effect.CreateEffect(c)
      discard:SetCost(Cost.SelfDiscard)
      local discard_grave=Effect.CreateEffect(c)
      discard_grave:SetCost(Cost.SelfDiscardToGrave)
      local change_pos=Effect.CreateEffect(c)
      change_pos:SetCost(Cost.SelfChangePosition(POS_FACEUP_DEFENSE))
      local custom=Effect.CreateEffect(c)
      custom:SetCost(function() return true end)
      Debug.Message("cost families detach " .. tostring(detach:HasDetachCost()) .. "/" .. tostring(detach:HasRemainFieldCost()))
      Debug.Message("cost families remain " .. tostring(remain:HasDetachCost()) .. "/" .. tostring(remain:HasRemainFieldCost()))
      Debug.Message("cost families to grave " .. tostring(to_grave:HasSelfToGraveCost()) .. "/" .. tostring(to_grave:HasSelfDiscardCost()))
      Debug.Message("cost families discard " .. tostring(discard:HasSelfToGraveCost()) .. "/" .. tostring(discard:HasSelfDiscardCost()) .. "/" .. tostring(discard:HasSelfChangePositionCost()))
      Debug.Message("cost families discard grave " .. tostring(discard_grave:HasSelfToGraveCost()) .. "/" .. tostring(discard_grave:HasSelfDiscardCost()))
      Debug.Message("cost families change position " .. tostring(change_pos:HasSelfDiscardCost()) .. "/" .. tostring(change_pos:HasSelfChangePositionCost()))
      Debug.Message("cost families active type " .. tostring(detach:IsMonsterEffect()) .. "/" .. tostring(detach:IsSpellEffect()) .. "/" .. tostring(spell_effect:IsSpellEffect()) .. "/" .. tostring(spell_effect:IsSpellTrapEffect()) .. "/" .. tostring(trap_effect:IsTrapEffect()) .. "/" .. tostring(trap_effect:IsSpellTrapEffect()))
      Debug.Message("cost families custom " .. tostring(custom:HasDetachCost()) .. "/" .. tostring(custom:HasRemainFieldCost()) .. "/" .. tostring(custom:HasSelfToGraveCost()) .. "/" .. tostring(custom:HasSelfDiscardCost()) .. "/" .. tostring(custom:HasSelfChangePositionCost()))
      `,
      "effect-cost-families.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("cost families detach true/false");
    expect(host.messages).toContain("cost families remain false/true");
    expect(host.messages).toContain("cost families to grave true/false");
    expect(host.messages).toContain("cost families discard false/true/false");
    expect(host.messages).toContain("cost families discard grave true/true");
    expect(host.messages).toContain("cost families change position false/true");
    expect(host.messages).toContain("cost families active type true/false/true/true/true/true");
    expect(host.messages).toContain("cost families custom false/false/false/false/false");
  });

  it("reports Lua effect active card types", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Active Type Monster", kind: "monster", typeFlags: 0x21 },
      { code: "200", name: "Active Type Spell", kind: "spell" },
      { code: "300", name: "Active Type Continuous Trap", kind: "trap", typeFlags: 0x20004 },
    ];
    const session = createDuel({ seed: 167, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local monster=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local spell=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local trap=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local monster_effect=Effect.CreateEffect(monster)
      local spell_effect=Effect.CreateEffect(spell)
      local trap_effect=Effect.CreateEffect(trap)
      local global_effect=Effect.GlobalEffect()
      Debug.Message("active type values " .. monster_effect:GetActiveType() .. "/" .. spell_effect:GetActiveType() .. "/" .. trap_effect:GetActiveType() .. "/" .. global_effect:GetActiveType())
      Debug.Message("active type checks " .. tostring(monster_effect:IsActiveType(TYPE_MONSTER)) .. "/" .. tostring(spell_effect:IsActiveType(TYPE_SPELL)) .. "/" .. tostring(trap_effect:GetActiveType()==TYPE_TRAP) .. "/" .. tostring(trap_effect:IsActiveType(TYPE_CONTINUOUS)))
      `,
      "effect-active-type.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("active type values 33/2/131076/0");
    expect(host.messages).toContain("active type checks true/true/false/true");
  });

  it("enforces Lua special summon condition helpers during summon legality", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Fusion-Locked Hand Monster", kind: "monster" },
      { code: "200", name: "First Fusion Material", kind: "monster" },
      { code: "900", name: "Fusion-Locked Extra Monster", kind: "extra", fusionMaterials: ["100", "200"] },
    ];
    const session = createDuel({ seed: 168, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"], extra: ["900"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local hand_monster=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local material=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local fusion=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_EXTRA, 0, 1, 1, nil):GetFirst()
      hand_monster:AddMustBeFusionSummoned()
      fusion:AddMustBeFusionSummoned()
      Debug.Message("fusion condition generic " .. tostring(hand_monster:IsSpecialSummonable()))
      Debug.Message("fusion condition generic result " .. Duel.SpecialSummon(hand_monster,0,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("fusion condition hand location " .. tostring(hand_monster:IsLocation(LOCATION_HAND)))
      local materials=Group.FromCards(hand_monster,material)
      Debug.Message("fusion condition fusion result " .. Duel.FusionSummon(fusion,materials))
      Debug.Message("fusion condition fusion state " .. tostring(fusion:IsLocation(LOCATION_MZONE)) .. "/" .. tostring(fusion:IsFusionSummoned()))
      `,
      "special-summon-condition-legality.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("fusion condition generic false");
    expect(host.messages).toContain("fusion condition generic result 0");
    expect(host.messages).toContain("fusion condition hand location true");
    expect(host.messages).toContain("fusion condition fusion result 1");
    expect(host.messages).toContain("fusion condition fusion state true/true");
  });

  it("allows Lua card-effect-only special summon conditions from activating effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Card Effect Only Monster", kind: "monster" },
      { code: "200", name: "Summon Effect Source", kind: "monster" },
    ];
    const session = createDuel({ seed: 169, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local locked=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local source=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      locked:AddMustBeSpecialSummonedByCardEffect()
      Debug.Message("card effect condition generic " .. tostring(locked:IsSpecialSummonable()))
      local e=Effect.CreateEffect(source)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
        Debug.Message("card effect condition operation " .. Duel.SpecialSummon(locked,0,tp,tp,false,false,POS_FACEUP_ATTACK))
      end)
      source:RegisterEffect(e)
      Debug.Message("card effect condition activate " .. tostring(Duel.Activate(e)))
      Debug.Message("card effect condition state " .. tostring(locked:IsLocation(LOCATION_MZONE)) .. "/" .. tostring(locked:IsSpecialSummoned()))
      `,
      "card-effect-special-summon-condition.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("card effect condition generic false");
    expect(host.messages).toContain("card effect condition operation 1");
    expect(host.messages).toContain("card effect condition activate true");
    expect(host.messages).toContain("card effect condition state true/true");
  });

  it("enforces revive limits for unsummoned public-zone monsters", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "First Fusion Material", kind: "monster" },
      { code: "200", name: "Second Fusion Material", kind: "monster" },
      { code: "900", name: "Unsummoned Revive Limit Fusion", kind: "extra", fusionMaterials: ["100", "200"] },
      { code: "901", name: "Proper Revive Limit Fusion", kind: "extra", fusionMaterials: ["100", "200"] },
    ];
    const session = createDuel({ seed: 170, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"], extra: ["900", "901"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local mat1=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local mat2=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local unsummoned=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_EXTRA, 0, 1, 1, nil):GetFirst()
      local proper=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 901), 0, LOCATION_EXTRA, 0, 1, 1, nil):GetFirst()
      unsummoned:EnableReviveLimit()
      proper:EnableReviveLimit()
      Duel.SendtoGrave(unsummoned,REASON_EFFECT)
      Debug.Message("revive limit unsummoned can " .. tostring(unsummoned:IsCanBeSpecialSummoned(nil,0,0,false,false,POS_FACEUP_ATTACK)))
      Debug.Message("revive limit unsummoned result " .. Duel.SpecialSummon(unsummoned,0,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("revive limit fusion summon " .. Duel.FusionSummon(proper,Group.FromCards(mat1,mat2)))
      Duel.SendtoGrave(proper,REASON_EFFECT)
      Debug.Message("revive limit proper can " .. tostring(proper:IsCanBeSpecialSummoned(nil,0,0,false,false,POS_FACEUP_ATTACK)))
      Debug.Message("revive limit proper result " .. Duel.SpecialSummon(proper,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "revive-limit-special-summon-legality.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("revive limit unsummoned can false");
    expect(host.messages).toContain("revive limit unsummoned result 0");
    expect(host.messages).toContain("revive limit fusion summon 1");
    expect(host.messages).toContain("revive limit proper can true");
    expect(host.messages).toContain("revive limit proper result 1");
  });

  it("lets Lua card-effect special summons ignore unconditional summon conditions", () => {
    const cards: DuelCardData[] = [{ code: "900", name: "Condition Locked Monster", kind: "monster" }];
    const session = createDuel({ seed: 172, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["900"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local locked=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_DECK, 0, 1, 1, nil):GetFirst()
      local e=Effect.CreateEffect(locked)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetCode(EFFECT_SPSUMMON_CONDITION)
      e:SetValue(aux.FALSE)
      locked:RegisterEffect(e)
      Debug.Message("condition locked can " .. tostring(locked:IsCanBeSpecialSummoned(nil,0,0,false,false,POS_FACEUP_ATTACK)))
      Debug.Message("condition ignored can " .. tostring(locked:IsCanBeSpecialSummoned(nil,0,0,true,false,POS_FACEUP_ATTACK)))
      Debug.Message("condition locked summon " .. Duel.SpecialSummon(locked,0,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("condition ignored summon " .. Duel.SpecialSummon(locked,0,0,0,true,false,POS_FACEUP_ATTACK))
      `,
      "ignore-unconditional-special-summon-condition.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("condition locked can false");
    expect(host.messages).toContain("condition ignored can true");
    expect(host.messages).toContain("condition locked summon 0");
    expect(host.messages).toContain("condition ignored summon 1");
  });

  it("requires CompleteProcedure for Lua effect Special Summons to satisfy revive limits", () => {
    const cards: DuelCardData[] = [
      { code: "900", name: "No Complete Procedure Fusion", kind: "extra", fusionMaterials: ["100", "200"] },
      { code: "901", name: "Complete Procedure Fusion", kind: "extra", fusionMaterials: ["100", "200"] },
    ];
    const session = createDuel({ seed: 171, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: [], extra: ["900", "901"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local no_complete=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 900), 0, LOCATION_EXTRA, 0, 1, 1, nil):GetFirst()
      local complete=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 901), 0, LOCATION_EXTRA, 0, 1, 1, nil):GetFirst()
      no_complete:EnableReviveLimit()
      complete:EnableReviveLimit()
      Debug.Message("no complete summon " .. Duel.SpecialSummon(no_complete,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("no complete status " .. tostring(no_complete:IsStatus(STATUS_PROC_COMPLETE)))
      Duel.SendtoGrave(no_complete,REASON_EFFECT)
      Debug.Message("no complete revive can " .. tostring(no_complete:IsCanBeSpecialSummoned(nil,0,0,false,false,POS_FACEUP_ATTACK)))
      Debug.Message("no complete revive result " .. Duel.SpecialSummon(no_complete,0,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("complete summon " .. Duel.SpecialSummon(complete,SUMMON_TYPE_FUSION,0,0,false,false,POS_FACEUP_ATTACK))
      Debug.Message("complete status before " .. tostring(complete:IsStatus(STATUS_PROC_COMPLETE)))
      complete:CompleteProcedure()
      Debug.Message("complete status after " .. tostring(complete:IsStatus(STATUS_PROC_COMPLETE)))
      Duel.SendtoGrave(complete,REASON_EFFECT)
      Debug.Message("complete revive can " .. tostring(complete:IsCanBeSpecialSummoned(nil,0,0,false,false,POS_FACEUP_ATTACK)))
      Debug.Message("complete revive result " .. Duel.SpecialSummon(complete,0,0,0,false,false,POS_FACEUP_ATTACK))
      `,
      "complete-procedure-revive-limit.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("no complete summon 1");
    expect(host.messages).toContain("no complete status false");
    expect(host.messages).toContain("no complete revive can false");
    expect(host.messages).toContain("no complete revive result 0");
    expect(host.messages).toContain("complete summon 1");
    expect(host.messages).toContain("complete status before false");
    expect(host.messages).toContain("complete status after true");
    expect(host.messages).toContain("complete revive can true");
    expect(host.messages).toContain("complete revive result 1");
  });

});
