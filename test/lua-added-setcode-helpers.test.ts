import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { LuaSnapshotRestoreResult } from "#lua/snapshot.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua added setcode helpers", () => {
  it("applies EFFECT_ADD_SETCODE to current card setcode checks and chain info", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Dynamic Setcode Source", kind: "monster" },
      { code: "400", name: "Dynamic Setcode Inspector", kind: "monster" },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 250, startingHandSize: 1, cardReader: reader });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const source = { readScript: addedSetcodeScript };
    const host = createLuaScriptHost(session);
    const sourceLoad = host.loadCardScript(100, source);
    const inspectorLoad = host.loadCardScript(400, source);

    expect(sourceLoad.ok, sourceLoad.error).toBe(true);
    expect(inspectorLoad.ok, inspectorLoad.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
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

    expect(host.messages).toContain("added setcode true/false/356");
    expect(restored.host.messages).toContain("added setcode true/false/356");
    expect(restored.host.messages).toContain("added chain setcodes 1/356");
    expect(restored.host.messages).toContain("added setcode inspector resolved");
    expect(restored.host.messages).toContain("added setcode source resolved");
  });

  it("applies EFFECT_CHANGE_SETCODE and EFFECT_REMOVE_SETCODE to current setcode checks", () => {
    const cards: DuelCardData[] = [
      { code: "200", name: "Dynamic Change-Setcode Source", kind: "monster", setcodes: [0x123] },
      { code: "300", name: "Dynamic Remove-Setcode Source", kind: "monster", setcodes: [0x111, 0x222] },
    ];
    const session = createDuel({ seed: 253, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["200", "300"] }, 1: { main: [] } });
    startDuel(session);

    const source = { readScript: addedSetcodeScript };
    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    expect(host.messages).toContain("changed setcode false/true/true/true/801");
    expect(host.messages).toContain("removed setcode false/true/true/true/546");
  });
});

function addedSetcodeScript(name: string): string | undefined {
  if (name === "c100.lua") {
    return `
      c100={}
      function c100.initial_effect(c)
        c:AddSetcodesRule(100,true,SET_SOLFACHORD)
        Debug.Message("added setcode " .. tostring(c:IsSetCard(SET_SOLFACHORD)) .. "/" .. tostring(c:IsOriginalSetCard(SET_SOLFACHORD)) .. "/" .. c:GetSetCard())
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("added setcode source resolved")
        end)
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
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          if Duel.GetCurrentChain()~=1 then return false end
          local setcodes=Duel.GetChainInfo(1, CHAININFO_TRIGGERING_SETCODES)
          Debug.Message("added chain setcodes " .. #setcodes .. "/" .. setcodes[1])
          for _,setcode in ipairs(setcodes) do
            if (SET_SOLFACHORD&0xfff)==(setcode&0xfff) and (SET_SOLFACHORD&setcode)==SET_SOLFACHORD then
              return true
            end
          end
          return false
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("added setcode inspector resolved")
        end)
        c:RegisterEffect(e)
      end
    `;
  }
  if (name === "c200.lua") {
    return `
      c200={}
      function c200.initial_effect(c)
        local e1=Effect.CreateEffect(c)
        e1:SetType(EFFECT_TYPE_SINGLE)
        e1:SetCode(EFFECT_CHANGE_SETCODE)
        e1:SetValue(0x321)
        c:RegisterEffect(e1)
        local e2=Effect.CreateEffect(c)
        e2:SetType(EFFECT_TYPE_SINGLE)
        e2:SetCode(EFFECT_ADD_SETCODE)
        e2:SetValue(0x654)
        c:RegisterEffect(e2)
        Debug.Message("changed setcode " .. tostring(c:IsSetCard(0x123)) .. "/" .. tostring(c:IsSetCard(0x321)) .. "/" .. tostring(c:IsSetCard(0x654)) .. "/" .. tostring(c:IsOriginalSetCard(0x123)) .. "/" .. c:GetSetCard())
      end
    `;
  }
  if (name === "c300.lua") {
    return `
      c300={}
      function c300.initial_effect(c)
        local e1=Effect.CreateEffect(c)
        e1:SetType(EFFECT_TYPE_SINGLE)
        e1:SetCode(EFFECT_REMOVE_SETCODE)
        e1:SetValue(0x111)
        c:RegisterEffect(e1)
        Debug.Message("removed setcode " .. tostring(c:IsSetCard(0x111)) .. "/" .. tostring(c:IsSetCard(0x222)) .. "/" .. tostring(c:IsNotSetCard(0x111)) .. "/" .. tostring(c:IsOriginalSetCard(0x111)) .. "/" .. c:GetSetCard())
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
