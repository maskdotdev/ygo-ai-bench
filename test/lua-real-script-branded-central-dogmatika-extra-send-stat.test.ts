import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const brandedCode = "14220547";
const summonSpellCode = "142205470";
const ritualCode = "142205471";
const fusionCode = "142205472";
const ownExtraCode = "142205473";
const opponentExtraCode = "142205474";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBrandedScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${brandedCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeFusion = 0x40;
const typeRitual = 0x80;
const typeXyz = 0x800000;
const raceSpellcaster = 0x2;
const attributeLight = 0x10;
const effectCannotDirectAttack = 73;
const effectUpdateAttack = 100;
const effectCannotSelectBattleTarget = 332;
const eventSpecialSummonSuccess = 1102;
const promptOverrides = [{ api: "SelectEffect" as const, player: 0 as const, returned: 2 }];

describe.skipIf(!hasUpstreamScripts || !hasBrandedScript)("Lua real script Branded in Central Dogmatika extra send stat", () => {
  it("restores Spell-effect Ritual and Fusion summon triggers into opponent Extra Deck send and Fusion attack locks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectBrandedScriptShape(workspace.readScript(`official/c${brandedCode}.lua`));
    const source = scriptSource(workspace);
    const reader = createCardReader(cards());

    const ritualSession = createScenarioSession(reader, "ritual");
    const ritualHost = createLuaScriptHost(ritualSession, workspace, { promptOverrides });
    expect(ritualHost.loadCardScript(Number(brandedCode), source).ok).toBe(true);
    expect(ritualHost.loadCardScript(Number(summonSpellCode), source).ok).toBe(true);
    expect(ritualHost.registerInitialEffects()).toBe(2);
    const branded = requireCard(ritualSession, brandedCode);
    const ritual = requireCard(ritualSession, ritualCode);
    const opponentExtra = requireCard(ritualSession, opponentExtraCode, 1);
    resolveSpellSummon(ritualSession, summonSpellCode);
    expect(ritualSession.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonCardUid: trigger.eventReasonCardUid,
      eventReasonEffectId: trigger.eventReasonEffectId,
      eventReasonPlayer: trigger.eventReasonPlayer,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-2-1102",
        eventCardUid: ritual.uid,
        eventCode: eventSpecialSummonSuccess,
        eventName: "specialSummoned",
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonCardUid: requireCard(ritualSession, summonSpellCode).uid,
        eventReasonEffectId: 4,
        eventReasonPlayer: 0,
        player: 0,
        sourceUid: branded.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredRitualTrigger = restoreDuelWithLuaScripts(serializeDuel(ritualSession), source, reader, { promptOverrides });
    expectCleanRestore(restoredRitualTrigger);
    expectRestoredLegalActions(restoredRitualTrigger, 0);
    const sendExtra = getLuaRestoreLegalActions(restoredRitualTrigger, 0).find((action) => action.type === "activateTrigger" && action.effectId === "lua-2-1102");
    expect(sendExtra, JSON.stringify(getLuaRestoreLegalActions(restoredRitualTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRitualTrigger, sendExtra!);
    resolveRestoredChain(restoredRitualTrigger);
    expect(restoredRitualTrigger.host.promptDecisions).toEqual([
      { id: "lua-prompt-1", api: "SelectEffect", player: 0, options: [1, 2], descriptions: [227528754, 227528755], returned: 2 },
    ]);
    expect(restoredRitualTrigger.session.state.cards.find((card) => card.uid === opponentExtra.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: branded.uid,
      reasonEffectId: 2,
    });
    expect(restoredRitualTrigger.session.state.eventHistory.filter((event) => event.eventCardUid === opponentExtra.uid && ["confirmed", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: opponentExtra.uid, eventCode: 1211, eventName: "confirmed", eventReason: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: undefined },
      { eventCardUid: opponentExtra.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonCardUid: branded.uid, eventReasonEffectId: 2, eventReasonPlayer: 0 },
    ]);

    const fusionSession = createScenarioSession(reader, "fusion");
    const fusionHost = createLuaScriptHost(fusionSession, workspace, { promptOverrides });
    expect(fusionHost.loadCardScript(Number(brandedCode), source).ok).toBe(true);
    expect(fusionHost.loadCardScript(Number(summonSpellCode), source).ok).toBe(true);
    expect(fusionHost.registerInitialEffects()).toBe(2);
    const fusionBranded = requireCard(fusionSession, brandedCode);
    const fusion = requireCard(fusionSession, fusionCode);
    resolveSpellSummon(fusionSession, summonSpellCode);
    expect(fusionSession.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonCardUid: trigger.eventReasonCardUid,
      eventReasonEffectId: trigger.eventReasonEffectId,
      eventReasonPlayer: trigger.eventReasonPlayer,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-3-1102",
        eventCardUid: fusion.uid,
        eventCode: eventSpecialSummonSuccess,
        eventName: "specialSummoned",
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonCardUid: requireCard(fusionSession, summonSpellCode).uid,
        eventReasonEffectId: 4,
        eventReasonPlayer: 0,
        player: 0,
        sourceUid: fusionBranded.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredFusionTrigger = restoreDuelWithLuaScripts(serializeDuel(fusionSession), source, reader, { promptOverrides });
    expectCleanRestore(restoredFusionTrigger);
    expectRestoredLegalActions(restoredFusionTrigger, 0);
    const statLock = getLuaRestoreLegalActions(restoredFusionTrigger, 0).find((action) => action.type === "activateTrigger" && action.effectId === "lua-3-1102");
    expect(statLock, JSON.stringify(getLuaRestoreLegalActions(restoredFusionTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredFusionTrigger, statLock!);
    resolveRestoredChain(restoredFusionTrigger);
    expect(currentAttack(restoredFusionTrigger.session.state.cards.find((card) => card.uid === fusion.uid), restoredFusionTrigger.session.state)).toBe(5000);
    expect(restoredFusionTrigger.session.state.effects.filter((effect) => effect.sourceUid === fusion.uid).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: fusion.uid, value: 2500 },
      { code: effectCannotSelectBattleTarget, reset: { flags: 1107169792 }, sourceUid: fusion.uid, value: undefined },
      { code: effectCannotDirectAttack, reset: { flags: 1107169792 }, sourceUid: fusion.uid, value: undefined },
    ]);
    expect(restoredFusionTrigger.session.state.eventHistory.filter((event) => ["specialSummoned", "becameTarget"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventName: "specialSummoned", eventCode: eventSpecialSummonSuccess, eventCardUid: fusion.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: requireCard(fusionSession, summonSpellCode).uid, eventReasonEffectId: 4, eventReasonPlayer: 0, relatedEffectId: undefined },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: fusion.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: requireCard(fusionSession, summonSpellCode).uid, eventReasonEffectId: 4, eventReasonPlayer: 0, relatedEffectId: 3 },
    ]);
    expect(restoredFusionTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createScenarioSession(reader: ReturnType<typeof createCardReader>, scenario: "ritual" | "fusion"): DuelSession {
  const targetCode = scenario === "ritual" ? ritualCode : fusionCode;
  const session = createDuel({ seed: scenario === "ritual" ? 14220547 : 14220548, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, {
    0: { main: [brandedCode, summonSpellCode, targetCode], extra: [ownExtraCode] },
    1: { main: [], extra: [opponentExtraCode] },
  });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, brandedCode).uid, "spellTrapZone", 0).faceUp = true;
  moveDuelCard(session.state, requireCard(session, summonSpellCode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, targetCode).uid, "hand", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return session;
}

function resolveSpellSummon(session: DuelSession, spellCode: string): void {
  const spell = requireCard(session, spellCode);
  const action = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === spell.uid);
  expect(action, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
  applyAndAssert(session, action!);
  resolveChain(session);
}

function expectBrandedScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Branded in Central Dogmatika");
  expect(script).toContain("e2:SetCategory(CATEGORY_TOGRAVE)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e2:SetCondition(s.condition(TYPE_RITUAL))");
  expect(script).toContain("return c:IsFaceup() and c:IsType(typ) and c:IsSummonPlayer(tp) and re and re:IsSpellEffect()");
  expect(script).toContain("op=Duel.SelectEffect(tp,");
  expect(script).toContain("Duel.ConfirmCards(tp,g)");
  expect(script).toContain("Duel.SendtoGrave(tg,REASON_EFFECT)");
  expect(script).toContain("Duel.ShuffleExtra(1-tp)");
  expect(script).toContain("e3:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e3:SetCondition(s.condition(TYPE_FUSION))");
  expect(script).toContain("Duel.SetTargetCard(eg)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e2:SetCode(EFFECT_CANNOT_SELECT_BATTLE_TARGET)");
  expect(script).toContain("e3:SetCode(EFFECT_CANNOT_DIRECT_ATTACK)");
}

function cards(): DuelCardData[] {
  return [
    { code: brandedCode, name: "Branded in Central Dogmatika", kind: "spell", typeFlags: typeSpell },
    { code: summonSpellCode, name: "Branded Central Test Summon Spell", kind: "spell", typeFlags: typeSpell },
    { code: ritualCode, name: "Branded Central Ritual Target", kind: "monster", typeFlags: typeMonster | typeEffect | typeRitual, race: raceSpellcaster, attribute: attributeLight, level: 6, attack: 2000, defense: 2000 },
    { code: fusionCode, name: "Branded Central Fusion Target", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceSpellcaster, attribute: attributeLight, level: 8, attack: 2500, defense: 2000 },
    { code: ownExtraCode, name: "Branded Central Own Extra Monster", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceSpellcaster, attribute: attributeLight, level: 4, attack: 1800, defense: 1800 },
    { code: opponentExtraCode, name: "Branded Central Opponent Extra Monster", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceSpellcaster, attribute: attributeLight, level: 6, attack: 2200, defense: 1600 },
  ];
}

function scriptSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  return {
    readScript(name: string): string | undefined {
      if (name === `c${summonSpellCode}.lua`) return summonSpellScript();
      return workspace.readScript(name);
    },
  };
}

function summonSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e1=Effect.CreateEffect(c)
      e1:SetCategory(CATEGORY_SPECIAL_SUMMON)
      e1:SetType(EFFECT_TYPE_ACTIVATE)
      e1:SetCode(EVENT_FREE_CHAIN)
      e1:SetTarget(s.target)
      e1:SetOperation(s.operation)
      c:RegisterEffect(e1)
    end
    function s.filter(c,e,tp)
      return c:IsCode(${ritualCode},${fusionCode}) and c:IsCanBeSpecialSummoned(e,0,tp,false,false,POS_FACEUP_ATTACK)
    end
    function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
      if chk==0 then return Duel.GetLocationCount(tp,LOCATION_MZONE)>0 and Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_HAND,0,1,nil,e,tp) end
      Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND)
    end
    function s.operation(e,tp,eg,ep,ev,re,r,rp)
      if Duel.GetLocationCount(tp,LOCATION_MZONE)<=0 then return end
      Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SPSUMMON)
      local g=Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_HAND,0,1,1,nil,e,tp)
      if #g>0 then Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP_ATTACK) end
    end
  `;
}

function requireCard(session: DuelSession, code: string, controller?: PlayerId): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && (controller === undefined || candidate.controller === controller));
  expect(card).toBeDefined();
  return card!;
}

function resolveChain(session: DuelSession): void {
  let guard = 0;
  while (session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const pass = getLegalActions(session, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
