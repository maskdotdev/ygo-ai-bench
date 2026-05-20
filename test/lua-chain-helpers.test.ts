import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

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
        Debug.Message("chain constants " .. CHAININFO_TRIGGERING_EFFECT .. "/" .. CHAININFO_TRIGGERING_CONTROLER .. "/" .. CHAININFO_TARGET_CARDS .. "/" .. CHAININFO_CHAIN_ID .. "/" .. CHAININFO_TRIGGERING_SETCODES)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetTarget(function(e,c)
          local g=Duel.SelectTarget(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_HAND, 0, 1, 1, c)
          Duel.SetOperationInfo(0, CATEGORY_TOHAND, g, g:GetCount(), 0, 0)
          return true
        end)
        e:SetOperation(function(e,c)
          local ok,g,count=Duel.GetOperationInfo(0, CATEGORY_TOHAND)
          Debug.Message("source current operation info " .. tostring(ok) .. "/" .. g:GetFirst():GetCode() .. "/" .. count)
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
          if Duel.GetCurrentChain()~=1 then return false end
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
          local opok,opg,opcount,opp,opparam=Duel.GetOperationInfo(1, CATEGORY_TOHAND)
          Debug.Message("chain operation info " .. tostring(opok) .. "/" .. opg:GetFirst():GetCode() .. "/" .. opcount .. "/" .. opp .. "/" .. opparam)
          Debug.Message("chain target fallback " .. Duel.GetTargetCards():GetCount() .. "/" .. Duel.GetFirstTarget():GetCode())
          Debug.Message("chain target checks " .. tostring(Duel.CheckChainTarget(1,tg:GetFirst())) .. "/" .. tostring(Duel.CheckChainTarget(1,e:GetHandler())))
          Debug.Message("chain unique " .. tostring(Duel.CheckChainUniqueness()))
          return tp==0 and tc:IsCode(100) and tg:GetCount()==1 and handler:IsCode(100) and opok and opg:GetFirst():IsCode(200)
        end)
        e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then return true end
          Duel.SetOperationInfo(0, CATEGORY_TOHAND, e:GetHandler(), 1, tp, 0)
          return true
        end)
        e:SetOperation(function(e,c)
          local ok,g,count=Duel.GetOperationInfo(0, CATEGORY_TOHAND)
          Debug.Message("quick current operation info " .. tostring(ok) .. "/" .. g:GetFirst():GetCode() .. "/" .. count)
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
    applyAndAssert(session, sourceAction!);
    const quickAction = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateEffect");
    expect(quickAction).toBeDefined();
    applyAndAssert(session, quickAction!);
    passChainIfAvailable(session);
    passChainIfAvailable(session);
    passChainIfAvailable(session);
    expect(host.messages).toContain("chain constants 1/3/8/13/30");
    expect(host.messages).toContain("chain solving window false");
    expect(host.messages).toContain("chain info 0/2/100/1/100");
    expect(host.messages).toContain("chain count player 1/0");
    expect(host.messages).toContain("chain stats 0/100/101/4/0/32/2/1800/1200");
    expect(host.messages).toContain("chain type 64/1");
    expect(host.messages).toContain("chain id disable true/0/0");
    expect(host.messages).toContain("chain material 1/200");
    expect(host.messages).toContain("chain operation info true/200/1/0/0");
    expect(host.messages).toContain("chain target fallback 1/200");
    expect(host.messages).toContain("chain target checks true/true");
    expect(host.messages).toContain("chain unique true");
    expect(host.messages).toContain("quick current operation info true/400/1");
    expect(host.messages).toContain("source current operation info true/200/1");
    expect(host.messages).toContain("quick resolved");
    expect(host.messages).toContain("source resolved");
  });

  it("exposes Pendulum Summon type through chain info", () => {
    const cards: DuelCardData[] = [
      { code: "101", name: "Chain Low Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 1, rightScale: 1 },
      { code: "102", name: "Chain High Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 8, rightScale: 8 },
      { code: "301", name: "Chain Pendulum Source", kind: "monster", typeFlags: 0x1000001, level: 4 },
      { code: "400", name: "Chain Pendulum Inspector", kind: "monster" },
    ];
    const session = createDuel({ seed: 247, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["101", "102", "301"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const lowScale = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "101");
    const highScale = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "102");
    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "301");
    expect(lowScale).toBeDefined();
    expect(highScale).toBeDefined();
    expect(source).toBeDefined();
    moveDuelCard(session.state, lowScale!.uid, "spellTrapZone", 0).sequence = 0;
    moveDuelCard(session.state, highScale!.uid, "spellTrapZone", 0).sequence = 1;

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c301={}
      function c301.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_MZONE)
        e:SetOperation(function(e,c)
          Debug.Message("pendulum source resolved")
        end)
        c:RegisterEffect(e)
      end
      c400={}
      function c400.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c)
          local sl,st,complete=Duel.GetChainInfo(1, CHAININFO_TRIGGERING_SUMMON_LOCATION, CHAININFO_TRIGGERING_SUMMON_TYPE, CHAININFO_TRIGGERING_SUMMON_PROC_COMPLETE)
          Debug.Message("pendulum chain summon info " .. sl .. "/" .. st .. "/" .. tostring(st==SUMMON_TYPE_PENDULUM) .. "/" .. tostring(complete))
          return st==SUMMON_TYPE_PENDULUM
        end)
        e:SetOperation(function(e,c)
          Debug.Message("pendulum inspector resolved")
        end)
        c:RegisterEffect(e)
      end
      `,
      "pendulum-chain-summon-info.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const pendulumAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "pendulumSummon" && candidate.summonUids.includes(source!.uid));
    expect(pendulumAction).toBeDefined();
    applyAndAssert(session, { ...pendulumAction!, summonUids: [source!.uid] });
    const sourceAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(sourceAction).toBeDefined();
    applyAndAssert(session, sourceAction!);
    const quickAction = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateEffect");
    expect(quickAction).toBeDefined();
    applyAndAssert(session, quickAction!);
    passChainIfAvailable(session);
    passChainIfAvailable(session);
    expect(host.messages).toContain("pendulum chain summon info 2/1241513984/true/true");
    expect(host.messages).toContain("pendulum inspector resolved");
    expect(host.messages).toContain("pendulum source resolved");
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
    applyAndAssert(session, sourceAction!);
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
    applyAndAssert(session, sourceAction!);
    const allowed = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateEffect");
    expect(allowed).toBeDefined();
    expect(allowed).toMatchObject({ windowId: queryPublicState(session).actionWindowId, windowKind: "chainResponse" });
    expect(getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect")).toBeUndefined();
    applyAndAssert(session, allowed!);
    passChainIfAvailable(session);
    passChainIfAvailable(session);
    expect(host.messages).toContain("allowed quick resolved");
    expect(host.messages).toContain("persistent source resolved");
    expect(host.messages).not.toContain("chain back resolved");
  });

  it("restores Lua response-player chain limits with legal response groups", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Limit Source", kind: "monster" },
      { code: "400", name: "Restore Allowed Quick", kind: "monster" },
      { code: "500", name: "Restore Blocked Quick", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
          c100={}
          function c100.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_IGNITION)
            e:SetRange(LOCATION_HAND)
            e:SetTarget(function(e,tp)
              local responsePlayer=1
              Duel.SetChainLimitTillChainEnd(function(te,rp,cp) return rp==responsePlayer end)
              return true
            end)
            e:SetOperation(function(e,tp) Debug.Message("restore limit source resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c400.lua") {
          return `
          c400={}
          function c400.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_QUICK_O)
            e:SetRange(LOCATION_HAND)
            e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
            e:SetOperation(function(e,tp) Debug.Message("restore allowed quick resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c500.lua") {
          return `
          c500={}
          function c500.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_QUICK_O)
            e:SetRange(LOCATION_HAND)
            e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
            e:SetOperation(function(e,tp) Debug.Message("restore blocked quick resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 54, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "500"] }, 1: { main: ["400"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(400, source).ok).toBe(true);
    expect(host.loadCardScript(500, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const sourceAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(sourceAction).toBeDefined();
    applyAndAssert(session, sourceAction!);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.chainLimitRegistryKeys).toEqual(expect.arrayContaining([expect.stringContaining("known:closure:response-player:1")]));
    expect(queryPublicState(restored.session).pendingTriggerBuckets).toEqual(queryPublicState(session).pendingTriggerBuckets);
    expect(queryPublicState(restored.session).triggerOrderPrompt).toEqual(queryPublicState(session).triggerOrderPrompt);
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual(getDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect")).toBeUndefined();

    const allowed = getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "activateEffect");
    expect(allowed).toBeDefined();
    applyLuaRestoreAndAssert(restored, allowed!);
    expect(restored.host.messages).not.toContain("restore blocked quick resolved");
  });

  it("returns restored Lua chain resolution to turn-player open fast-effect priority", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Open Priority Source", kind: "monster" },
      { code: "300", name: "Restore Turn Open Quick", kind: "monster" },
      { code: "400", name: "Restore Opponent Chain Quick", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
          c100={}
          function c100.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_IGNITION)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("restore open priority source resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c300.lua") {
          return `
          c300={}
          function c300.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_QUICK_O)
            e:SetRange(LOCATION_HAND)
            e:SetCondition(function(e,tp) return Duel.GetCurrentChain()==0 end)
            e:SetOperation(function(e,tp) Debug.Message("restore turn open quick resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c400.lua") {
          return `
          c400={}
          function c400.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_QUICK_O)
            e:SetRange(LOCATION_HAND)
            e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
            e:SetOperation(function(e,tp) Debug.Message("restore opponent chain quick resolved") end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 55, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "300"] }, 1: { main: ["400"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const sourceScript = host.loadCardScript(100, source);
    const turnQuickScript = host.loadCardScript(300, source);
    const opponentQuickScript = host.loadCardScript(400, source);
    expect(sourceScript.ok, sourceScript.error).toBe(true);
    expect(turnQuickScript.ok, turnQuickScript.error).toBe(true);
    expect(opponentQuickScript.ok, opponentQuickScript.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const sourceAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(sourceAction).toBeDefined();
    const opened = applyResponse(session, sourceAction!);
    expect(opened.ok, opened.error).toBe(true);
    expect(opened.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(opened.legalActions).toEqual(getDuelLegalActions(session, 1));
    expect(opened.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, 1));
    expect(opened.legalActionGroups.flatMap((group) => group.actions)).toEqual(opened.legalActions);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(queryPublicState(restored.session).pendingTriggerBuckets).toEqual(queryPublicState(session).pendingTriggerBuckets);
    expect(queryPublicState(restored.session).triggerOrderPrompt).toEqual(queryPublicState(session).triggerOrderPrompt);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    const pass = getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();

    const result = applyLuaRestoreAndAssert(restored, pass!);
    expect(result.state).toMatchObject({ waitingFor: 0, windowKind: "open" });
    expect(result.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", player: 0, windowKind: "open" })]));
    expect(getDuelLegalActions(restored.session, 1)).toEqual([]);
    const stalePass = applyLuaRestoreResponse(restored, pass!);
    expect(stalePass.ok).toBe(false);
    expect(stalePass.error).toContain("Response is not currently legal");
    expect(stalePass.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(stalePass.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(stalePass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(stalePass.legalActionGroups.flatMap((group) => group.actions)).toEqual(stalePass.legalActions);
    assertPublicRestoreMetadata(restored, stalePass);
    expect(restored.host.messages).toContain("restore open priority source resolved");
    expect(restored.host.messages).not.toContain("restore turn open quick resolved");
    expect(restored.host.messages).not.toContain("restore opponent chain quick resolved");
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
    passChainIfAvailable(session);
    passChainIfAvailable(session);
    expect(host.messages).toContain("duplicate chain unique false");
    expect(host.messages).toContain("duplicate source resolved");
  });

  it("lets Lua scripts replace a pending chain operation", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Changed Chain Source", kind: "monster" },
      { code: "400", name: "Chain Operation Replacer", kind: "monster" },
    ];
    const session = createDuel({ seed: 154, startingHandSize: 1, cardReader: createCardReader(cards) });
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
          Debug.Message("original chain operation")
        end)
        c:RegisterEffect(e)
      end
      c400={}
      function c400.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c) return Duel.GetCurrentChain()>0 end)
        e:SetOperation(function(e,c)
          Duel.ChangeChainOperation(1,function(re,tp,eg,ep,ev)
            Debug.Message("changed chain operation " .. tp)
          end)
        end)
        c:RegisterEffect(e)
      end
      `,
      "change-chain-operation.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const sourceAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(sourceAction).toBeDefined();
    applyAndAssert(session, sourceAction!);
    const replacement = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateEffect");
    expect(replacement).toBeDefined();
    applyAndAssert(session, replacement!);
    passChainIfAvailable(session);
    passChainIfAvailable(session);
    expect(host.messages).toContain("changed chain operation 0");
    expect(host.messages).not.toContain("original chain operation");
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
          Debug.Message("target metadata direct " .. Duel.GetTargetPlayer() .. "/" .. Duel.GetTargetParam())
          Duel.ChangeTargetPlayer(0,tp)
          Duel.ChangeTargetParam(0,900)
          local p2,d2=Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)
          Debug.Message("target metadata changed " .. p2 .. "/" .. d2)
          Debug.Message("target metadata direct changed " .. Duel.GetTargetPlayer() .. "/" .. Duel.GetTargetParam())
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
    expect(host.messages).toContain("target metadata direct 1/700");
    expect(host.messages).toContain("target metadata changed 0/900");
    expect(host.messages).toContain("target metadata direct changed 0/900");
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
    applyAndAssert(session, sourceAction!);
    const quickAction = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateEffect");
    expect(quickAction).toBeDefined();
    applyAndAssert(session, quickAction!);
    passChainIfAvailable(session);
    passChainIfAvailable(session);

    expect(host.messages).toContain("negatable true");
    expect(host.messages).toContain("disablable true");
    expect(host.messages).toContain("disable before 0/0");
    expect(host.messages).toContain("negated true");
    expect(host.messages).toContain("disablable after false");
    expect(host.messages).toContain("disable after 64/1");
    expect(host.messages).not.toContain("source resolved");
    expect(session.state.log.some((entry) => entry.action === "chainNegated")).toBe(true);
  });

  it("lets Lua effects negate pending chain links related to a card", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Related Chain Source", kind: "monster" },
      { code: "400", name: "Related Chain Negator", kind: "monster" },
    ];
    const session = createDuel({ seed: 91, startingHandSize: 1, cardReader: createCardReader(cards) });
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
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("related source resolved")
        end)
        c:RegisterEffect(e)
      end
      c400={}
      function c400.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          return Duel.GetCurrentChain()>0
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          local source = Duel.SelectMatchingCard(tp, aux.FilterBoolFunction(Card.IsCode, 100), tp, 0, LOCATION_HAND, 1, 1, nil):GetFirst()
          Duel.NegateRelatedChain(source, RESET_TURN_SET)
          Debug.Message("related negatable after " .. tostring(Duel.IsChainNegatable(1)))
          local reason,player = Duel.GetChainInfo(1, CHAININFO_DISABLE_REASON, CHAININFO_DISABLE_PLAYER)
          Debug.Message("related disable " .. reason .. "/" .. player)
        end)
        c:RegisterEffect(e)
      end
      `,
      "related-chain-negate.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const sourceAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(sourceAction).toBeDefined();
    applyAndAssert(session, sourceAction!);
    const quickAction = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateEffect");
    expect(quickAction).toBeDefined();
    applyAndAssert(session, quickAction!);
    passChainIfAvailable(session);
    passChainIfAvailable(session);

    expect(host.messages).toContain("related negatable after false");
    expect(host.messages).toContain("related disable 64/1");
    expect(host.messages).not.toContain("related source resolved");
    expect(session.state.log.some((entry) => entry.action === "chainNegated" && entry.detail.includes("lua"))).toBe(true);
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
    applyAndAssert(session, normal!);
    const trigger = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);

    expect(host.messages).toContain("condition args 1/1/0/0/true/16/0/100");
    expect(host.messages).toContain("target args 1/400/100");
    expect(host.messages).toContain("operation args 1/100/true");
    expect(host.messages).toContain("chain event 1/0/0/true/16/0/100");
  });

  it("reports the activating player as the Lua event reason player", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Reason Source", kind: "monster" },
      { code: "200", name: "Opponent Event Card", kind: "monster" },
      { code: "400", name: "Reason Trigger", kind: "monster" },
    ];
    const session = createDuel({ seed: 54, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200", "400"] },
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
        e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp)
          Duel.SelectTarget(tp, aux.FilterBoolFunction(Card.IsCode, 200), tp, 0, LOCATION_HAND, 1, 1, c)
          return true
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Duel.SendtoGrave(Duel.GetFirstTarget(), REASON_EFFECT)
          Debug.Message("source reason effect " .. tostring(Duel.GetReasonEffect()==e) .. "/" .. Duel.GetReasonEffect():GetHandler():GetCode())
          local reason_target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, 0, LOCATION_GRAVE, 1, 1, nil):GetFirst()
          Debug.Message("card reason effect " .. tostring(reason_target:GetReasonEffect()==e) .. "/" .. tostring(reason_target:IsReasonEffect(e)))
        end)
        c:RegisterEffect(e)
      end
      c400={}
      function c400.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_TO_GRAVE)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          local ec=eg:GetFirst()
          Debug.Message("reason condition " .. tp .. "/" .. ep .. "/" .. rp .. "/" .. ec:GetControler() .. "/" .. ec:GetReasonPlayer() .. "/" .. Duel.GetReasonPlayer())
          return ec:IsCode(200) and rp==0
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          local ceg,cep,cev,cre,cr,crp=Duel.GetChainEvent(0)
          Debug.Message("reason operation " .. ep .. "/" .. rp .. "/" .. crp .. "/" .. ceg:GetFirst():GetReasonPlayer() .. "/" .. Duel.GetReasonPlayer())
          Debug.Message("trigger reason effect " .. tostring(Duel.GetReasonEffect()==e) .. "/" .. Duel.GetReasonEffect():GetHandler():GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "reason-player-event.lua",
    );

    expect(result.ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const sourceAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(sourceAction).toBeDefined();
    applyAndAssert(session, sourceAction!);
    const trigger = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    applyAndAssert(session, trigger!);

    expect(host.messages).toContain("reason condition 1/1/0/1/0/0");
    expect(host.messages).toContain("source reason effect true/100");
    expect(host.messages).toContain("card reason effect true/true");
    expect(host.messages).toContain("reason operation 1/0/0/0/0");
    expect(host.messages).toContain("trigger reason effect true/400");
  });
});

function passChainIfAvailable(session: ReturnType<typeof createDuel>): boolean {
  const player = session.state.waitingFor;
  if (player === undefined) return false;
  const pass = getDuelLegalActions(session, player).find((candidate) => candidate.type === "passChain");
  return Boolean(pass && applyResponse(session, pass).ok);
}

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: Parameters<typeof applyLuaRestoreResponse>[1]) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  assertPublicRestoreMetadata(restored, response);
  return response;
}

function assertPublicRestoreMetadata(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: ReturnType<typeof applyLuaRestoreResponse>): void {
  const publicState = queryPublicState(restored.session);
  expect(response.state.pendingTriggerBuckets).toEqual(publicState.pendingTriggerBuckets);
  if ("triggerOrderPrompt" in publicState) expect(response.state.triggerOrderPrompt).toEqual(publicState.triggerOrderPrompt);
  else expect(response.state).not.toHaveProperty("triggerOrderPrompt");
}
