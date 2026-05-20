import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Elemental HERO Wildheart Trap immunity", () => {
  it("restores always-on Trap immunity and blocks a restored Trap destruction effect", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const wildheartCode = "86188410";
    const destroyTrapCode = "86188411";
    const spellProbeCode = "86188412";
    const responderCode = "86188413";
    const script = workspace.readScript(`official/c${wildheartCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_IMMUNE_EFFECT)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_SINGLE_RANGE)");
    expect(script).toContain("return te:IsTrapEffect()");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === wildheartCode),
      { code: destroyTrapCode, name: "Wildheart Trap Destroy Probe", kind: "trap", typeFlags: 0x4 },
      { code: spellProbeCode, name: "Wildheart Spell Probe", kind: "spell", typeFlags: 0x2 },
      { code: responderCode, name: "Wildheart Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const source = {
      readScript(name: string) {
        if (name === `c${destroyTrapCode}.lua`) return destroyTrapScript();
        if (name === `c${spellProbeCode}.lua`) return spellProbeScript();
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const session = createDuel({ seed: 861, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [wildheartCode, destroyTrapCode, spellProbeCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const wildheart = session.state.cards.find((card) => card.code === wildheartCode);
    const destroyTrap = session.state.cards.find((card) => card.code === destroyTrapCode);
    const spellProbe = session.state.cards.find((card) => card.code === spellProbeCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(wildheart).toBeDefined();
    expect(destroyTrap).toBeDefined();
    expect(spellProbe).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, wildheart!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, destroyTrap!.uid, "spellTrapZone", 0);
    destroyTrap!.position = "faceDown";
    destroyTrap!.faceUp = false;
    moveDuelCard(session.state, spellProbe!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    wildheart!.faceUp = true;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(wildheartCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(destroyTrapCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(spellProbeCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);
    expect(session.state.effects.filter((effect) => effect.sourceUid === wildheart!.uid && effect.code === 1).map((effect) => ({
      event: effect.event,
      code: effect.code,
      luaTypeFlags: effect.luaTypeFlags,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
    }))).toEqual([{
      event: "continuous",
      code: 1,
      luaTypeFlags: 1,
      property: 0x20000,
      range: ["monsterZone"],
      sourceUid: wildheart!.uid,
    }]);

    expect(host.loadScript(immunityProbeScript(wildheartCode, destroyTrapCode, spellProbeCode), "wildheart-trap-immunity-probe.lua").ok).toBe(true);
    expect(host.messages).toContain("wildheart trap immune true");
    expect(host.messages).toContain("wildheart spell immune false");

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === destroyTrap!.uid);
    expect(activate).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toEqual({
      activationLocation: "spellTrapZone",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-2-1002",
      id: "chain-2",
      player: 0,
      sourceUid: destroyTrap!.uid,
    });
    expect(session.state.chain[0]?.targetUids ?? []).toEqual([]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(restored.session.state.chain).toHaveLength(1);
    expect(restored.session.state.chain[0]).toEqual({
      activationLocation: "spellTrapZone",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-2-1002",
      id: "chain-2",
      player: 0,
      sourceUid: destroyTrap!.uid,
    });
    expect(restored.session.state.chain[0]?.targetUids ?? []).toEqual([]);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(restored.host.messages).toContain("wildheart trap destroy result 0");
    expect(restored.session.state.cards.find((card) => card.uid === wildheart!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
    });
    expect(restored.session.state.cards.find((card) => card.uid === destroyTrap!.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
    });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === wildheart!.uid)).toEqual([]);
  });
});

function destroyTrapScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DESTROY)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetOperation(s.operation)
      c:RegisterEffect(e)
    end
    function s.operation(e,tp,eg,ep,ev,re,r,rp)
      local g=Duel.GetMatchingGroup(function(c) return c:IsCode(86188410) end,tp,LOCATION_MZONE,0,nil)
      local result=Duel.Destroy(g,REASON_EFFECT)
      Debug.Message("wildheart trap destroy result " .. tostring(result))
    end
  `;
}

function spellProbeScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      c:RegisterEffect(e)
    end
  `;
}

function immunityProbeScript(wildheartCode: string, trapCode: string, spellCode: string): string {
  return `
    local protected=Duel.GetFirstMatchingCard(function(c) return c:IsCode(${wildheartCode}) end,0,LOCATION_MZONE,0,nil)
    local trap=Duel.GetFirstMatchingCard(function(c) return c:IsCode(${trapCode}) end,0,LOCATION_SZONE,0,nil)
    local spell=Duel.GetFirstMatchingCard(function(c) return c:IsCode(${spellCode}) end,0,LOCATION_HAND,0,nil)
    Debug.Message("wildheart trap immune " .. tostring(protected:IsImmuneToEffect(trap:GetActivateEffect())))
    Debug.Message("wildheart spell immune " .. tostring(protected:IsImmuneToEffect(spell:GetActivateEffect())))
  `;
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("wildheart responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
