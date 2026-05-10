import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelCardData } from "#duel/types.js";
import type { LuaSnapshotRestoreResult } from "#lua/snapshot.js";

describe("Lua chain current stat info", () => {
  it("restores chain responses that inspect current triggering card stats", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Current Stat Chain Source", kind: "monster", typeFlags: 0x21, level: 4, attack: 1000, defense: 1000, race: 0x1, attribute: 0x10 },
      { code: "400", name: "Current Stat Chain Inspector", kind: "monster" },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 257, startingHandSize: 1, cardReader: reader });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const source = { readScript: currentStatScript };
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

    expect(host.messages).toContain("current source stats 4097/7/6/32/2/2500/2100");
    expect(restored.host.messages).toContain("chain current stats 4097/7/6/32/2/2500/2100");
    expect(restored.host.messages).toContain("current stat inspector resolved");
    expect(restored.host.messages).toContain("current stat source resolved");
  });
});

function currentStatScript(name: string): string | undefined {
  if (name === "c100.lua") {
    return `
      c100={}
      function c100.initial_effect(c)
        c:AssumeProperty(ASSUME_TYPE, TYPE_MONSTER|TYPE_TUNER)
        c:AssumeProperty(ASSUME_LEVEL, 7)
        c:AssumeProperty(ASSUME_RANK, 6)
        c:AssumeProperty(ASSUME_ATTRIBUTE, ATTRIBUTE_DARK)
        c:AssumeProperty(ASSUME_RACE, RACE_SPELLCASTER)
        c:AssumeProperty(ASSUME_ATTACK, 2500)
        c:AssumeProperty(ASSUME_DEFENSE, 2100)
        Debug.Message("current source stats " .. c:GetType() .. "/" .. c:GetLevel() .. "/" .. c:GetRank() .. "/" .. c:GetAttribute() .. "/" .. c:GetRace() .. "/" .. c:GetAttack() .. "/" .. c:GetDefense())
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("current stat source resolved")
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
          local typ,lv,rank,attr,race,atk,def=Duel.GetChainInfo(1, CHAININFO_TRIGGERING_TYPE, CHAININFO_TRIGGERING_LEVEL, CHAININFO_TRIGGERING_RANK, CHAININFO_TRIGGERING_ATTRIBUTE, CHAININFO_TRIGGERING_RACE, CHAININFO_TRIGGERING_ATTACK, CHAININFO_TRIGGERING_DEFENSE)
          Debug.Message("chain current stats " .. typ .. "/" .. lv .. "/" .. rank .. "/" .. attr .. "/" .. race .. "/" .. atk .. "/" .. def)
          return typ==(TYPE_MONSTER|TYPE_TUNER) and lv==7 and rank==6 and attr==ATTRIBUTE_DARK and race==RACE_SPELLCASTER and atk==2500 and def==2100
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("current stat inspector resolved")
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
