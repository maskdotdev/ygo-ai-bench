import { describe, expect, it } from "vitest";
import {
  applyResponse,
  createDuel,
  getGroupedDuelLegalActions,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  moveDuelCard,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua procedure metadata helpers", () => {
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
      local ignition=Effect.CreateEffect(low)
      ignition:SetType(EFFECT_TYPE_IGNITION)
      local trigger=Effect.CreateEffect(low)
      trigger:SetType(EFFECT_TYPE_TRIGGER_O)
      local quick=Effect.CreateEffect(low)
      quick:SetType(EFFECT_TYPE_QUICK_O)
      local continuous=Effect.CreateEffect(low)
      continuous:SetType(EFFECT_TYPE_CONTINUOUS)
      local inactive=Effect.CreateEffect(low)
      Debug.Message("active type " .. tostring(low_effect:IsActiveType(TYPE_MONSTER)) .. "/" .. tostring(spell_effect:IsActiveType(TYPE_MONSTER)) .. "/" .. tostring(low_effect:IsActivated()) .. "/" .. tostring(inactive:IsActivated()))
      Debug.Message("activated kinds " .. tostring(ignition:IsActivated()) .. "/" .. tostring(trigger:IsActivated()) .. "/" .. tostring(quick:IsActivated()) .. "/" .. tostring(continuous:IsActivated()))
      Debug.Message("qli filter " .. tostring(aux.qlifilter(e,low_effect)) .. "/" .. tostring(aux.qlifilter(e,high_effect)) .. "/" .. tostring(aux.qlifilter(e,xyz_effect)) .. "/" .. tostring(aux.qlifilter(e,link_effect)) .. "/" .. tostring(aux.qlifilter(e,spell_effect)) .. "/" .. tostring(aux.qlifilter(e,inactive)))
      `,
      "qli-filter.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("active type true/false/true/false");
    expect(host.messages).toContain("activated kinds true/true/true/false");
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
    applyAndAssert(session, baseAction!);
    const cloneAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === session.state.effects[1]?.id);
    expect(cloneAction).toBeDefined();
    applyAndAssert(session, cloneAction!);

    expect(host.messages).toContain("base op 111/5/10/2/0");
    expect(host.messages).toContain("clone op 222/9/20/2/0");
  });

  it("copies Lua effects between cards with Duel.MajesticCopy", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Majestic Receiver", kind: "monster" },
      { code: "200", name: "Majestic Source", kind: "monster" },
    ];
    const session = createDuel({ seed: 86, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local receiver=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode,100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local source=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode,200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local e=Effect.CreateEffect(source)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetCode(777001)
      e:SetLabel(88)
      e:SetOperation(function(e,tp) Debug.Message("majestic copied op " .. e:GetHandler():GetCode() .. "/" .. tp) end)
      source:RegisterEffect(e)
      Debug.Message("majestic copy count " .. Duel.MajesticCopy(receiver,source,RESET_EVENT+RESETS_STANDARD))
      local copied=receiver:GetCardEffect(777001)
      local reset=copied:GetReset()
      Debug.Message("majestic copied " .. tostring(copied~=nil) .. "/" .. copied:GetLabel() .. "/" .. copied:GetHandler():GetCode() .. "/" .. reset)
      copied:GetOperation()(copied,0)
      `,
      "majestic-copy.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("majestic copy count 1");
    expect(host.messages).toContain("majestic copied true/88/100/33427456");
    expect(host.messages).toContain("majestic copied op 100/0");
  });

});

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
