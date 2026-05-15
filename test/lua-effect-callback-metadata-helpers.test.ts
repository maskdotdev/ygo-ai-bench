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
import { createLuaScriptHost, type LuaScriptSource } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

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
    applyAndAssert(session, action!);
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
    applyAndAssert(session, firstAction!);
    passCurrentChain(session);
    passCurrentChain(session);
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
    applyAndAssert(session, action!);
    passCurrentChain(session);
    passCurrentChain(session);
    expect(host.messages).toContain("target label 7");
    expect(host.messages).toContain("operation label 8");
    expect(host.messages).toContain("label object count 1");
  });

  it("restores Lua group label objects captured before trigger activation", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Group Label Source", kind: "monster" },
      { code: "200", name: "Group Label Target A", kind: "monster" },
      { code: "201", name: "Group Label Target B", kind: "monster" },
      { code: "300", name: "Group Label Summon", kind: "monster" },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 457, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["100", "200", "201", "300"] }, 1: { main: [] } });
    startDuel(session);
    const sourceCard = session.state.cards.find((card) => card.code === "100");
    const summoned = session.state.cards.find((card) => card.code === "300");
    expect(sourceCard).toBeDefined();
    expect(summoned).toBeDefined();
    moveDuelCard(session.state, sourceCard!.uid, "monsterZone", 0);
    sourceCard!.sequence = 2;
    sourceCard!.faceUp = true;
    sourceCard!.position = "faceUpAttack";
    moveDuelCard(session.state, summoned!.uid, "hand", 0);
    for (const [index, code] of ["200", "201"].entries()) {
      const target = session.state.cards.find((card) => card.code === code);
      expect(target).toBeDefined();
      moveDuelCard(session.state, target!.uid, "monsterZone", 0);
      target!.sequence = index;
      target!.faceUp = true;
      target!.position = "faceUpAttack";
    }
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = groupLabelSource();
    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript("100", source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const summon = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === summoned!.uid);
    expect(summon, JSON.stringify(getDuelLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, summon!);
    expect(host.messages).toContain("group label condition 2");

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.uid === sourceCard!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    const result = applyLuaRestoreResponse(restored, trigger!);
    expect(result.ok, result.error).toBe(true);
    expect(restored.host.messages).toContain("group label operation true/2");
  });

  it("restores Lua group label objects captured by activation targets", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Chain Group Label Source", kind: "monster" },
      { code: "200", name: "Chain Group Target A", kind: "monster" },
      { code: "201", name: "Chain Group Target B", kind: "monster" },
      { code: "400", name: "Chain Responder", kind: "monster" },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 458, startingHandSize: 3, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["100", "200", "201"] }, 1: { main: ["400"] } });
    startDuel(session);

    const source = chainLinkGroupLabelSource();
    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript("100", source).ok).toBe(true);
    expect(host.loadCardScript("400", source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const sourceCard = session.state.cards.find((card) => card.code === "100");
    expect(sourceCard).toBeDefined();
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === sourceCard!.uid);
    expect(action, JSON.stringify(getDuelLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, action!);
    expect(host.messages).toContain("chain group target 2");

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    const pass = getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, 1), null, 2)).toBeDefined();
    const result = applyLuaRestoreResponse(restored, pass!);
    expect(result.ok, result.error).toBe(true);
    expect(restored.host.messages.some((message) => message.startsWith("chain group operation true/2/"))).toBe(true);
  });

  it("restores Lua group label objects captured by activation conditions", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Condition Group Label Source", kind: "monster" },
      { code: "200", name: "Condition Group Target A", kind: "monster" },
      { code: "201", name: "Condition Group Target B", kind: "monster" },
      { code: "400", name: "Condition Chain Responder", kind: "monster" },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 459, startingHandSize: 3, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["100", "200", "201"] }, 1: { main: ["400"] } });
    startDuel(session);

    const source = activationConditionGroupLabelSource();
    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript("100", source).ok).toBe(true);
    expect(host.loadCardScript("400", source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const sourceCard = session.state.cards.find((card) => card.code === "100");
    expect(sourceCard).toBeDefined();
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === sourceCard!.uid);
    expect(action, JSON.stringify(getDuelLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, action!);
    expect(host.messages).toContain("condition group label 2");

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    const pass = getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, 1), null, 2)).toBeDefined();
    const result = applyLuaRestoreResponse(restored, pass!);
    expect(result.ok, result.error).toBe(true);
    expect(restored.host.messages.some((message) => message.startsWith("condition group operation true/2/"))).toBe(true);
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
    applyAndAssert(session, action!);
    passCurrentChain(session);
    passCurrentChain(session);
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
    applyAndAssert(session, action!);
    passCurrentChain(session);
    passCurrentChain(session);
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

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function passCurrentChain(session: ReturnType<typeof createDuel>): boolean {
  const player = session.state.waitingFor ?? session.state.turnPlayer;
  const pass = getDuelLegalActions(session, player).find((candidate) => candidate.type === "passChain");
  if (!pass) return false;
  applyAndAssert(session, pass);
  return true;
}

