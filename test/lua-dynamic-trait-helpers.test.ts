import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData } from "#duel/types.js";
import type { LuaSnapshotRestoreResult } from "#lua/snapshot.js";

describe("Lua dynamic trait helpers", () => {
  it("applies type, race, and attribute effects to Card helpers and restored chain info", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Dynamic Trait Source", kind: "monster", typeFlags: 0x21, level: 4, attack: 1000, defense: 1000, race: 0x1, attribute: 0x10 },
      { code: "400", name: "Dynamic Trait Inspector", kind: "monster" },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 259, startingHandSize: 1, cardReader: reader });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const source = { readScript: dynamicTraitScript };
    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(400, source).ok).toBe(true);
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

    expect(host.messages).toContain("dynamic traits 4097/true/true/false/8194/true/true/48/true/true");
    expect(restored.host.messages).toContain("chain dynamic traits 4097/8194/48");
    expect(restored.host.messages).toContain("dynamic trait inspector resolved");
    expect(restored.host.messages).toContain("dynamic trait source resolved");
  });
});

function dynamicTraitScript(name: string): string | undefined {
  if (name === "c100.lua") {
    return `
      c100={}
      function c100.initial_effect(c)
        local e0=Effect.CreateEffect(c)
        e0:SetType(EFFECT_TYPE_SINGLE)
        e0:SetCode(EFFECT_ADD_TYPE)
        e0:SetValue(TYPE_TUNER)
        c:RegisterEffect(e0)
        local e1=Effect.CreateEffect(c)
        e1:SetType(EFFECT_TYPE_SINGLE)
        e1:SetCode(EFFECT_REMOVE_TYPE)
        e1:SetValue(TYPE_EFFECT)
        c:RegisterEffect(e1)
        local e2=Effect.CreateEffect(c)
        e2:SetType(EFFECT_TYPE_SINGLE)
        e2:SetCode(EFFECT_CHANGE_RACE)
        e2:SetValue(RACE_SPELLCASTER)
        c:RegisterEffect(e2)
        local e3=Effect.CreateEffect(c)
        e3:SetType(EFFECT_TYPE_SINGLE)
        e3:SetCode(EFFECT_ADD_RACE)
        e3:SetValue(RACE_DRAGON)
        c:RegisterEffect(e3)
        local e4=Effect.CreateEffect(c)
        e4:SetType(EFFECT_TYPE_SINGLE)
        e4:SetCode(EFFECT_CHANGE_ATTRIBUTE)
        e4:SetValue(function(e,tc) return ATTRIBUTE_DARK end)
        c:RegisterEffect(e4)
        local e5=Effect.CreateEffect(c)
        e5:SetType(EFFECT_TYPE_SINGLE)
        e5:SetCode(EFFECT_ADD_ATTRIBUTE)
        e5:SetValue(ATTRIBUTE_LIGHT)
        c:RegisterEffect(e5)
        Debug.Message("dynamic traits " .. c:GetType() .. "/" .. tostring(c:IsType(TYPE_TUNER)) .. "/" .. tostring(c:IsMonster()) .. "/" .. tostring(c:IsEffectMonster()) .. "/" .. c:GetRace() .. "/" .. tostring(c:IsRace(RACE_SPELLCASTER)) .. "/" .. tostring(c:IsRace(RACE_DRAGON)) .. "/" .. c:GetAttribute() .. "/" .. tostring(c:IsAttribute(ATTRIBUTE_DARK)) .. "/" .. tostring(c:IsAttribute(ATTRIBUTE_LIGHT)))
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("dynamic trait source resolved")
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
          local typ,race,attr=Duel.GetChainInfo(1, CHAININFO_TRIGGERING_TYPE, CHAININFO_TRIGGERING_RACE, CHAININFO_TRIGGERING_ATTRIBUTE)
          Debug.Message("chain dynamic traits " .. typ .. "/" .. race .. "/" .. attr)
          return typ==(TYPE_MONSTER|TYPE_TUNER) and race==(RACE_SPELLCASTER|RACE_DRAGON) and attr==(ATTRIBUTE_LIGHT|ATTRIBUTE_DARK)
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("dynamic trait inspector resolved")
        end)
        c:RegisterEffect(e)
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
