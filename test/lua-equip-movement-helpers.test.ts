import { describe, expect, it } from "vitest";
import fs from "node:fs";
import {
  applyResponse,
  createDuel,
  detachDuelOverlayMaterials,
  destroyDuelCard,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  specialSummonDuelCard,
  startDuel,
  xyzSummonDuelCard,
} from "#duel/core.js";
import { getCards, moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua equip movement helpers", () => {
  it("registers Lua equip spell procedures", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Procedure Target", kind: "monster" },
      { code: "501", name: "Procedure Equip", kind: "spell", typeFlags: 0x40002 },
    ];
    const session = createDuel({ seed: 40, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "501"] },
      1: { main: ["100"] },
    });
    startDuel(session);
    const target = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const equip = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "501");
    expect(target).toBeDefined();
    expect(equip).toBeDefined();
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c501={}
      function c501.initial_effect(c)
        aux.AddEquipProcedure(c,nil,aux.FilterBoolFunction(Card.IsCode,100),nil,nil,nil,function(e,tp)
          Debug.Message("equip procedure op " .. e:GetHandler():GetEquipTarget():GetCode())
        end)
      end
      `,
      "equip-procedure.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effectRecord) => effectRecord.sourceUid === equip!.uid)).toHaveLength(2);
    const actions = getDuelLegalActions(session, 0).filter((candidate) => candidate.type === "activateEffect" && candidate.uid === equip!.uid);
    expect(actions).toHaveLength(1);
    expect(applyResponse(session, actions[0]!).ok).toBe(true);
    while (session.state.chain.length > 0) {
      const player = session.state.waitingFor ?? session.state.turnPlayer;
      expect(applyResponse(session, { type: "passChain", player, label: "Pass" }).ok).toBe(true);
    }

    expect(host.messages).toContain("equip procedure op 100");
    expect(session.state.cards.find((card) => card.uid === equip!.uid)).toMatchObject({ location: "spellTrapZone", equippedToUid: target!.uid, faceUp: true });
  });

  it("lets Lua scripts equip cards to field monsters", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Equip Target", kind: "monster" },
      { code: "500", name: "Equip Spell", kind: "spell", typeFlags: 0x40002 },
    ];
    const session = createDuel({ seed: 39, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "500"] },
      1: { main: ["100"] },
    });
    startDuel(session);
    const target = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(target).toBeDefined();
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local equip = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("equip result " .. tostring(Duel.Equip(0, equip, target)))
      Duel.EquipComplete()
      Debug.Message("equip operated " .. Duel.GetOperatedGroup():GetFirst():GetCode())
      Debug.Message("equip target " .. equip:GetEquipTarget():GetCode())
      Debug.Message("equip count " .. target:GetEquipCount() .. "/" .. target:GetEquipGroup():GetFirst():GetCode() .. "/" .. tostring(target:HasEquipCard()) .. "/" .. tostring(equip:HasEquipCard()))
      `,
      "equip-helper.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("equip result true");
    expect(host.messages).toContain("equip operated 500");
    expect(host.messages).toContain("equip target 100");
    expect(host.messages).toContain("equip count 1/500/true/false");
    expect(session.state.cards.find((card) => card.code === "500")).toMatchObject({ location: "spellTrapZone", equippedToUid: target!.uid, faceUp: true });
    expect(session.state.log.some((entry) => entry.action === "equip" && entry.detail === "Equipped to Equip Target")).toBe(true);
  });

  it("queues Lua equip triggers after Duel.Equip succeeds", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Equip Trigger Target", kind: "monster" },
      { code: "500", name: "Equip Trigger Spell", kind: "spell", typeFlags: 0x40002 },
      { code: "700", name: "Equip Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 64, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "500", "700"] },
      1: { main: [] },
    });
    startDuel(session);
    const target = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(target).toBeDefined();
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local equip = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local watcher = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 700), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local e=Effect.CreateEffect(watcher)
      e:SetType(EFFECT_TYPE_TRIGGER_O)
      e:SetCode(EVENT_EQUIP)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("equip trigger resolved " .. Duel.GetOperatedGroup():GetFirst():GetCode()) end)
      watcher:RegisterEffect(e)
      Debug.Message("equip trigger equip " .. tostring(Duel.Equip(0, equip, target)))
      `,
      "equip-trigger.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("equip trigger equip true");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["equipped"]);
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expect(applyResponse(session, trigger!).ok).toBe(true);
    expect(host.messages).toContain("equip trigger resolved 500");
  });

  it("lets Lua scripts equip cards through effect limit registration helper", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Equip Limit Target", kind: "monster" },
      { code: "500", name: "Effect Equip Card", kind: "monster" },
    ];
    const session = createDuel({ seed: 152, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "500"] },
      1: { main: [] },
    });
    startDuel(session);
    const target = session.state.cards.find((card) => card.code === "100");
    expect(target).toBeTruthy();
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local target = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local equip = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local e = Effect.CreateEffect(target)
      local marker = Effect.CreateEffect(target)
      marker:SetType(EFFECT_TYPE_SINGLE)
      marker:SetCode(89785779 + EFFECT_EQUIP_LIMIT)
      target:RegisterEffect(marker)
      Debug.Message("effect equip result " .. tostring(target:EquipByEffectAndLimitRegister(e, 0, equip, 777001, true)))
      Debug.Message("effect equip target " .. equip:GetEquipTarget():GetCode())
      local limit = Effect.CreateEffect(target)
      limit:SetLabelObject(marker)
      local other = Effect.CreateEffect(target)
      Debug.Message("effect equip limit " .. tostring(Card.EquipByEffectLimit(limit,target)) .. "/" .. tostring(Card.EquipByEffectLimit(limit,equip)) .. "/" .. tostring(Card.EquipByEffectLimit(other,target)))
      Debug.Message("effect equip flag " .. equip:GetFlagEffect(777001))
      Debug.Message("effect equip operated " .. Duel.GetOperatedGroup():GetFirst():GetCode())
      `,
      "effect-equip-limit-register.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("effect equip result true");
    expect(host.messages).toContain("effect equip target 100");
    expect(host.messages).toContain("effect equip limit true/false/false");
    expect(host.messages).toContain("effect equip flag 1");
    expect(host.messages).toContain("effect equip operated 500");
    expect(session.state.cards.find((card) => card.code === "500")).toMatchObject({ location: "spellTrapZone", equippedToUid: target!.uid, faceUp: true });
  });

  it("lets Lua scripts register Eyes Restrict equip limits", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Eyes Restrict Source", kind: "monster" },
      { code: "500", name: "Eyes Restrict Equip", kind: "monster" },
    ];
    const session = createDuel({ seed: 158, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "500"] },
      1: { main: [] },
    });
    startDuel(session);
    const source = session.state.cards.find((card) => card.code === "100");
    expect(source).toBeTruthy();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0).faceUp = true;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local source = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local equip = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local linked = Effect.CreateEffect(source)
      local e1,e2 = aux.AddEREquipLimit(source,nil,function(ec,c,tp) return ec:IsFaceup() end,aux.EquipAndLimitRegister,linked,EFFECT_FLAG_IGNORE_IMMUNE,RESET_EVENT+RESETS_STANDARD,1)
      Debug.Message("er metadata " .. e1:GetCode() .. "/" .. e1:GetProperty() .. "/" .. e2:GetCode() .. "/" .. e2:GetProperty() .. "/" .. tostring(linked:GetLabelObject()==e2))
      local reset,reset_count=e1:GetReset()
      Debug.Message("er reset " .. reset .. "/" .. reset_count .. "/" .. tostring(e1:GetValue()(source,source,0)))
      Debug.Message("er operation " .. tostring(e1:GetOperation()(equip,linked,0,source)))
      Debug.Message("er equip target " .. equip:GetEquipTarget():GetCode())
      Debug.Message("er equip limit " .. tostring(equip:IsHasEffect(EFFECT_EQUIP_LIMIT)~=nil))
      `,
      "eyes-restrict-equip-limit.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("er metadata 89785779/1152/89785855/128/true");
    expect(host.messages).toContain("er reset 33427456/1/true");
    expect(host.messages).toContain("er operation true");
    expect(host.messages).toContain("er equip target 100");
    expect(host.messages).toContain("er equip limit true");
    expect(session.state.cards.find((card) => card.code === "500")).toMatchObject({ location: "spellTrapZone", equippedToUid: source!.uid, faceUp: true });
  });

  it("lets Lua scripts register ZW equip limits", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "ZW Source", kind: "monster" },
      { code: "500", name: "ZW Equip", kind: "monster" },
    ];
    const session = createDuel({ seed: 159, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "500"] },
      1: { main: [] },
    });
    startDuel(session);
    const source = session.state.cards.find((card) => card.code === "100");
    expect(source).toBeTruthy();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0).faceUp = true;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local source = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local equip = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 500), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local linked = Effect.CreateEffect(source)
      local e1,e2 = aux.AddZWEquipLimit(source,nil,function(ec,c,tp) return ec:IsFaceup() end,aux.EquipAndLimitRegister,linked,EFFECT_FLAG_IGNORE_IMMUNE,RESET_EVENT+RESETS_STANDARD,1)
      Debug.Message("zw metadata " .. e1:GetCode() .. "/" .. e1:GetProperty() .. "/" .. e2:GetCode() .. "/" .. e2:GetProperty() .. "/" .. tostring(linked:GetLabelObject()==e2))
      local reset,reset_count=e1:GetReset()
      Debug.Message("zw reset " .. reset .. "/" .. reset_count .. "/" .. tostring(e1:GetValue()(source,source,0)))
      Debug.Message("zw operation " .. tostring(e1:GetOperation()(equip,linked,0,source)))
      Debug.Message("zw equip target " .. equip:GetEquipTarget():GetCode())
      Debug.Message("zw equip limit " .. tostring(equip:IsHasEffect(EFFECT_EQUIP_LIMIT)~=nil))
      `,
      "zw-equip-limit.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("zw metadata 75402014/1152/75402090/128/true");
    expect(host.messages).toContain("zw reset 33427456/1/true");
    expect(host.messages).toContain("zw operation true");
    expect(host.messages).toContain("zw equip target 100");
    expect(host.messages).toContain("zw equip limit true");
    expect(session.state.cards.find((card) => card.code === "500")).toMatchObject({ location: "spellTrapZone", equippedToUid: source!.uid, faceUp: true });
  });

  it("lets Lua scripts register Neos return effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Neos Fusion", kind: "monster" },
      { code: "14088859", name: "Contact Out", kind: "monster" },
    ];
    const session = createDuel({ seed: 160, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "14088859"] },
      1: { main: [] },
    });
    startDuel(session);
    const source = session.state.cards.find((card) => card.code === "100");
    const substitute = session.state.cards.find((card) => card.code === "14088859");
    expect(source).toBeTruthy();
    expect(substitute).toBeTruthy();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0).faceUp = true;
    moveDuelCard(session.state, substitute!.uid, "graveyard", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local marker = Effect.CreateEffect(c)
      local e1,e2 = aux.EnableNeosReturn(c,CATEGORY_DESTROY,function(e,tp,eg,ep,ev,re,r,rp,chk) Debug.Message("neos extra info " .. chk) end,function(e,tp) Debug.Message("neos extra op " .. tp) end,marker)
      Debug.Message("neos metadata " .. e1:GetCategory() .. "/" .. e1:GetType() .. "/" .. e2:GetType() .. "/" .. e1:GetCode() .. "/" .. e1:GetRange() .. "/" .. e1:GetCountLimit())
      Debug.Message("neos labels " .. tostring(e1:GetLabelObject()==marker) .. "/" .. tostring(e2:GetLabelObject()==marker))
      Debug.Message("neos conditions " .. tostring(e1:GetCondition()(e1,0,Group.CreateGroup(),0,0,nil,0,0)) .. "/" .. tostring(e2:GetCondition()(e2,0,Group.CreateGroup(),0,0,nil,0,0)))
      Debug.Message("neos target " .. tostring(e1:GetTarget()(e1,0,Group.CreateGroup(),0,0,nil,0,0,0)))
      e1:GetTarget()(e1,0,Group.CreateGroup(),0,0,nil,0,0,1)
      local ok,g,count,p,param=Duel.GetOperationInfo(0,CATEGORY_TODECK)
      Debug.Message("neos op info " .. tostring(ok) .. "/" .. g:GetCount() .. "/" .. count)
      e1:GetOperation()(e1,0,Group.CreateGroup(),0,0,nil,0,0)
      Debug.Message("neos locations " .. c:GetLocation() .. "/" .. Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,14088859),0,LOCATION_REMOVED,0,nil):GetCode())
      `,
      "neos-return.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("neos metadata 17/514/130/4608/4/1");
    expect(host.messages).toContain("neos labels true/true");
    expect(host.messages).toContain("neos conditions true/nil");
    expect(host.messages).toContain("neos target true");
    expect(host.messages).toContain("neos extra info 1");
    expect(host.messages).toContain("neos op info true/1/1");
    expect(host.messages).toContain("neos locations 4/14088859");
    expect(session.state.cards.find((card) => card.code === "14088859")).toMatchObject({ location: "banished" });
  });

  it("queues Lua remove triggers after cards are banished", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Remove Starter", kind: "monster" },
      { code: "200", name: "Remove Target", kind: "monster" },
      { code: "300", name: "Remove Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 175, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local starter=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local remove=Effect.CreateEffect(starter)
      remove:SetType(EFFECT_TYPE_IGNITION)
      remove:SetRange(LOCATION_HAND)
      remove:SetOperation(function(e,tp)
        Debug.Message("remove count " .. Duel.Remove(target, POS_FACEUP, REASON_EFFECT))
      end)
      starter:RegisterEffect(remove)

      local e=Effect.CreateEffect(watcher)
      e:SetType(EFFECT_TYPE_TRIGGER_O)
      e:SetCode(EVENT_REMOVE)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp,eg)
        Debug.Message("remove trigger resolved " .. eg:GetFirst():GetCode())
      end)
      watcher:RegisterEffect(e)
      `,
      "remove-trigger.lua",
    );

    expect(result.ok, result.error).toBe(true);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);
    expect(host.messages).toContain("remove count 1");
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "banished" });
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["banished"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1011, eventCardUid: session.state.cards.find((card) => card.code === "200")?.uid });
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expect(applyResponse(session, trigger!).ok).toBe(true);
    expect(host.messages).toContain("remove trigger resolved 200");
  });

  it("lets Lua scripts install Attraction equip procedures and conditions", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Attraction Trap", kind: "trap", typeFlags: 0x4, setcodes: [0x15f] },
      { code: "200", name: "Amazement Monster", kind: "monster", typeFlags: 0x21, setcodes: [0x15e] },
      { code: "300", name: "Opponent Monster", kind: "monster", typeFlags: 0x21 },
    ];
    const session = createDuel({ seed: 157, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["300"] },
    });
    startDuel(session);
    const trap = session.state.cards.find((card) => card.code === "100");
    const ownMonster = session.state.cards.find((card) => card.code === "200");
    const opponentMonster = session.state.cards.find((card) => card.code === "300");
    expect(trap).toBeDefined();
    expect(ownMonster).toBeDefined();
    expect(opponentMonster).toBeDefined();
    moveDuelCard(session.state, trap!.uid, "spellTrapZone", 0).faceUp = true;
    moveDuelCard(session.state, ownMonster!.uid, "monsterZone", 0).faceUp = true;
    moveDuelCard(session.state, opponentMonster!.uid, "monsterZone", 1).faceUp = true;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local trap = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_SZONE, 0, 1, 1, nil):GetFirst()
      local own = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local opp = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, 0, LOCATION_MZONE, 1, 1, nil):GetFirst()
      local e = aux.AddAttractionEquipProc(trap)
      Debug.Message("attraction registered " .. tostring(e:IsHasType(EFFECT_TYPE_ACTIVATE)) .. "/" .. e:GetCode() .. "/" .. tostring(e:GetCost()~=nil) .. "/" .. tostring(e:GetTarget()~=nil) .. "/" .. tostring(e:GetOperation()~=nil))
      Debug.Message("attraction target check " .. tostring(e:GetTarget()(e,0,nil,0,0,nil,0,0,0)))
      Debug.Message("attraction filters " .. tostring(AA.eqtgfilter(own,0)) .. "/" .. tostring(AA.eqtgfilter(opp,0)))
      Duel.Equip(0,trap,own)
      local cond_self = aux.AttractionEquipCon(true)
      local cond_opp = aux.AttractionEquipCon(false)
      local ce = Effect.CreateEffect(trap)
      Debug.Message("attraction condition self " .. tostring(cond_self(ce)) .. "/" .. tostring(cond_opp(ce)))
      Duel.Equip(0,trap,opp)
      Debug.Message("attraction condition opp " .. tostring(cond_self(ce)) .. "/" .. tostring(cond_opp(ce)))
      `,
      "attraction-equip-proc.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("attraction registered true/1002/true/true/true");
    expect(host.messages).toContain("attraction target check true");
    expect(host.messages).toContain("attraction filters true/true");
    expect(host.messages).toContain("attraction condition self true/false");
    expect(host.messages).toContain("attraction condition opp false/true");
  });

  it("lets Lua scripts install Amazement quick equip effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Attraction Trap", kind: "trap", typeFlags: 0x4, setcodes: [0x15f] },
      { code: "200", name: "Amazement Monster", kind: "monster", typeFlags: 0x21, setcodes: [0x15e] },
      { code: "300", name: "Opponent Monster", kind: "monster", typeFlags: 0x21 },
    ];
    const session = createDuel({ seed: 158, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["300"] },
    });
    startDuel(session);
    const trap = session.state.cards.find((card) => card.code === "100");
    const ownMonster = session.state.cards.find((card) => card.code === "200");
    const opponentMonster = session.state.cards.find((card) => card.code === "300");
    expect(trap).toBeDefined();
    expect(ownMonster).toBeDefined();
    expect(opponentMonster).toBeDefined();
    moveDuelCard(session.state, trap!.uid, "spellTrapZone", 0).faceUp = true;
    moveDuelCard(session.state, ownMonster!.uid, "monsterZone", 0).faceUp = true;
    moveDuelCard(session.state, opponentMonster!.uid, "monsterZone", 1).faceUp = true;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local trap = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_SZONE, 0, 1, 1, nil):GetFirst()
      local own = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local opp = Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, 0, LOCATION_MZONE, 1, 1, nil):GetFirst()
      Duel.Equip(0,trap,own)
      local e = aux.AddAmazementQuickEquipEffect(own,200)
      Debug.Message("amazement quick metadata " .. tostring(e:IsHasType(EFFECT_TYPE_QUICK_O)) .. "/" .. e:GetCode() .. "/" .. e:GetDescription() .. "/" .. tostring(e:GetTarget()~=nil) .. "/" .. tostring(e:GetOperation()~=nil))
      Debug.Message("amazement quick filters " .. tostring(AA.eqsfilter(trap,0)) .. "/" .. tostring(AA.eqmfilter(opp,0)))
      Debug.Message("amazement quick target " .. tostring(e:GetTarget()(e,0,nil,0,0,nil,0,0,0)))
      `,
      "amazement-quick-equip.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("amazement quick metadata true/1002/3201/true/true");
    expect(host.messages).toContain("amazement quick filters true/true");
    expect(host.messages).toContain("amazement quick target true");
  });

  it("lets Lua scripts temporarily banish cards through aux.RemoveUntil", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Temporary Banish A", kind: "monster" },
      { code: "200", name: "Temporary Banish B", kind: "monster" },
    ];
    const session = createDuel({ seed: 153, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand")) {
      moveDuelCard(session.state, card.uid, "monsterZone", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local g = Duel.GetMatchingGroup(aux.TRUE, 0, LOCATION_MZONE, 0, nil)
      Debug.Message("remove until result " .. tostring(aux.RemoveUntil(g, POS_FACEUP, REASON_EFFECT, PHASE_END, 777002, nil, 0, aux.DefaultFieldReturnOp)))
      Debug.Message("remove until operated " .. Duel.GetOperatedGroup():GetCount())
      Debug.Message("remove until banished " .. Duel.GetMatchingGroupCount(aux.TRUE, 0, LOCATION_REMOVED, 0, nil))
      Debug.Message("remove until empty " .. tostring(aux.RemoveUntil(Group.CreateGroup(), POS_FACEUP, REASON_EFFECT, PHASE_END, 777002, nil, 0, aux.DefaultFieldReturnOp)))
      `,
      "aux-remove-until.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("remove until result true");
    expect(host.messages).toContain("remove until operated 2");
    expect(host.messages).toContain("remove until banished 2");
    expect(host.messages).toContain("remove until empty false");
  });

  it("lets Lua scripts check steal-equip control requirements", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Steal Source", kind: "monster" },
      { code: "200", name: "Opponent Faceup", kind: "monster" },
      { code: "300", name: "Opponent Facedown", kind: "monster" },
      { code: "400", name: "Own Faceup", kind: "monster" },
    ];
    const session = createDuel({ seed: 40, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "400"] },
      1: { main: ["200", "300"] },
    });
    startDuel(session);
    const source = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
    const own = session.state.cards.find((card) => card.controller === 0 && card.code === "400");
    const opponentFaceup = session.state.cards.find((card) => card.controller === 1 && card.code === "200");
    const opponentFacedown = session.state.cards.find((card) => card.controller === 1 && card.code === "300");
    for (const card of [source, own, opponentFaceup, opponentFacedown]) expect(card).toBeDefined();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, own!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, opponentFaceup!.uid, "monsterZone", 1).position = "faceUpAttack";
    const facedown = moveDuelCard(session.state, opponentFacedown!.uid, "monsterZone", 1);
    facedown.position = "faceDownDefense";
    facedown.faceUp = false;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local source=Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      local own=Duel.GetFieldCard(0, LOCATION_MZONE, 1)
      local faceup=Duel.GetFieldCard(1, LOCATION_MZONE, 0)
      local facedown=Duel.GetFieldCard(1, LOCATION_MZONE, 1)
      local e=Effect.CreateEffect(source)
      Debug.Message("steal checks " .. tostring(aux.CheckStealEquip(faceup,e,0)) .. "/" .. tostring(aux.CheckStealEquip(own,e,0)) .. "/" .. tostring(aux.CheckStealEquip(facedown,e,0)))
      Duel.MoveToField(source,0,0,LOCATION_SZONE,POS_FACEUP_ATTACK,true)
      Debug.Message("steal szone " .. tostring(aux.CheckStealEquip(faceup,e,0)))
      `,
      "check-steal-equip.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("steal checks true/false/false");
    expect(host.messages).toContain("steal szone true");
  });

});
