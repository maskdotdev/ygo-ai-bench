import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { ApplyDuelResponseResult, DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeFusion = 0x40;
const typeContinuous = 0x10000;
const setGemKnight = 0x1047;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Brilliant Fusion deck-material stage2 target", () => {
  it("restores Fusion.CreateSummonEff deck materials, zeroed stage2 stats, discard stat restore, and leave-field target destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const brilliantFusionCode = "7394770";
    const gemFusionCode = "73947701";
    const materialACode = "73947702";
    const materialBCode = "73947703";
    const discardSpellCode = "73947704";
    const responderCode = "73947705";
    const script = workspace.readScript(`c${brilliantFusionCode}.lua`);
    expect(script).toContain("Fusion.CreateSummonEff(c,aux.FilterBoolFunction(Card.IsSetCard,SET_GEM_KNIGHT),aux.FALSE,s.extrafil");
    expect(script).toContain("Duel.GetMatchingGroup(Fusion.IsMonsterFilter(Card.IsAbleToGrave),tp,LOCATION_DECK,0,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE_FINAL)");
    expect(script).toContain("e:GetHandler():SetCardTarget(tc)");
    expect(script).toContain("Duel.DiscardHand(tp,s.cfilter,1,1,REASON_COST|REASON_DISCARD,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e2:SetCode(EVENT_LEAVE_FIELD)");
    expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === brilliantFusionCode),
      {
        code: gemFusionCode,
        name: "Brilliant Fusion Gem-Knight Target",
        kind: "extra",
        typeFlags: typeMonster | typeFusion,
        setcodes: [setGemKnight],
        level: 6,
        attack: 2200,
        defense: 1800,
        fusionMaterialMin: 2,
        fusionMaterialMax: 2,
      },
      { code: materialACode, name: "Brilliant Fusion Deck Material A", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1000 },
      { code: materialBCode, name: "Brilliant Fusion Deck Material B", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1300, defense: 1100 },
      { code: discardSpellCode, name: "Brilliant Fusion Discard Spell", kind: "spell", typeFlags: typeSpell },
      { code: responderCode, name: "Brilliant Fusion Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7394770, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [brilliantFusionCode, materialACode, materialBCode, discardSpellCode], extra: [gemFusionCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const brilliantFusion = requireCard(session, brilliantFusionCode);
    const gemFusion = requireCard(session, gemFusionCode);
    const materialA = requireCard(session, materialACode);
    const materialB = requireCard(session, materialBCode);
    const discardSpell = requireCard(session, discardSpellCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, brilliantFusion.uid, "hand", 0);
    moveDuelCard(session.state, discardSpell.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(brilliantFusionCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === brilliantFusion.uid);
    expect(activate, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 },
      { category: 0x20, targetUids: [], count: 0, player: 0, parameter: 0x1 },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("brilliant fusion responder resolved");

    expect(restoredChain.session.state.cards.find((card) => card.uid === brilliantFusion.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === gemFusion.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "fusion",
      summonMaterialUids: [materialB.uid, materialA.uid],
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === materialA.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.material | duelReason.fusion,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === materialB.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.material | duelReason.fusion,
    });
    expect(currentAttack(gemFusion, restoredChain.session.state)).toBe(0);
    expect(currentDefense(gemFusion, restoredChain.session.state)).toBe(0);
    expect(restoredChain.session.state.cards.find((card) => card.uid === brilliantFusion.uid)?.cardTargetUids).toEqual([gemFusion.uid]);
    expect(restoredChain.session.state.effects
      .filter((effect) => effect.sourceUid === gemFusion.uid && (effect.code === 102 || effect.code === 106))
      .map((effect) => ({
        code: effect.code,
        registryKey: effect.registryKey,
        value: effect.value,
        range: effect.range,
      }))).toEqual([
        { code: 102, registryKey: "lua:7394770:lua-5-102", value: 0, range: ["monsterZone"] },
        { code: 106, registryKey: "lua:7394770:lua-6-106", value: 0, range: ["monsterZone"] },
      ]);

    const restoredIgnition = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredIgnition);
    expectRestoredLegalActions(restoredIgnition, 0);
    const boost = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) => action.type === "activateEffect" && action.uid === brilliantFusion.uid);
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredIgnition, boost!);
    resolveRestoredChain(restoredIgnition);
    expect(restoredIgnition.session.state.cards.find((card) => card.uid === discardSpell.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: brilliantFusion.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(gemFusion, restoredIgnition.session.state)).toBe(2200);
    expect(currentDefense(gemFusion, restoredIgnition.session.state)).toBe(1800);

    const restoredLeaveField = restoreDuelWithLuaScripts(serializeDuel(restoredIgnition.session), source, reader);
    expectCleanRestore(restoredLeaveField);
    expectRestoredLegalActions(restoredLeaveField, 0);
    destroyDuelCard(restoredLeaveField.session.state, brilliantFusion.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(restoredLeaveField.session.state.cards.find((card) => card.uid === gemFusion.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: brilliantFusion.uid,
      reasonEffectId: 2,
    });
    expect(restoredLeaveField.session.state.eventHistory
      .filter((event) => event.eventCardUid === gemFusion.uid && (event.eventName === "specialSummoned" || event.eventName === "destroyed"))
      .map((event) => ({
        eventName: event.eventName,
        eventCode: event.eventCode,
        eventCardUid: event.eventCardUid,
        eventReason: event.eventReason,
        eventReasonCardUid: event.eventReasonCardUid,
        eventReasonEffectId: event.eventReasonEffectId,
      }))).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: gemFusion.uid,
        eventReason: duelReason.summon | duelReason.specialSummon | duelReason.fusion,
        eventReasonCardUid: brilliantFusion.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: gemFusion.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonCardUid: brilliantFusion.uid,
        eventReasonEffectId: 2,
      },
    ]);
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
      e:SetOperation(function(e,tp) Debug.Message("brilliant fusion responder resolved") end)
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
