import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { LuaSnapshotRestoreResult } from "#lua/snapshot.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua dynamic code helpers", () => {
  it("applies EFFECT_ADD_CODE and EFFECT_CHANGE_CODE to current code checks and chain info", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Dynamic Add-Code Source", kind: "monster" },
      { code: "200", name: "Dynamic Change-Code Probe", kind: "monster" },
      { code: "400", name: "Dynamic Code Inspector", kind: "monster" },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 251, startingHandSize: 2, cardReader: reader });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const source = { readScript: dynamicCodeScript };
    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.loadCardScript(400, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const sourceUid = session.state.cards.find((card) => card.code === "100" && card.owner === 0)?.uid;
    const sourceAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === sourceUid);
    expect(sourceAction).toBeDefined();
    applyAndAssert(session, sourceAction!);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const quickAction = getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "activateEffect");
    expect(quickAction).toBeDefined();
    applyLuaRestoreAndAssert(restored, quickAction!);
    passRestoredChainIfAvailable(restored);
    passRestoredChainIfAvailable(restored);

    expect(host.messages).toContain("add code 100/true/true/false/true");
    expect(host.messages).toContain("change code 901/false/true/true/true/true");
    expect(restored.host.messages).toContain("chain codes 100/900");
    expect(restored.host.messages).toContain("dynamic code inspector resolved");
    expect(restored.host.messages).toContain("dynamic code source resolved");
  });

  it("applies EFFECT_REMOVE_CODE to current code checks", () => {
    const cards: DuelCardData[] = [
      { code: "500", alias: "501", name: "Dynamic Remove-Code Source", kind: "monster" },
    ];
    const session = createDuel({ seed: 252, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["500"] }, 1: { main: [] } });
    startDuel(session);

    const source = { readScript: dynamicCodeScript };
    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(500, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(host.messages).toContain("remove code 501/false/true/true/true/false/true");
  });
});

function dynamicCodeScript(name: string): string | undefined {
  if (name === "c100.lua") {
    return `
      c100={}
      function c100.initial_effect(c)
        local e0=Effect.CreateEffect(c)
        e0:SetType(EFFECT_TYPE_SINGLE)
        e0:SetCode(EFFECT_ADD_CODE)
        e0:SetValue(900)
        c:RegisterEffect(e0)
        Debug.Message("add code " .. c:GetCode() .. "/" .. tostring(c:IsCode(100)) .. "/" .. tostring(c:IsCode(900)) .. "/" .. tostring(c:IsNotCode(900)) .. "/" .. tostring(c:IsSummonCode(nil,0,0,900)))
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("dynamic code source resolved")
        end)
        c:RegisterEffect(e)
      end
    `;
  }
  if (name === "c200.lua") {
    return `
      c200={}
      function c200.initial_effect(c)
        local e0=Effect.CreateEffect(c)
        e0:SetType(EFFECT_TYPE_SINGLE)
        e0:SetCode(EFFECT_CHANGE_CODE)
        e0:SetValue(901)
        c:RegisterEffect(e0)
        Debug.Message("change code " .. c:GetCode() .. "/" .. tostring(c:IsCode(200)) .. "/" .. tostring(c:IsCode(901)) .. "/" .. tostring(c:IsNotCode(200)) .. "/" .. tostring(c:IsOriginalCode(200)) .. "/" .. tostring(c:IsSummonCode(nil,0,0,901)))
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
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          if Duel.GetCurrentChain()~=1 then return false end
          local code1,code2=Duel.GetChainInfo(1, CHAININFO_TRIGGERING_CODE, CHAININFO_TRIGGERING_CODE2)
          Debug.Message("chain codes " .. code1 .. "/" .. code2)
          return code1==100 and code2==900
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("dynamic code inspector resolved")
        end)
        c:RegisterEffect(e)
      end
    `;
  }
  if (name === "c500.lua") {
    return `
      c500={}
      function c500.initial_effect(c)
        local e0=Effect.CreateEffect(c)
        e0:SetType(EFFECT_TYPE_SINGLE)
        e0:SetCode(EFFECT_ADD_CODE)
        e0:SetValue(900)
        c:RegisterEffect(e0)
        local e1=Effect.CreateEffect(c)
        e1:SetType(EFFECT_TYPE_SINGLE)
        e1:SetCode(EFFECT_REMOVE_CODE)
        e1:SetValue(500)
        c:RegisterEffect(e1)
        Debug.Message("remove code " .. c:GetCode() .. "/" .. tostring(c:IsCode(500)) .. "/" .. tostring(c:IsCode(501)) .. "/" .. tostring(c:IsCode(900)) .. "/" .. tostring(c:IsNotCode(500)) .. "/" .. tostring(c:IsOriginalCode(501)) .. "/" .. tostring(c:IsOriginalCode(500)))
      end
    `;
  }
  return undefined;
}

function passRestoredChainIfAvailable(restored: LuaSnapshotRestoreResult): boolean {
  const player = restored.session.state.waitingFor;
  if (player === undefined) return false;
  const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
  return Boolean(pass && applyLuaRestoreResponse(restored, pass).ok);
}

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function applyLuaRestoreAndAssert(restored: LuaSnapshotRestoreResult, action: Parameters<typeof applyLuaRestoreResponse>[1]) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
