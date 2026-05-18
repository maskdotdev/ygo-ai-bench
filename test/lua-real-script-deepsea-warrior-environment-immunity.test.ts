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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Deepsea Warrior environment immunity", () => {
  it("restores Umi-gated Spell immunity and blocks a restored Spell destruction effect", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const deepseaCode = "24128274";
    const umiCode = "22702055";
    const destroySpellCode = "24128275";
    const responderCode = "24128276";
    const script = workspace.readScript(`official/c${deepseaCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_IMMUNE_EFFECT)");
    expect(script).toContain("return Duel.IsEnvironment(CARD_UMI)");
    expect(script).toContain("return te:IsSpellEffect()");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === deepseaCode || card.code === umiCode),
      { code: destroySpellCode, name: "Deepsea Warrior Spell Probe", kind: "spell", typeFlags: 0x2 },
      { code: responderCode, name: "Deepsea Warrior Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const source = {
      readScript(name: string) {
        if (name === `c${destroySpellCode}.lua`) return destroySpellScript();
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const session = createDuel({ seed: 241, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [deepseaCode, umiCode, destroySpellCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const deepsea = session.state.cards.find((card) => card.code === deepseaCode);
    const umi = session.state.cards.find((card) => card.code === umiCode);
    const destroySpell = session.state.cards.find((card) => card.code === destroySpellCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(deepsea).toBeDefined();
    expect(umi).toBeDefined();
    expect(destroySpell).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, deepsea!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, umi!.uid, "spellTrapZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, destroySpell!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    umi!.faceUp = true;
    deepsea!.faceUp = true;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(deepseaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(destroySpellCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    expect(session.state.effects.find((effect) => effect.sourceUid === deepsea!.uid && effect.code === 1)).toMatchObject({
      event: "continuous",
      code: 1,
      luaTypeFlags: 1,
      range: ["monsterZone"],
      sourceUid: deepsea!.uid,
    });

    expect(host.loadScript(immunityProbeScript(deepseaCode, destroySpellCode), "deepsea-warrior-immunity-with-umi.lua").ok).toBe(true);
    expect(host.messages).toContain("deepsea environment active true");
    expect(host.messages).toContain("deepsea spell immune true");

    moveDuelCard(session.state, umi!.uid, "graveyard", 0);
    expect(host.loadScript(immunityProbeScript(deepseaCode, destroySpellCode), "deepsea-warrior-immunity-without-umi.lua").ok).toBe(true);
    expect(host.messages).toContain("deepsea environment active false");
    expect(host.messages).toContain("deepsea spell immune false");
    moveDuelCard(session.state, umi!.uid, "spellTrapZone", 0).position = "faceUpAttack";
    umi!.faceUp = true;

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === destroySpell!.uid);
    expect(activate).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toEqual({
      activationLocation: "hand",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-2-1002",
      id: "chain-2",
      player: 0,
      sourceUid: destroySpell!.uid,
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
      activationLocation: "hand",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-2-1002",
      id: "chain-2",
      player: 0,
      sourceUid: destroySpell!.uid,
    });
    expect(restored.session.state.chain[0]?.targetUids ?? []).toEqual([]);
    expect(restored.session.state.effects.find((effect) => effect.sourceUid === deepsea!.uid && effect.code === 1)).toMatchObject({
      event: "continuous",
      code: 1,
      luaTypeFlags: 1,
      range: ["monsterZone"],
      sourceUid: deepsea!.uid,
    });

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(restored.host.messages).toContain("deepsea destroy result 0");
    expect(restored.session.state.cards.find((card) => card.uid === deepsea!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
    });
    expect(restored.session.state.cards.find((card) => card.uid === destroySpell!.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
    });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === deepsea!.uid)).toEqual([]);
  });
});

function destroySpellScript(): string {
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
      local g=Duel.GetMatchingGroup(function(c) return c:IsCode(24128274) end,tp,LOCATION_MZONE,0,nil)
      local result=Duel.Destroy(g,REASON_EFFECT)
      Debug.Message("deepsea destroy result " .. tostring(result))
    end
  `;
}

function immunityProbeScript(deepseaCode: string, destroySpellCode: string): string {
  return `
    local protected=Duel.GetFirstMatchingCard(function(c) return c:IsCode(${deepseaCode}) end,0,LOCATION_MZONE,0,nil)
    local spell=Duel.GetFirstMatchingCard(function(c) return c:IsCode(${destroySpellCode}) end,0,LOCATION_HAND,0,nil)
    Debug.Message("deepsea environment active " .. tostring(Duel.IsEnvironment(CARD_UMI)))
    Debug.Message("deepsea spell immune " .. tostring(protected:IsImmuneToEffect(spell:GetActivateEffect())))
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
      e:SetOperation(function(e,tp) Debug.Message("deepsea responder resolved") end)
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
