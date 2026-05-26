import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hydragonCode = "80476891";
const targetGeminiCode = "804768910";
const replacementCode = "804768911";
const opponentCode = "804768912";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasHydragonScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${hydragonCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeGemini = 0x800;
const typeSpell = 0x2;
const typeContinuous = 0x20000;
const summonTypeGemini = 0x12000000;
const effectDestroyReplace = 50;
const effectUpdateAttack = 100;
const effectUpdateDefense = 104;

describe.skipIf(!hasUpstreamScripts || !hasHydragonScript)("Lua real script Poly-Chemicritter Hydragon Gemini stat replace", () => {
  it("restores Gemini-status summon trigger ATK/DEF boost and selected field destroy replacement", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${hydragonCode}.lua`);
    expect(script).toContain("Poly-Chemicritter Hydragon");
    expect(script).toContain("Gemini.AddProcedure(c)");
    expect(script).toContain("e1:SetCode(EVENT_SUMMON_SUCCESS)");
    expect(script).toContain("e1:SetCondition(Gemini.EffectStatusCondition)");
    expect(script).toContain("return tc:IsType(TYPE_GEMINI) and tc~=e:GetHandler()");
    expect(script).toContain("Duel.SetTargetCard(tc)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(500)");
    expect(script).toContain("e2:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e2:SetCode(EFFECT_DESTROY_REPLACE)");
    expect(script).toContain("Duel.SelectEffectYesNo(tp,c,96)");
    expect(script).toContain("Duel.SelectMatchingCard(tp,s.desfilter,tp,LOCATION_ONFIELD,0,1,1,exg,e,tp):GetFirst()");
    expect(script).toContain("tc:SetStatus(STATUS_DESTROY_CONFIRMED,true)");
    expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT|REASON_REPLACE)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 80476891, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [hydragonCode, targetGeminiCode, replacementCode] }, 1: { main: [opponentCode] } });
    startDuel(session);

    const hydragon = requireCard(session, hydragonCode);
    const target = requireCard(session, targetGeminiCode);
    const replacement = requireCard(session, replacementCode);
    const opponent = requireCard(session, opponentCode);
    moveFaceUpAttack(session, hydragon, 0, 0);
    hydragon.summonType = "normal";
    hydragon.summonTypeCode = summonTypeGemini;
    hydragon.previousLocation = "monsterZone";
    hydragon.previousSequence = 0;
    moveFaceUpAttack(session, target, 0, 1);
    const spell = moveDuelCard(session.state, replacement.uid, "spellTrapZone", 0);
    spell.faceUp = true;
    spell.sequence = 0;
    moveFaceUpAttack(session, opponent, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    const loaded = host.loadCardScript(Number(hydragonCode), workspace);
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const geminiSummon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "normalSummon" && action.uid === target.uid);
    expect(geminiSummon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    const summoned = applyLuaRestoreResponse(restoredOpen, geminiSummon!);
    expect(summoned.ok, summoned.error).toBe(true);
    expect(summoned.legalActions).toEqual(getLuaRestoreLegalActions(restoredOpen, summoned.state.waitingFor!));
    expect(summoned.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restoredOpen, summoned.state.waitingFor!));
    expect(summoned.legalActionGroups.flatMap((group) => group.actions)).toEqual(summoned.legalActions);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.pendingTriggers.filter((trigger) => trigger.sourceUid === hydragon.uid)).toEqual([
      {
        id: "trigger-3-1",
        player: 0,
        sourceUid: hydragon.uid,
        effectId: "lua-4-1100",
        eventName: "normalSummoned",
        triggerBucket: "turnOptional",
        eventTriggerTiming: "when",
        eventReason: 0,
        eventReasonPlayer: 0,
        eventCode: 1100,
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventCardUid: target.uid,
      },
    ]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === hydragon.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    const boosted = restoredTrigger.session.state.cards.find((card) => card.uid === target.uid);
    expect(currentAttack(boosted, restoredTrigger.session.state)).toBe(2100);
    expect(currentDefense(boosted, restoredTrigger.session.state)).toBe(1700);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === target.uid && effect.code !== undefined && [effectUpdateAttack, effectUpdateDefense].includes(effect.code)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", reset: { flags: 33427456 }, sourceUid: target.uid, value: 500 },
      { code: effectUpdateDefense, event: "continuous", reset: { flags: 33427456 }, sourceUid: target.uid, value: 500 },
    ]);

    const restoredReplacement = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredReplacement);
    expectRestoredLegalActions(restoredReplacement, 0);
    destroyDuelCard(restoredReplacement.session.state, target.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(restoredReplacement.host.promptDecisions).toContainEqual({ id: "lua-prompt-1", api: "SelectEffectYesNo", player: 0, description: 96, returned: true });
    expect(restoredReplacement.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
    });
    expect(restoredReplacement.session.state.cards.find((card) => card.uid === replacement.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.replace | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: hydragon.uid,
      reasonEffectId: 5,
    });
    expect(restoredReplacement.session.state.effects.filter((effect) => effect.sourceUid === hydragon.uid && effect.code === effectDestroyReplace).map((effect) => ({
      code: effect.code,
      event: effect.event,
      luaConditionDescriptor: effect.luaConditionDescriptor,
      range: effect.range,
    }))).toEqual([
      { code: effectDestroyReplace, event: "continuous", luaConditionDescriptor: "condition:gemini-status", range: ["monsterZone"] },
    ]);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredReplacement.session), workspace, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === target.uid), restoredStat.session.state)).toBe(2100);
    expect(currentDefense(restoredStat.session.state.cards.find((card) => card.uid === target.uid), restoredStat.session.state)).toBe(1700);
    expect(restoredStat.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: hydragonCode, name: "Poly-Chemicritter Hydragon", kind: "monster", typeFlags: typeMonster | typeEffect | typeGemini, level: 8, attack: 200, defense: 2800 },
    { code: targetGeminiCode, name: "Hydragon Gemini Target", kind: "monster", typeFlags: typeMonster | typeEffect | typeGemini, level: 4, attack: 1600, defense: 1200 },
    { code: replacementCode, name: "Hydragon Replacement Field Card", kind: "spell", typeFlags: typeSpell | typeContinuous },
    { code: opponentCode, name: "Hydragon Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1500, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: 0 | 1, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: Parameters<typeof applyLuaRestoreResponse>[1]): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor!;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    const response = applyResponse(restored.session, pass!);
    expect(response.ok, response.error).toBe(true);
    expect(response.legalActions).toEqual(getLegalActions(restored.session, response.state.waitingFor!));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}
