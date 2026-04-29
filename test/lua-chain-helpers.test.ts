import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua chain helpers", () => {
  it("lets Lua quick effects inspect pending chain info", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Chain Source", kind: "monster", alias: "101", level: 4, attack: 1800, defense: 1200, race: 0x2, attribute: 0x20 },
      { code: "200", name: "Chain Target", kind: "monster" },
      { code: "400", name: "Chain Quick", kind: "monster" },
    ];
    const session = createDuel({ seed: 24, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["400", "200"] },
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
          local g=Duel.SelectTarget(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, c)
          Duel.SetOperationInfo(0, CATEGORY_TOHAND, g, g:GetCount(), 0, 0)
          return true
        end)
        e:SetOperation(function(e,c)
          Debug.Message("source resolved")
        end)
        c:RegisterEffect(e)
      end
      c400={}
      function c400.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c)
          local te,tp,loc,tc,tg=Duel.GetChainInfo(1, CHAININFO_TRIGGERING_EFFECT, CHAININFO_TRIGGERING_PLAYER, CHAININFO_TRIGGERING_LOCATION, CHAININFO_TRIGGERING_CARD, CHAININFO_TARGET_CARDS)
          local ok,handler=pcall(function() return te:GetHandler() end)
          Debug.Message("handler ok " .. tostring(ok) .. "/" .. tostring(handler ~= nil))
          if not ok then return false end
          Debug.Message("chain solving window " .. tostring(Duel.IsChainSolving()))
          Debug.Message("chain info " .. tp .. "/" .. loc .. "/" .. tc:GetCode() .. "/" .. tg:GetCount() .. "/" .. handler:GetCode())
          Debug.Message("chain count player " .. Duel.GetChainCount() .. "/" .. Duel.GetChainPlayer(1))
          local pos,code,code2,level,rank,attr,race,atk,def=Duel.GetChainInfo(1, CHAININFO_TRIGGERING_POSITION, CHAININFO_TRIGGERING_CODE, CHAININFO_TRIGGERING_CODE2, CHAININFO_TRIGGERING_LEVEL, CHAININFO_TRIGGERING_RANK, CHAININFO_TRIGGERING_ATTRIBUTE, CHAININFO_TRIGGERING_RACE, CHAININFO_TRIGGERING_ATTACK, CHAININFO_TRIGGERING_DEFENSE)
          Debug.Message("chain stats " .. pos .. "/" .. code .. "/" .. code2 .. "/" .. level .. "/" .. rank .. "/" .. attr .. "/" .. race .. "/" .. atk .. "/" .. def)
          local chain_type,chain_exttype=Duel.GetChainInfo(1, CHAININFO_TYPE, CHAININFO_EXTTYPE)
          Debug.Message("chain type " .. chain_type .. "/" .. chain_exttype)
          local chain_id,disable_reason,disable_player=Duel.GetChainInfo(1, CHAININFO_CHAIN_ID, CHAININFO_DISABLE_REASON, CHAININFO_DISABLE_PLAYER)
          Debug.Message("chain id disable " .. tostring(chain_id>0) .. "/" .. disable_reason .. "/" .. disable_player)
          local mat=Duel.GetChainMaterial(1)
          Debug.Message("chain material " .. mat:GetCount() .. "/" .. mat:GetFirst():GetCode())
          Debug.Message("chain target fallback " .. Duel.GetTargetCards():GetCount() .. "/" .. Duel.GetFirstTarget():GetCode())
          Debug.Message("chain target checks " .. tostring(Duel.CheckChainTarget(1,tg:GetFirst())) .. "/" .. tostring(Duel.CheckChainTarget(1,e:GetHandler())))
          Debug.Message("chain unique " .. tostring(Duel.CheckChainUniqueness()))
          return tp==0 and tc:IsCode(100) and tg:GetCount()==1 and handler:IsCode(100)
        end)
        e:SetOperation(function(e,c)
          Debug.Message("quick resolved")
        end)
        c:RegisterEffect(e)
      end
      `,
      "chain-info.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const sourceUid = session.state.cards.find((card) => card.code === "100" && card.owner === 0)?.uid;
    const sourceAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === sourceUid);
    expect(sourceAction).toBeDefined();
    const opened = applyResponse(session, sourceAction!);
    expect(opened.ok).toBe(true);
    const quickAction = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateEffect");
    expect(quickAction).toBeDefined();
    applyResponse(session, quickAction!);
    applyResponse(session, { type: "passChain", player: 0, label: "Pass" });
    applyResponse(session, { type: "passChain", player: 1, label: "Pass" });
    expect(host.messages).toContain("chain solving window false");
    expect(host.messages).toContain("chain info 0/2/100/1/100");
    expect(host.messages).toContain("chain count player 1/0");
    expect(host.messages).toContain("chain stats 0/100/101/4/0/32/2/1800/1200");
    expect(host.messages).toContain("chain type 64/1");
    expect(host.messages).toContain("chain id disable true/0/0");
    expect(host.messages).toContain("chain material 1/200");
    expect(host.messages).toContain("chain target fallback 1/200");
    expect(host.messages).toContain("chain target checks true/false");
    expect(host.messages).toContain("chain unique true");
    expect(host.messages).toContain("quick resolved");
    expect(host.messages).toContain("source resolved");
  });

  it("lets Lua effects block immediate chain responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Limit Source", kind: "monster" },
      { code: "400", name: "Blocked Quick", kind: "monster" },
    ];
    const session = createDuel({ seed: 52, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
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
          Duel.SetChainLimit(aux.FALSE)
          return true
        end)
        e:SetOperation(function(e,c)
          Debug.Message("limit source resolved")
        end)
        c:RegisterEffect(e)
      end
      c400={}
      function c400.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c)
          return Duel.GetCurrentChain()>0
        end)
        e:SetOperation(function(e,c)
          Debug.Message("blocked quick resolved")
        end)
        c:RegisterEffect(e)
      end
      `,
      "chain-limit.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const sourceAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(sourceAction).toBeDefined();
    expect(applyResponse(session, sourceAction!).ok).toBe(true);
    expect(host.messages).toContain("limit source resolved");
    expect(host.messages).not.toContain("blocked quick resolved");
  });

  it("keeps Lua chain limits until the chain resolves", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Persistent Limit Source", kind: "monster" },
      { code: "400", name: "Allowed Quick", kind: "monster" },
      { code: "500", name: "Blocked Chain Back", kind: "monster" },
    ];
    const session = createDuel({ seed: 53, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "500"] },
      1: { main: ["400"] },
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
          Duel.SetChainLimitTillChainEnd(function(te,rp,tp) return rp==1 end)
          return true
        end)
        e:SetOperation(function(e,c)
          Debug.Message("persistent source resolved")
        end)
        c:RegisterEffect(e)
      end
      c400={}
      function c400.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c) return Duel.GetCurrentChain()>0 end)
        e:SetOperation(function(e,c) Debug.Message("allowed quick resolved") end)
        c:RegisterEffect(e)
      end
      c500={}
      function c500.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c) return Duel.GetCurrentChain()>0 end)
        e:SetOperation(function(e,c) Debug.Message("chain back resolved") end)
        c:RegisterEffect(e)
      end
      `,
      "chain-limit-persistent.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    const sourceUid = session.state.cards.find((card) => card.code === "100" && card.owner === 0)?.uid;
    const sourceAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === sourceUid);
    expect(sourceAction).toBeDefined();
    expect(applyResponse(session, sourceAction!).ok).toBe(true);
    const allowed = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateEffect");
    expect(allowed).toBeDefined();
    expect(applyResponse(session, allowed!).ok).toBe(true);
    expect(host.messages).toContain("allowed quick resolved");
    expect(host.messages).toContain("persistent source resolved");
    expect(host.messages).not.toContain("chain back resolved");
  });

  it("detects duplicate card codes in the current Lua chain", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Duplicate Chain Source", kind: "monster" },
    ];
    const session = createDuel({ seed: 51, startingHandSize: 1, cardReader: createCardReader(cards) });
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
        local e1=Effect.CreateEffect(c)
        e1:SetType(EFFECT_TYPE_IGNITION)
        e1:SetRange(LOCATION_HAND)
        e1:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("duplicate source resolved")
        end)
        c:RegisterEffect(e1)
        local e2=Effect.CreateEffect(c)
        e2:SetType(EFFECT_TYPE_QUICK_O)
        e2:SetRange(LOCATION_HAND)
        e2:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          return Duel.GetCurrentChain()>0
        end)
        e2:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("duplicate chain unique " .. tostring(Duel.CheckChainUniqueness()))
        end)
        c:RegisterEffect(e2)
      end
      `,
      "duplicate-chain.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const sourceUid = session.state.cards.find((card) => card.code === "100" && card.owner === 0)?.uid;
    const sourceAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === sourceUid);
    expect(sourceAction).toBeDefined();
    applyResponse(session, sourceAction!);
    const quickAction = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateEffect");
    expect(quickAction).toBeDefined();
    applyResponse(session, quickAction!);
    applyResponse(session, { type: "passChain", player: 0, label: "Pass" });
    applyResponse(session, { type: "passChain", player: 1, label: "Pass" });
    expect(host.messages).toContain("duplicate chain unique false");
    expect(host.messages).toContain("duplicate source resolved");
  });

  it("lets Lua effects carry target player and parameter metadata", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Target Metadata Source", kind: "monster" },
    ];
    const session = createDuel({ seed: 50, startingHandSize: 1, cardReader: createCardReader(cards) });
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
        e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then return true end
          Duel.SetTargetPlayer(1-tp)
          Duel.SetTargetParam(700)
          return true
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("target metadata solving " .. tostring(Duel.IsChainSolving()))
          Debug.Message("target metadata chain player " .. Duel.GetChainPlayer(0))
          local p,d=Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)
          Debug.Message("target metadata " .. p .. "/" .. d)
          Duel.ChangeTargetPlayer(0,tp)
          Duel.ChangeTargetParam(0,900)
          local p2,d2=Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)
          Debug.Message("target metadata changed " .. p2 .. "/" .. d2)
        end)
        c:RegisterEffect(e)
      end
      `,
      "target-metadata.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    applyResponse(session, action!);
    expect(host.messages).toContain("target metadata solving true");
    expect(host.messages).toContain("target metadata chain player 0");
    expect(host.messages).toContain("target metadata 1/700");
    expect(host.messages).toContain("target metadata changed 0/900");
  });

  it("lets Lua quick effects negate pending chain links", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Negated Source", kind: "monster" },
      { code: "400", name: "Negating Quick", kind: "monster" },
    ];
    const session = createDuel({ seed: 25, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
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
        e:SetOperation(function(e,c)
          Debug.Message("source resolved")
        end)
        c:RegisterEffect(e)
      end
      c400={}
      function c400.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c)
          return Duel.GetCurrentChain()>0 and Duel.IsChainNegatable(1) and Duel.IsChainDisablable(1)
        end)
        e:SetOperation(function(e,c)
          Debug.Message("negatable " .. tostring(Duel.IsChainNegatable(1)))
          Debug.Message("disablable " .. tostring(Duel.IsChainDisablable(1)))
          local before_reason,before_player=Duel.GetChainInfo(1, CHAININFO_DISABLE_REASON, CHAININFO_DISABLE_PLAYER)
          Debug.Message("disable before " .. before_reason .. "/" .. before_player)
          Debug.Message("negated " .. tostring(Duel.NegateEffect(1)))
          Debug.Message("disablable after " .. tostring(Duel.IsChainDisablable(1)))
          local after_reason,after_player=Duel.GetChainInfo(1, CHAININFO_DISABLE_REASON, CHAININFO_DISABLE_PLAYER)
          Debug.Message("disable after " .. after_reason .. "/" .. after_player)
        end)
        c:RegisterEffect(e)
      end
      `,
      "chain-negate.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const sourceAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(sourceAction).toBeDefined();
    expect(applyResponse(session, sourceAction!).ok).toBe(true);
    const quickAction = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateEffect");
    expect(quickAction).toBeDefined();
    expect(applyResponse(session, quickAction!).ok).toBe(true);
    applyResponse(session, { type: "passChain", player: 0, label: "Pass" });
    applyResponse(session, { type: "passChain", player: 1, label: "Pass" });

    expect(host.messages).toContain("negatable true");
    expect(host.messages).toContain("disablable true");
    expect(host.messages).toContain("disable before 0/0");
    expect(host.messages).toContain("negated true");
    expect(host.messages).toContain("disablable after false");
    expect(host.messages).toContain("disable after 64/1");
    expect(host.messages).not.toContain("source resolved");
    expect(session.state.log.some((entry) => entry.action === "chainNegated")).toBe(true);
  });

  it("passes upstream-style Lua callback arguments to trigger effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summoned Event", kind: "monster" },
      { code: "400", name: "Argument Trigger", kind: "monster" },
    ];
    const session = createDuel({ seed: 26, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c400={}
      function c400.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          local ec=eg:GetFirst()
          Debug.Message("condition args " .. tp .. "/" .. eg:GetCount() .. "/" .. ep .. "/" .. ev .. "/" .. tostring(re==nil) .. "/" .. r .. "/" .. rp .. "/" .. ec:GetCode())
          return tp==1 and eg:GetCount()==1 and ep==0 and ec:IsCode(100)
        end)
        e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp)
          local handler=e:GetHandler()
          Debug.Message("target args " .. tp .. "/" .. handler:GetCode() .. "/" .. eg:GetFirst():GetCode())
          return true
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("operation args " .. tp .. "/" .. eg:GetFirst():GetCode() .. "/" .. tostring(re==nil))
          local ceg,cep,cev,cre,cr,crp=Duel.GetChainEvent(0)
          Debug.Message("chain event " .. ceg:GetCount() .. "/" .. cep .. "/" .. cev .. "/" .. tostring(cre==nil) .. "/" .. cr .. "/" .. crp .. "/" .. ceg:GetFirst():GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "callback-args.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const normal = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon");
    expect(normal).toBeDefined();
    expect(applyResponse(session, normal!).ok).toBe(true);
    const trigger = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expect(applyResponse(session, trigger!).ok).toBe(true);

    expect(host.messages).toContain("condition args 1/1/0/0/true/16/0/100");
    expect(host.messages).toContain("target args 1/400/100");
    expect(host.messages).toContain("operation args 1/100/true");
    expect(host.messages).toContain("chain event 1/0/0/true/16/0/100");
  });
});
