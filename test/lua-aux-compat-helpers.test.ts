import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, restoreDuel, sendDuelCardToGraveyard, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua aux compatibility helpers", () => {
  it("keeps aux.FaceupFilter from matching face-down field positions", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Faceup Filter Probe", kind: "monster", attack: 1000 }];
    const session = createDuel({ seed: 21, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);
    const card = session.state.cards.find((candidate) => candidate.code === "100");
    expect(card).toBeDefined();
    moveDuelCard(session.state, card!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("faceup filter count " .. Duel.GetMatchingGroupCount(aux.FaceupFilter(Card.IsAttackAbove,900),0,LOCATION_MZONE,0,nil))
      `,
      "faceup-filter-position.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("faceup filter count 0");
  });

  it("provides common aux compatibility helpers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Aux A", kind: "monster", attack: 1000 },
      { code: "200", name: "Aux B", kind: "monster", attack: 2000 },
      { code: "300", name: "Aux C", kind: "monster", attack: 3000 },
      { code: "400", name: "Aux D", kind: "monster", attack: 4000 },
      { code: "500", name: "Aux E", kind: "monster", attack: 5000 },
      { code: "94820406", name: "Dark Fusion", kind: "spell" },
      { code: "48130397", name: "Super Polymerization", kind: "spell" },
      { code: "59419719", name: "Fossil Fusion", kind: "spell" },
      { code: "900", name: "Fossil Target", kind: "extra" },
    ];
    const session = createDuel({ seed: 18, startingHandSize: 8, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "500", "94820406", "48130397", "59419719"], extra: ["900"] },
      1: { main: ["100"] },
    });
    startDuel(session);
    const faceup = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const facedown = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    const sameTurn = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    const graveyard = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "400");
    const darkFusion = session.state.cards.find((card) => card.controller === 0 && card.code === "94820406");
    const superPoly = session.state.cards.find((card) => card.controller === 0 && card.code === "48130397");
    const fossilFusion = session.state.cards.find((card) => card.controller === 0 && card.code === "59419719");
    moveDuelCard(session.state, faceup!.uid, "monsterZone", 0).position = "faceUpAttack";
    const setCard = moveDuelCard(session.state, facedown!.uid, "monsterZone", 0);
    setCard.position = "faceDownDefense";
    setCard.faceUp = false;
    sendDuelCardToGraveyard(session.state, sameTurn!.uid, 0, duelReason.effect);
    moveDuelCard(session.state, graveyard!.uid, "graveyard", 0);
    moveDuelCard(session.state, darkFusion!.uid, "graveyard", 0);
    moveDuelCard(session.state, superPoly!.uid, "graveyard", 0);
    moveDuelCard(session.state, fossilFusion!.uid, "graveyard", 0);
    graveyard!.turnId = 0;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      observed_stringid = aux.Stringid(100, 2)
      Debug.Message("players count " .. Duel.GetPlayersCount(0) .. "/" .. Duel.GetPlayersCount(1))
      Debug.Message("tag swap result count " .. select("#", Duel.TagSwap(0)) .. "/" .. Duel.GetPlayersCount(0))
      Debug.Message("true count " .. Duel.GetMatchingGroupCount(aux.TRUE, 0, LOCATION_HAND, 0, nil))
      Debug.Message("false count " .. Duel.GetMatchingGroupCount(aux.FALSE, 0, LOCATION_HAND, 0, nil))
      local wrapped = aux.NecroValleyFilter(aux.FilterBoolFunction(Card.IsCode, 100))
      Debug.Message("wrapped count " .. Duel.GetMatchingGroupCount(wrapped, 0, LOCATION_HAND, 0, nil))
      local wrapped_ex = aux.FilterBoolFunctionEx(function(c, minatk, code) return c:GetAttack() >= minatk and c:IsCode(code) end, 1500)
      Debug.Message("wrapped ex count " .. Duel.GetMatchingGroupCount(wrapped_ex, 0, LOCATION_HAND, 0, nil, 300))
      local wrapped_ex2 = aux.FilterBoolFunctionEx2(function(c, scard, sumtype, tp, minatk, code) return tp==0 and sumtype==SUMMON_TYPE_FUSION and c:GetAttack() >= minatk and c:IsCode(code) end, 1500, 300)
      Debug.Message("wrapped ex2 " .. tostring(wrapped_ex2(Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst(), nil, SUMMON_TYPE_FUSION, 0)) .. "/" .. tostring(wrapped_ex2(Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst(), nil, SUMMON_TYPE_SYNCHRO, 0)))
      local target_bool = aux.TargetBoolFunction(function(c, minatk, code) return c:GetAttack() >= minatk and c:IsCode(code) end, 2500)
      Debug.Message("target bool count " .. Duel.GetMatchingGroupCount(target_bool, 0, LOCATION_HAND, 0, nil, 300))
      local faceup_filter = aux.FaceupFilter(function(c, minatk) return c:GetAttack() >= minatk end, 900)
      Debug.Message("faceup count " .. Duel.GetMatchingGroupCount(faceup_filter, 0, LOCATION_MZONE, 0, nil))
      Debug.Message("faceup runtime count " .. Duel.GetMatchingGroupCount(aux.FaceupFilter(function(c, minatk) return c:GetAttack() >= minatk end), 0, LOCATION_MZONE, 0, nil, 900))
      local faceup_monster = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local facedown_monster = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local necrovalley_effect=Effect.CreateEffect(faceup_monster)
      necrovalley_effect:SetType(EFFECT_TYPE_SINGLE)
      necrovalley_effect:SetCode(EFFECT_NECRO_VALLEY)
      faceup_monster:RegisterEffect(necrovalley_effect)
      Debug.Message("nvfilter " .. tostring(aux.nvfilter(faceup_monster)) .. "/" .. tostring(aux.nvfilter(facedown_monster)))
      local same_turn_grave = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      local grave_monster = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 400), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      Debug.Message("sp elim grave " .. tostring(aux.SpElimFilter(grave_monster)))
      Debug.Message("is zone " .. tostring(aux.IsZone(faceup_monster,1,0)) .. "/" .. tostring(aux.IsZone(faceup_monster,2,0)) .. "/" .. tostring(aux.IsZone(faceup_monster,1<<16,1)))
      Debug.Message("sp elim faceup mzone " .. tostring(aux.SpElimFilter(faceup_monster, true)) .. "/" .. tostring(aux.SpElimFilter(faceup_monster, true, true)))
      Debug.Message("sp elim facedown mzone " .. tostring(aux.SpElimFilter(facedown_monster, true, true)) .. "/" .. tostring(aux.SpElimFilter(facedown_monster, false, true)))
      Debug.Message("maximum defaults " .. tostring(faceup_monster:IsMaximumMode()) .. "/" .. tostring(faceup_monster:IsMaximumModeCenter()) .. "/" .. tostring(faceup_monster:IsMaximumModeLeft()) .. "/" .. tostring(faceup_monster:IsMaximumModeRight()) .. "/" .. tostring(faceup_monster:IsMaximumModeSide()) .. "/" .. tostring(faceup_monster:IsNotMaximumModeSide()))
      local maximum_group = Group.FromCards(faceup_monster,facedown_monster)
      local maximum_checked = maximum_group:AddMaximumCheck()
      maximum_group:RemoveCard(facedown_monster)
      Debug.Message("maximum add check " .. maximum_checked:GetCount() .. "/" .. maximum_group:GetCount() .. "/" .. tostring(maximum_checked:IsContains(faceup_monster)) .. "/" .. tostring(maximum_checked:IsContains(facedown_monster)))
      local maximum_wrapped = aux.FilterMaximumSideFunctionEx(function(c,minatk) return c:IsFaceup() and c:GetAttack() >= minatk end, 900)
      Debug.Message("maximum ex count " .. Duel.GetMatchingGroupCount(maximum_wrapped, 0, LOCATION_MZONE, 0, nil))
      Debug.Message("maximum side count " .. Duel.GetMatchingGroupCount(aux.FilterMaximumSideFunction(function(c) return c:IsFaceup() end), 0, LOCATION_MZONE, 0, nil))
      Debug.Message("not count " .. Duel.GetMatchingGroupCount(aux.NOT(Card.IsCode), 0, LOCATION_HAND, 0, nil, 100))
      Debug.Message("and count " .. Duel.GetMatchingGroupCount(aux.AND(Card.IsFaceup, Card.IsAttackAbove), 0, LOCATION_MZONE, 0, nil, 900))
      Debug.Message("or count " .. Duel.GetMatchingGroupCount(aux.OR(Card.IsFacedown, Card.IsAttackAbove), 0, LOCATION_MZONE, 0, nil, 900))
      Debug.Message("coin hint " .. aux.GetCoinEffectHintString(COIN_HEADS) .. "/" .. aux.GetCoinEffectHintString(COIN_TAILS) .. "/" .. tostring(aux.GetCoinEffectHintString(9)))
      Debug.Message("compose number " .. aux.ComposeNumberDigitByDigit(0,123,129) .. "/" .. aux.ComposeNumberDigitByDigit(0,9,7))
      local id_map=aux.GrouptoCardid(Group.FromCards(faceup_monster,facedown_monster))
      Debug.Message("group card ids " .. tostring(id_map[faceup_monster:GetCardID()]) .. "/" .. tostring(id_map[facedown_monster:GetCardID()]) .. "/" .. tostring(id_map[999999]))
      local cleanup_count=0
      local extra_effect=Effect.CreateEffect(faceup_monster)
      extra_effect:SetType(EFFECT_TYPE_FIELD)
      extra_effect:SetCode(EFFECT_EXTRA_MATERIAL)
      extra_effect:SetRange(LOCATION_MZONE)
      extra_effect:SetTargetRange(1,0)
      extra_effect:SetValue(function(stage,summon_type,e,tp,sc)
        if stage==2 then cleanup_count=cleanup_count+1 return Group.CreateGroup() end
        return Group.FromCards(faceup_monster,facedown_monster)
      end)
      extra_effect:SetOperation(function(c,e,tp,sg,mg,lc,eg,stage) return c==faceup_monster end)
      faceup_monster:RegisterEffect(extra_effect)
      local emt,extra_group=aux.GetExtraMaterials(0,Group.FromCards(facedown_monster),faceup_monster,SUMMON_TYPE_LINK)
      local valid_entries={}
      Debug.Message("extra materials " .. #emt .. "/" .. extra_group:GetCount() .. "/" .. tostring(extra_group:IsContains(faceup_monster)) .. "/" .. tostring(extra_group:IsContains(facedown_monster)))
      Debug.Message("extra valid " .. tostring(aux.CheckValidExtra(faceup_monster,0,Group.CreateGroup(),Group.CreateGroup(),nil,emt,valid_entries)) .. "/" .. tostring(aux.CheckValidExtra(facedown_monster,0,Group.CreateGroup(),Group.CreateGroup(),nil,emt)) .. "/" .. #valid_entries)
      aux.DeleteExtraMaterialGroups(emt)
      Debug.Message("extra cleanup " .. cleanup_count .. "/" .. extra_group:GetCount())
      local field_tg = aux.FieldSummonProcTg(function(e,tp) return tp==0 end,function(e,tp,eg,ep,ev,re,r,rp,chk,c,minatk) return c:GetAttack()>=minatk end)
      Debug.Message("field summon tg " .. tostring(field_tg(nil,0,Group.CreateGroup(),0,0,nil,0,0,0,nil)) .. "/" .. tostring(field_tg(nil,1,Group.CreateGroup(),0,0,nil,0,0,0,nil)) .. "/" .. tostring(field_tg(nil,0,Group.CreateGroup(),0,0,nil,0,0,0,faceup_monster,900)) .. "/" .. tostring(field_tg(nil,0,Group.CreateGroup(),0,0,nil,0,0,0,faceup_monster,2000)))
      local reset_count=0
      local reset_effect=aux.AddValuesReset(function() reset_count=reset_count+1 end)
      local reset_second=aux.AddValuesReset(function() reset_count=reset_count+10 end)
      Debug.Message("values reset setup " .. reset_effect:GetCode() .. "/" .. reset_effect:GetCountLimit() .. "/" .. tostring(reset_second==nil))
      Debug.Message("values reset call " .. tostring(aux.ValuesReset()) .. "/" .. reset_count)
      local gate_low=Effect.CreateEffect(faceup_monster)
      gate_low:SetType(EFFECT_TYPE_FIELD)
      gate_low:SetCode(CARD_SUMMON_GATE)
      gate_low:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
      gate_low:SetTargetRange(1,0)
      gate_low:SetValue(2)
      Duel.RegisterEffect(gate_low,0)
      local gate_high=Effect.CreateEffect(faceup_monster)
      gate_high:SetType(EFFECT_TYPE_FIELD)
      gate_high:SetCode(CARD_SUMMON_GATE)
      gate_high:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
      gate_high:SetTargetRange(1,0)
      gate_high:SetValue(function(tp) return tp==0 and 4 or 1 end)
      Duel.RegisterEffect(gate_high,0)
      Debug.Message("summon gate " .. tostring(aux.CheckSummonGate(0)) .. "/" .. tostring(aux.CheckSummonGate(0,2)) .. "/" .. tostring(aux.CheckSummonGate(0,3)) .. "/" .. tostring(aux.CheckSummonGate(1)) .. "/" .. tostring(aux.CheckSummonGate(1,3)))
      Debug.Message("double tribute open " .. tostring(aux.DoubleTributeCon(value_effect,0,Group.CreateGroup(),0,0,nil,0,0)))
      local no_tribute=Effect.CreateEffect(faceup_monster)
      no_tribute:SetType(EFFECT_TYPE_FIELD)
      no_tribute:SetCode(FLAG_NO_TRIBUTE)
      no_tribute:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
      no_tribute:SetTargetRange(1,0)
      Duel.RegisterEffect(no_tribute,0)
      Debug.Message("double tribute blocked " .. FLAG_NO_TRIBUTE .. "/" .. tostring(aux.DoubleTributeCon(value_effect,0,Group.CreateGroup(),0,0,nil,0,0)) .. "/" .. tostring(aux.DoubleTributeCon(value_effect,1,Group.CreateGroup(),0,0,nil,0,0)))
      local named = aux.FunctionWithNamedArgs(function(a,b,...)
        local total=0
        for _,value in ipairs({...}) do total=total+value end
        return a .. "/" .. b .. "/" .. total
      end, "first", {"missing","fallback"}, "vaargs")
      Debug.Message("named args " .. named({first="A",fallback="B",vaargs={3,4}}) .. "/" .. named("X","Y",5,6))
      local mat_filter = aux.cannotmatfilter(SUMMON_TYPE_FUSION,SUMMON_TYPE_SYNCHRO)
      local table_mat_filter = aux.cannotmatfilter({SUMMON_TYPE_XYZ,SUMMON_TYPE_LINK})
      Debug.Message("cannot mat " .. tostring(mat_filter(nil,nil,SUMMON_TYPE_FUSION,0)) .. "/" .. tostring(mat_filter(nil,nil,SUMMON_TYPE_XYZ,0)) .. "/" .. tostring(table_mat_filter(nil,nil,SUMMON_TYPE_LINK,0)))
      Debug.Message("chkf mmz " .. tostring(aux.ChkfMMZ(1)(Group.CreateGroup(), nil, 0)) .. "/" .. tostring(aux.ChkfMMZ(6)(Group.CreateGroup(), nil, 0)))
      Debug.Message("ritlimit " .. tostring(aux.ritlimit(nil,nil,0,SUMMON_TYPE_RITUAL)) .. "/" .. tostring(aux.ritlimit(nil,nil,0,SUMMON_TYPE_FUSION)))
      local value_effect=Effect.CreateEffect(faceup_monster)
      Debug.Message("value helpers own " .. tostring(aux.tgoval(value_effect,nil,0)) .. "/" .. tostring(aux.indsval(value_effect,nil,0)) .. "/" .. tostring(aux.indoval(value_effect,nil,0)))
      Debug.Message("value helpers opponent " .. tostring(aux.tgoval(value_effect,nil,1)) .. "/" .. tostring(aux.indsval(value_effect,nil,1)) .. "/" .. tostring(aux.indoval(value_effect,nil,1)))
      local opponent_card = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 1, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local dark_fusion = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 94820406), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      local super_poly = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 48130397), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      local fossil_fusion = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 59419719), 0, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      local fossil_target = Duel.GetFieldCard(0, LOCATION_EXTRA, 0)
      Debug.Message("imval helpers " .. tostring(aux.imval1(value_effect,faceup_monster)) .. "/" .. tostring(aux.imval2(value_effect,faceup_monster)) .. "/" .. tostring(aux.imval2(value_effect,opponent_card)))
      aux.chainreg(value_effect,0,Group.CreateGroup(),0,0,nil,0,0)
      aux.chainreg(value_effect,0,Group.CreateGroup(),0,0,nil,0,0)
      Debug.Message("chainreg flag " .. faceup_monster:GetFlagEffect(1))
      value_effect:SetLabel(100)
      aux.sumreg(value_effect,0,Group.FromCards(faceup_monster,opponent_card),0,0,nil,0,0)
      Debug.Message("sumreg flags " .. faceup_monster:GetFlagEffect(100) .. "/" .. opponent_card:GetFlagEffect(100))
      Debug.Message("extra limits " .. tostring(aux.fuslimit(nil,nil,0,SUMMON_TYPE_FUSION)) .. "/" .. tostring(aux.synlimit(nil,nil,0,SUMMON_TYPE_SYNCHRO)) .. "/" .. tostring(aux.xyzlimit(nil,nil,0,SUMMON_TYPE_XYZ)) .. "/" .. tostring(aux.penlimit(nil,nil,0,SUMMON_TYPE_PENDULUM)) .. "/" .. tostring(aux.lnklimit(nil,nil,0,SUMMON_TYPE_LINK)))
      Debug.Message("extra misses " .. tostring(aux.fuslimit(nil,nil,0,SUMMON_TYPE_SYNCHRO)) .. "/" .. tostring(aux.synlimit(nil,nil,0,SUMMON_TYPE_XYZ)) .. "/" .. tostring(aux.xyzlimit(nil,nil,0,SUMMON_TYPE_FUSION)) .. "/" .. tostring(aux.penlimit(nil,nil,0,SUMMON_TYPE_LINK)) .. "/" .. tostring(aux.lnklimit(nil,nil,0,SUMMON_TYPE_PENDULUM)))
      Debug.Message("sumlimit " .. tostring(aux.sumlimit(SUMMON_TYPE_RITUAL)(nil,nil,0,SUMMON_TYPE_RITUAL)))
      local evil_effect=Effect.CreateEffect(faceup_monster)
      local dark_fusion_effect=Effect.CreateEffect(dark_fusion)
      local super_poly_effect=Effect.CreateEffect(super_poly)
      Debug.Message("evil hero direct " .. tostring(aux.EvilHeroLimit(evil_effect,dark_fusion_effect,0,SUMMON_TYPE_FUSION)) .. "/" .. tostring(aux.EvilHeroLimit(evil_effect,value_effect,0,SUMMON_TYPE_FUSION)))
      local dark_unity=Effect.CreateEffect(faceup_monster)
      dark_unity:SetType(EFFECT_TYPE_FIELD)
      dark_unity:SetCode(300306009)
      dark_unity:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
      dark_unity:SetTargetRange(1,0)
      Duel.RegisterEffect(dark_unity,0)
      Debug.Message("evil hero skill " .. tostring(aux.EvilHeroLimit(evil_effect,super_poly_effect,0,SUMMON_TYPE_FUSION)))
      local supreme_castle=Effect.CreateEffect(faceup_monster)
      supreme_castle:SetType(EFFECT_TYPE_FIELD)
      supreme_castle:SetCode(72043279)
      supreme_castle:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
      supreme_castle:SetTargetRange(1,0)
      Duel.RegisterEffect(supreme_castle,0)
      Debug.Message("evil hero castle " .. tostring(aux.EvilHeroLimit(evil_effect,value_effect,0,SUMMON_TYPE_FUSION)) .. "/" .. tostring(aux.EvilHeroLimit(evil_effect,value_effect,0,SUMMON_TYPE_SYNCHRO)))
      local fossil_effect=Effect.CreateEffect(fossil_target)
      local fossil_fusion_effect=Effect.CreateEffect(fossil_fusion)
      Debug.Message("fossil limit " .. tostring(aux.FossilLimit(evil_effect,value_effect,0,SUMMON_TYPE_FUSION)) .. "/" .. tostring(aux.FossilLimit(fossil_effect,fossil_fusion_effect,0,SUMMON_TYPE_FUSION)) .. "/" .. tostring(aux.FossilLimit(fossil_effect,super_poly_effect,0,SUMMON_TYPE_FUSION)))
      local hint=aux.RegisterClientHint(faceup_monster,EFFECT_FLAG_OATH,0,1,0,777,RESET_SELF_TURN,2)
      local hint_range_self,hint_range_opp=hint:GetTargetRange()
      local hint_reset,hint_reset_count=hint:GetReset()
      Debug.Message("client hint " .. hint:GetDescription() .. "/" .. hint_range_self .. "/" .. hint_range_opp .. "/" .. hint_reset_count .. "/" .. tostring(hint:IsHasProperty(EFFECT_FLAG_CLIENT_HINT)) .. "/" .. tostring(hint:IsHasProperty(EFFECT_FLAG_OATH)))
      Debug.Message("client hint default nil " .. tostring(aux.RegisterClientHint(nil,0,0,1,0)==nil))
      local global_state={}
      local global_count=0
      aux.GlobalCheck(global_state,function()
        global_count=global_count+1
      end)
      aux.GlobalCheck(global_state,function()
        global_count=global_count+1
      end)
      Debug.Message("global check " .. tostring(global_state.global_check) .. "/" .. global_count)
      local extra_rules_state={}
      local extra_rules_effect=aux.EnableExtraRules(faceup_monster,extra_rules_state,function(c,minatk)
        Debug.Message("extra rules init " .. c:GetCode() .. "/" .. minatk)
        return c:GetAttack()>=minatk
      end,900)
      Debug.Message("extra rules effect " .. extra_rules_effect:GetType() .. "/" .. extra_rules_effect:GetCode() .. "/" .. extra_rules_effect:GetProperty() .. "/" .. tostring(extra_rules_state.global_active_check))
      Debug.Message("extra rules op " .. tostring(extra_rules_effect:GetOperation()(extra_rules_effect,0,Group.CreateGroup(),0,0,nil,0,0)) .. "/" .. tostring(extra_rules_state.global_active_check))
      local all_cards = Duel.GetFieldGroup(0, LOCATION_HAND + LOCATION_MZONE, 0)
      local iter_count=0
      local iter_sum=0
      for tc in aux.Next(all_cards) do
        iter_count=iter_count+1
        iter_sum=iter_sum+tc:GetCode()
      end
      Debug.Message("aux next " .. iter_count .. "/" .. iter_sum)
      local empty_iter_count=0
      for tc in aux.Next(Group.CreateGroup()) do
        empty_iter_count=empty_iter_count+1
      end
      Debug.Message("aux next empty " .. empty_iter_count)
      local plain_selected = aux.SelectUnselectGroup(all_cards, 0, 1, 2, false, false)
      Debug.Message("aux select plain " .. plain_selected:GetCount())
      local unique_names = Duel.GetMatchingGroup(aux.TRUE, 0, LOCATION_HAND + LOCATION_MZONE, 0, nil)
      Debug.Message("dpcheck unique " .. tostring(aux.dpcheck(Card.GetCode)(unique_names)))
      Debug.Message("dncheck unique " .. tostring(aux.dncheck(unique_names)))
      local duplicate_names = Group.FromCards(faceup_monster,Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 1, LOCATION_HAND, 0, 1, 1, nil):GetFirst())
      local duplicate_ok,duplicate_has_repeat = aux.dncheck(duplicate_names)
      Debug.Message("dncheck duplicate " .. tostring(duplicate_ok) .. "/" .. tostring(duplicate_has_repeat))
      local same_turn_effect=Effect.CreateEffect(same_turn_grave)
      local previous_turn_effect=Effect.CreateEffect(grave_monster)
      Debug.Message("exccon turns " .. same_turn_grave:GetTurnID() .. "/" .. grave_monster:GetTurnID() .. "/" .. Duel.GetTurnCount())
      Debug.Message("exccon values " .. tostring(aux.exccon(same_turn_effect)) .. "/" .. tostring(aux.exccon(previous_turn_effect)))
      Duel.SendtoHand(same_turn_grave,nil,REASON_RETURN)
      Debug.Message("exccon return " .. tostring(aux.exccon(same_turn_effect)))
      local filtered_selected = aux.SelectUnselectGroup(all_cards, 0, 2, 2, false, false, function(sg,minatk)
        local total=0
        local tc=sg:GetFirst()
        while tc do
          total=total+tc:GetAttack()
          tc=sg:GetNext()
        end
        return total>=minatk
      end, 5000)
      Debug.Message("aux select filtered " .. filtered_selected:GetCount())
      local missed_selected = aux.SelectUnselectGroup(all_cards, 0, 2, 2, false, false, function(sg,minatk)
        local total=0
        local tc=sg:GetFirst()
        while tc do
          total=total+tc:GetAttack()
          tc=sg:GetNext()
        end
        return total>=minatk
      end, 7000)
      Debug.Message("aux select missed " .. missed_selected:GetCount())
      Debug.Message("target exists " .. tostring(Duel.IsExistingTarget(aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, nil)))
      Debug.Message("target count " .. Duel.GetTargetCount(aux.TRUE, 0, LOCATION_HAND, 0, nil))
      `,
      "aux-helpers.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.getGlobalNumber("observed_stringid")).toBe(1602);
    expect(host.messages).toContain("players count 1/1");
    expect(host.messages).toContain("tag swap result count 0/1");
    expect(host.messages).toContain("true count 1");
    expect(host.messages).toContain("false count 0");
    expect(host.messages).toContain("wrapped count 0");
    expect(host.messages).toContain("nvfilter false/true");
    expect(host.messages).toContain("wrapped ex count 1");
    expect(host.messages).toContain("wrapped ex2 true/false");
    expect(host.messages).toContain("target bool count 1");
    expect(host.messages).toContain("faceup count 1");
    expect(host.messages).toContain("faceup runtime count 1");
    expect(host.messages).toContain("sp elim grave true");
    expect(host.messages).toContain("is zone true/false/true");
    expect(host.messages).toContain("sp elim faceup mzone false/true");
    expect(host.messages).toContain("sp elim facedown mzone false/true");
    expect(host.messages).toContain("maximum defaults false/false/false/false/false/true");
    expect(host.messages).toContain("maximum add check 2/1/true/true");
    expect(host.messages).toContain("maximum ex count 1");
    expect(host.messages).toContain("maximum side count 0");
    expect(host.messages).toContain("not count 1");
    expect(host.messages).toContain("and count 1");
    expect(host.messages).toContain("or count 2");
    expect(host.messages).toContain("coin hint 62/63/nil");
    expect(host.messages).toContain("compose number 123/7");
    expect(host.messages).toContain("group card ids true/true/nil");
    expect(host.messages).toContain("extra materials 1/1/true/false");
    expect(host.messages).toContain("extra valid true/false/1");
    expect(host.messages).toContain("extra cleanup 1/1");
    expect(host.messages).toContain("field summon tg true/false/true/false");
    expect(host.messages).toContain("values reset setup 1210/1/true");
    expect(host.messages).toContain("values reset call false/11");
    expect(host.messages).toContain("summon gate 2/true/false/nil/true");
    expect(host.messages).toContain("double tribute open true");
    expect(host.messages).toContain("double tribute blocked 160001029/false/true");
    expect(host.messages).toContain("named args A/B/7/X/Y/11");
    expect(host.messages).toContain("cannot mat true/false/true");
    expect(host.messages).toContain("chkf mmz true/false");
    expect(host.messages).toContain("ritlimit true/false");
    expect(host.messages).toContain("value helpers own false/true/false");
    expect(host.messages).toContain("value helpers opponent true/false/true");
    expect(host.messages).toContain("imval helpers true/false/true");
    expect(host.messages).toContain("chainreg flag 1");
    expect(host.messages).toContain("sumreg flags 1/1");
    expect(host.messages).toContain("extra limits true/true/true/true/true");
    expect(host.messages).toContain("extra misses false/false/false/false/false");
    expect(host.messages).toContain("sumlimit true");
    expect(host.messages).toContain("evil hero direct true/nil");
    expect(host.messages).toContain("evil hero skill true");
    expect(host.messages).toContain("evil hero castle true/false");
    expect(host.messages).toContain("fossil limit true/true/false");
    expect(host.messages).toContain("client hint 777/1/0/2/true/true");
    expect(host.messages).toContain("client hint default nil true");
    expect(host.messages).toContain("global check true/1");
    expect(host.messages).toContain("extra rules effect 2050/1040/263168/nil");
    expect(host.messages).toContain("extra rules init 100/900");
    expect(host.messages).toContain("extra rules op true/true");
    expect(host.messages).toContain("aux next 3/600");
    expect(host.messages).toContain("aux next empty 0");
    expect(host.messages).toContain("aux select plain 2");
    expect(host.messages).toContain("dpcheck unique true");
    expect(host.messages).toContain("dncheck unique true");
    expect(host.messages).toContain("dncheck duplicate false/true");
    expect(host.messages).toContain("exccon turns 1/0/1");
    expect(host.messages).toContain("exccon values false/true");
    expect(host.messages).toContain("exccon return true");
    expect(host.messages).toContain("aux select filtered 2");
    expect(host.messages).toContain("aux select missed 0");
    expect(host.messages).toContain("target exists true");
    expect(host.messages).toContain("target count 2");
  });

  it("provides no-op and Lava condition aux helpers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Lava Source", kind: "monster" },
      { code: "200", name: "Opponent Release", kind: "monster" },
      { code: "300", name: "Filtered Release", kind: "monster" },
    ];
    const session = createDuel({ seed: 173, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200", "300"] },
    });
    startDuel(session);
    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const first = session.state.cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "200");
    const second = session.state.cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "300");
    expect(source).toBeTruthy();
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0);
    moveDuelCard(session.state, first!.uid, "monsterZone", 1);
    moveDuelCard(session.state, second!.uid, "monsterZone", 1);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local e=Effect.CreateEffect(c)
      e:SetOperation(aux.NULL)
      Debug.Message("null op " .. tostring(e:GetOperation()~=nil) .. "/" .. tostring(e:GetOperation()(e,0,nil,0,0,nil,0,0)==nil))
      local one=aux.LavaCondition(1,nil)
      local two=aux.LavaCondition(2,nil)
      local filtered=aux.LavaCondition(1,aux.FilterBoolFunction(Card.IsCode,300))
      local missing=aux.LavaCondition(1,aux.FilterBoolFunction(Card.IsCode,999))
      Debug.Message("lava condition " .. tostring(one(e,c)) .. "/" .. tostring(two(e,c)) .. "/" .. tostring(filtered(e,c)) .. "/" .. tostring(missing(e,c)) .. "/" .. tostring(one(e,nil)))
      `,
      "aux-null-lava.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("null op true/true");
    expect(host.messages).toContain("lava condition true/true/true/false/true");
  });

  it("marks cards with Rank-Up usage helper flags", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Rank Up First", kind: "monster" },
      { code: "200", name: "Rank Up Second", kind: "monster" },
    ];
    const session = createDuel({ seed: 174, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local first=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local second=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      aux.RankUpUsing(Group.FromCards(first,second),84013237,aux.Stringid(84013237,1))
      aux.RankUpComplete(first,aux.Stringid(511015134,1))
      local e1,e2=aux.EnableCheckRankUp(first,function(e,tp) return tp==0 end,function(e,tp) Debug.Message("rank up op " .. tp) end,84013237)
      Debug.Message("rank up using " .. first:GetFlagEffect(511000685) .. "/" .. second:GetFlagEffect(511000685) .. "/" .. first:GetFlagEffectLabel(511000685) .. "/" .. second:GetFlagEffectLabel(511000685))
      Debug.Message("rank up complete " .. first:GetFlagEffect(511015134) .. "/" .. second:GetFlagEffect(511015134) .. "/" .. first:GetFlagEffectLabel(511015134))
      Debug.Message("rank up enable " .. e1:GetCode() .. "/" .. e2:GetCode() .. "/" .. tostring(e2:GetLabelObject()==e1) .. "/" .. tostring(e1:GetCondition()(e1,0,Group.CreateGroup(),0,0,nil,0,0)))
      local ge=aux.EnableCheckReincarnation(first)
      local repeated=aux.EnableCheckReincarnation(second)
      Debug.Message("reincarnation enable " .. ge:GetType() .. "/" .. tostring(ge:GetLabelObject()~=nil) .. "/" .. tostring(repeated==nil))
      `,
      "rank-up-flags.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("rank up using 1/1/84013237/84013237");
    expect(host.messages.some((message) => message.startsWith("rank up complete 1/0/"))).toBe(true);
    expect(host.messages).toContain("rank up enable 1102/251/true/true");
    expect(host.messages).toContain("reincarnation enable 8194/true/true");
  });

});
