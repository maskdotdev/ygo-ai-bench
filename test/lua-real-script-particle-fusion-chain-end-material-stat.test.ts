import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { ApplyDuelResponseResult, DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const particleFusionCode = "39261576";
const gemFusionCode = "392615760";
const materialACode = "392615761";
const materialBCode = "392615762";
const responderCode = "392615763";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasParticleFusionScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${particleFusionCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeFusion = 0x40;
const setGemKnight = 0x1047;

describe.skipIf(!hasUpstreamScripts || !hasParticleFusionScript)("Lua real script Particle Fusion chain-end material stat", () => {
  it("restores on-field Gem-Knight Fusion into chain-end material ATK boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${particleFusionCode}.lua`);
    expect(script).toContain("Fusion.CreateSummonEff(c,aux.FilterBoolFunction(Card.IsSetCard,SET_GEM_KNIGHT),Fusion.OnFieldMat,nil,nil,nil,s.stage2)");
    expect(script).toContain("e1:SetCode(EVENT_CHAIN_END)");
    expect(script).toContain("Duel.RaiseSingleEvent(_e:GetHandler(),EVENT_CUSTOM+id,_e,0,p,p,0)");
    expect(script).toContain("e2:SetCode(EVENT_CUSTOM+id)");
    expect(script).toContain("Duel.Remove(e:GetHandler(),POS_FACEUP,REASON_COST)");
    expect(script).toContain("local mat=tc:GetMaterial()");
    expect(script).toContain("Duel.SetTargetCard(g)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(tc:GetAttack())");

    const cards: DuelCardData[] = [
      { code: particleFusionCode, name: "Particle Fusion", kind: "spell", typeFlags: typeSpell },
      { code: gemFusionCode, name: "Particle Fusion Gem-Knight Target", kind: "extra", typeFlags: typeMonster | typeFusion, setcodes: [setGemKnight], level: 6, attack: 2200, defense: 1800, fusionMaterialMin: 2, fusionMaterialMax: 2 },
      { code: materialACode, name: "Particle Fusion Material A", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setGemKnight], level: 4, attack: 1400, defense: 1000 },
      { code: materialBCode, name: "Particle Fusion Material B", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setGemKnight], level: 4, attack: 1600, defense: 1000 },
      { code: responderCode, name: "Particle Fusion Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 39261576, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [particleFusionCode, materialACode, materialBCode], extra: [gemFusionCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const particleFusion = requireCard(session, particleFusionCode);
    const gemFusion = requireCard(session, gemFusionCode);
    const materialA = requireCard(session, materialACode);
    const materialB = requireCard(session, materialBCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, particleFusion.uid, "hand", 0);
    moveDuelCard(session.state, materialA.uid, "monsterZone", 0).position = "faceUpAttack";
    materialA.faceUp = true;
    moveDuelCard(session.state, materialB.uid, "monsterZone", 0).position = "faceUpAttack";
    materialB.faceUp = true;
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(particleFusionCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === particleFusion.uid);
    expect(activate, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activate!);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("particle fusion responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === particleFusion.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === gemFusion.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "fusion",
      summonMaterialUids: [materialA.uid, materialB.uid],
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === materialA.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.material | duelReason.fusion,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === materialB.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.material | duelReason.fusion,
    });
    expect(restoredChain.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventTriggerTiming: trigger.eventTriggerTiming,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        player: 0,
        effectId: "lua-2-307697032",
        sourceUid: particleFusion.uid,
        eventName: "customEvent",
        eventCode: 0x10000000 + Number(particleFusionCode),
        eventTriggerTiming: "when",
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredCustom = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredCustom);
    expectRestoredLegalActions(restoredCustom, 0);
    const boost = getLuaRestoreLegalActions(restoredCustom, 0).find((action) => action.type === "activateTrigger" && action.uid === particleFusion.uid);
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredCustom, 0), null, 2)).toBeDefined();
    const customEventStart = restoredCustom.session.state.eventHistory.length;
    applyLuaRestoreAndAssert(restoredCustom, boost!);
    expect(restoredCustom.session.state.cards.find((card) => card.uid === particleFusion.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: particleFusion.uid,
      reasonEffectId: 2,
    });
    resolveRestoredChain(restoredCustom);
    expect(currentAttack(restoredCustom.session.state.cards.find((card) => card.uid === gemFusion.uid), restoredCustom.session.state)).toBe(3600);
    expect(restoredCustom.session.state.eventHistory.slice(customEventStart).filter((event) => ["banished", "becameTarget", "chainSolved"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "banished", eventCode: 1011, eventCardUid: particleFusion.uid, eventReason: duelReason.cost, eventReasonCardUid: particleFusion.uid, eventReasonEffectId: 2, relatedEffectId: undefined },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: materialA.uid, eventReason: duelReason.effect | duelReason.material | duelReason.fusion, eventReasonCardUid: particleFusion.uid, eventReasonEffectId: 1, relatedEffectId: 2 },
      { eventName: "chainSolved", eventCode: 1022, eventCardUid: undefined, eventReason: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 2 },
    ]);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredCustom.session), source, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === gemFusion.uid), restoredStat.session.state)).toBe(3600);
    expect(restoredStat.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("particle fusion responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyAndAssert(session: DuelSession, action: DuelAction): ApplyDuelResponseResult {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
  return response;
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