function groupLabelSource(): LuaScriptSource {
  return {
    readScript(name) {
      if (name !== "c100.lua") return undefined;
      return `
        local s,id=GetID()
        function s.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)
          e:SetCode(EVENT_SUMMON_SUCCESS)
          e:SetRange(LOCATION_MZONE)
          e:SetCondition(function(e,tp)
            local g=Duel.GetMatchingGroup(function(tc) return tc:IsFaceup() and (tc:IsCode(200) or tc:IsCode(201)) end,tp,LOCATION_MZONE,0,nil)
            g:KeepAlive()
            e:SetLabelObject(g)
            Debug.Message("group label condition " .. g:GetCount())
            return g:GetCount()==2
          end)
          e:SetOperation(function(e,tp)
            local g=e:GetLabelObject()
            Debug.Message("group label operation " .. tostring(g~=nil) .. "/" .. (g and g:GetCount() or -1))
          end)
          c:RegisterEffect(e)
        end
      `;
    },
  };
}

function chainLinkGroupLabelSource(): LuaScriptSource {
  return {
    readScript(name) {
      if (name === "c400.lua") {
        return `
          local s,id=GetID()
          function s.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_QUICK_O)
            e:SetCode(EVENT_FREE_CHAIN)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("chain responder resolved") end)
            c:RegisterEffect(e)
          end
        `;
      }
      if (name !== "c100.lua") return undefined;
      return `
        local s,id=GetID()
        function s.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_IGNITION)
          e:SetRange(LOCATION_HAND)
          e:SetTarget(function(e,tp)
            local g=Duel.GetMatchingGroup(function(tc) return tc:IsCode(200) or tc:IsCode(201) end,tp,LOCATION_HAND,0,nil)
            g:KeepAlive()
            e:SetLabelObject(g)
            Debug.Message("chain group target " .. g:GetCount())
            return true
          end)
          e:SetOperation(function(e,tp)
            local g=e:GetLabelObject()
            Debug.Message("chain group operation " .. tostring(g~=nil) .. "/" .. (g and g:GetCount() or -1) .. "/" .. (g and g:GetFirst():GetCode() or -1))
          end)
          c:RegisterEffect(e)
        end
      `;
    },
  };
}

function activationConditionGroupLabelSource(): LuaScriptSource {
  return {
    readScript(name) {
      if (name === "c400.lua") {
        return `
          local s,id=GetID()
          function s.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_QUICK_O)
            e:SetCode(EVENT_FREE_CHAIN)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("condition responder resolved") end)
            c:RegisterEffect(e)
          end
        `;
      }
      if (name !== "c100.lua") return undefined;
      return `
        local s,id=GetID()
        function s.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_IGNITION)
          e:SetRange(LOCATION_HAND)
          e:SetCondition(function(e,tp)
            local g=Duel.GetMatchingGroup(function(tc) return tc:IsCode(200) or tc:IsCode(201) end,tp,LOCATION_HAND,0,nil)
            g:KeepAlive()
            e:SetLabelObject(g)
            Debug.Message("condition group label " .. g:GetCount())
            return g:GetCount()==2
          end)
          e:SetOperation(function(e,tp)
            local g=e:GetLabelObject()
            Debug.Message("condition group operation " .. tostring(g~=nil) .. "/" .. (g and g:GetCount() or -1) .. "/" .. (g and g:GetFirst():GetCode() or -1))
          end)
          c:RegisterEffect(e)
        end
      `;
    },
  };
}
