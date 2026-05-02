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

describe("Lua effect callback metadata helpers", () => {
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
    const cards: DuelCardData[] = [
      { code: "100", name: "No Tribute Source", kind: "monster" },
      { code: "200", name: "No Tribute Target", kind: "monster", level: 7 },
    ];
    const session = createDuel({ seed: 102, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
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
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("no tribute summon before " .. tostring(Duel.IsPlayerCanSummon(0,target)) .. "/" .. tostring(target:IsSummonable()))
      local e1=c:AddNoTributeCheck(160001029,1,1,0)
      local self_range,opp_range=e1:GetTargetRange()
      local reset,reset_count=e1:GetReset()
      Debug.Message("card no tribute " .. e1:GetCode() .. "/" .. e1:GetDescription() .. "/" .. self_range .. "/" .. opp_range .. "/" .. reset_count .. "/" .. tostring(e1:IsHasProperty(EFFECT_FLAG_CLIENT_HINT)))
      Debug.Message("no tribute summon after " .. tostring(Duel.IsPlayerCanSummon(0,target)) .. "/" .. tostring(target:IsSummonable()))
      Debug.Message("no tribute summon result " .. Duel.Summon(target, true, nil) .. "/" .. target:GetLocation() .. "/" .. c:GetLocation())
      local e2=Duel.AddNoTributeCheck(c,0,160001029,2,0,1)
      local player_effect=Duel.IsPlayerAffectedByEffect(1,FLAG_NO_TRIBUTE)
      local self2,opp2=e2:GetTargetRange()
      Debug.Message("duel no tribute " .. tostring(player_effect~=nil) .. "/" .. self2 .. "/" .. opp2)
      `,
      "rush-no-tribute-check.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("no tribute summon before false/false");
    expect(host.messages.some((message) => message.startsWith("card no tribute 160001029/") && message.endsWith("/1/0/1/true"))).toBe(true);
    expect(host.messages).toContain("no tribute summon after true/true");
    expect(host.messages).toContain("no tribute summon result 1/4/4");
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

  it("lets Lua scripts read marked effect label objects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Marked Effect Source", kind: "monster" }];
    const session = createDuel({ seed: 41, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,100),0,LOCATION_HAND,0,1,1,nil):GetFirst()
      local base=Effect.CreateEffect(c)
      base:SetType(EFFECT_TYPE_IGNITION)
      base:SetCode(777001)
      local mark=Effect.CreateEffect(c)
      mark:SetType(EFFECT_TYPE_SINGLE)
      mark:SetCode(777002)
      mark:SetLabelObject(base)
      c:RegisterEffect(mark)
      local marked=c:GetMarkedEffects(777002)
      Debug.Message("marked effects " .. #marked .. "/" .. marked[1]:GetCode())
      `,
      "marked-effects.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("marked effects 1/777001");
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
          local ok,g,count,p,param=Duel.GetOperationInfo(0, CATEGORY_TOHAND)
          Debug.Message("operation info " .. tostring(ok) .. "/" .. g:GetCount() .. "/" .. count .. "/" .. p .. "/" .. param)
          Debug.Message("operation count " .. Duel.GetOperationCount(0))
          local possible,pg,pcount,pp,pparam=Duel.GetPossibleOperationInfo(0, CATEGORY_DRAW)
          Debug.Message("possible operation info " .. tostring(possible) .. "/" .. pg:GetCount() .. "/" .. pcount .. "/" .. pp .. "/" .. pparam)
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
    expect(host.messages).toContain("operation info true/1/1/0/0");
    expect(host.messages).toContain("operation count 1");
    expect(host.messages).toContain("possible operation info true/0/0/1/2");
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

  it("uses the Welcome Labrynth trap destruction helper", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Welcome Trap", kind: "trap", typeFlags: 0x4, setcodes: [0x117f] },
      { code: "200", name: "Destroy Target", kind: "monster" },
      { code: "300", name: "Anchor", kind: "monster" },
    ];
    const session = createDuel({ seed: 15, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);
    const trap = session.state.cards.find((card) => card.code === "100");
    const target = session.state.cards.find((card) => card.code === "200");
    expect(trap).toBeTruthy();
    expect(target).toBeTruthy();
    moveDuelCard(session.state, trap!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_SZONE, 0, 1, 1, nil):GetFirst()
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      local addeff=Effect.GlobalEffect()
      addeff:SetType(EFFECT_TYPE_FIELD)
      addeff:SetCode(CARD_LABRYNTH_LABYRINTH)
      addeff:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
      addeff:SetTargetRange(1,0)
      addeff:SetCountLimit(1, CARD_LABRYNTH_LABYRINTH)
      Duel.RegisterEffect(addeff,0)
      local activate=Effect.CreateEffect(c)
      activate:SetType(EFFECT_TYPE_ACTIVATE)
      Debug.Message("welcome before " .. tostring(addeff:CheckCountLimit(0)) .. "/" .. target:GetLocation())
      aux.WelcomeLabrynthTrapDestroyOperation(activate,0)
      Debug.Message("welcome after " .. tostring(addeff:CheckCountLimit(0)) .. "/" .. tostring(target:IsLocation(LOCATION_GRAVE)))
      `,
      "welcome-labrynth-helper.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("welcome before true/4");
    expect(host.messages).toContain("welcome after false/true");
  });
});
