import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const cloisterCode = "84335863";
const plantSummonCode = "843358630";
const highSynchroCode = "843358631";
const lowSynchroCode = "843358632";
const highNonSynchroCode = "843358633";
const drawCode = "843358634";
const topMonsterCode = "843358635";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCloisterScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${cloisterCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeSynchro = 0x2000;
const typeField = 0x80000;
const racePlant = 0x400;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const attributeDark = 0x20;
const effectUpdateAttack = 100;
const effectFlagPlayerTargetClientHint = 0x4000800;
const resetPhaseEnd = 1073742336;
const declareMonsterPrompt = [{ api: "SelectOption" as const, player: 0 as const, returned: 0 }];

describe.skipIf(!hasUpstreamScripts || !hasCloisterScript)("Lua real script White Rose Cloister predraw synchro stat", () => {
  it("restores empty-field Plant summon and pre-draw declared Monster Synchro ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectCloisterScriptShape(workspace.readScript(`official/c${cloisterCode}.lua`));
    const reader = createCardReader(cards());

    const restoredSummon = createRestoredSummonField({ reader, workspace });
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const summonCloister = requireCard(restoredSummon.session, cloisterCode);
    const plantSummon = requireCard(restoredSummon.session, plantSummonCode);
    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) =>
      action.type === "activateEffect" && action.uid === summonCloister.uid && action.effectId === "lua-2",
    );
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summon!);
    resolveRestoredChain(restoredSummon);
    expect(restoredSummon.session.state.cards.find((card) => card.uid === plantSummon.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: summonCloister.uid,
      reasonEffectId: 2,
    });
    expect(restoredSummon.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: plantSummon.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: summonCloister.uid, eventReasonEffectId: 2, previous: "hand", current: "monsterZone" },
    ]);

    const restoredPredrawSetup = createRestoredPredrawField({ reader, workspace });
    expectCleanRestore(restoredPredrawSetup);
    expectRestoredLegalActions(restoredPredrawSetup, 1);
    const predrawCloister = requireCard(restoredPredrawSetup.session, cloisterCode);
    const highSynchro = requireCard(restoredPredrawSetup.session, highSynchroCode);
    const lowSynchro = requireCard(restoredPredrawSetup.session, lowSynchroCode);
    const highNonSynchro = requireCard(restoredPredrawSetup.session, highNonSynchroCode);
    const draw = requireCard(restoredPredrawSetup.session, drawCode);
    const topMonster = requireCard(restoredPredrawSetup.session, topMonsterCode);
    const endTurn = getLuaRestoreLegalActions(restoredPredrawSetup, 1).find((action) => action.type === "endTurn");
    expect(endTurn, JSON.stringify(getLuaRestoreLegalActions(restoredPredrawSetup, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPredrawSetup, endTurn!);
    expect(restoredPredrawSetup.session.state.cards.find((card) => card.uid === draw.uid)).toMatchObject({ location: "hand", controller: 0 });

    const restoredPredrawTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredPredrawSetup.session), workspace, reader, { promptOverrides: declareMonsterPrompt });
    expectCleanRestore(restoredPredrawTrigger);
    expectRestoredLegalActions(restoredPredrawTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredPredrawTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === predrawCloister.uid,
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredPredrawTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPredrawTrigger, trigger!);
    resolveRestoredChain(restoredPredrawTrigger);
    expect(restoredPredrawTrigger.host.promptDecisions.flatMap((prompt) => prompt.api === "SelectOption" ? [{
      api: prompt.api,
      descriptions: prompt.descriptions,
      options: prompt.options,
      player: prompt.player,
      returned: prompt.returned,
    }] : [])).toEqual([{ api: "SelectOption", descriptions: [70, 71, 72], options: [0, 1, 2], player: 0, returned: 0 }]);
    expect(restoredPredrawTrigger.host.messages).toContain(`confirmed decktop 0: ${topMonsterCode}`);
    expect(restoredPredrawTrigger.session.state.effects.filter((effect) =>
      effect.sourceUid === predrawCloister.uid && (effect.code === effectUpdateAttack || ((effect.property ?? 0) & effectFlagPlayerTargetClientHint) !== 0)
    ).map((effect) => ({
      code: effect.code,
      description: effect.description,
      luaTargetDescriptor: effect.luaTargetDescriptor,
      property: effect.property,
      range: effect.range,
      registryKey: effect.registryKey,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      {
        code: undefined,
        description: 1349373810,
        luaTargetDescriptor: undefined,
        property: effectFlagPlayerTargetClientHint,
        range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"],
        registryKey: `lua:${cloisterCode}:lua-4`,
        reset: { count: 1, flags: resetPhaseEnd },
        sourceUid: predrawCloister.uid,
        targetRange: [1, 0],
        value: undefined,
      },
      {
        code: effectUpdateAttack,
        description: undefined,
        luaTargetDescriptor: "target:level-above-synchro:7",
        property: undefined,
        range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"],
        registryKey: `lua:${cloisterCode}:lua-5-100`,
        reset: { flags: resetPhaseEnd },
        sourceUid: predrawCloister.uid,
        targetRange: [4, 0],
        value: 1000,
      },
    ]);
    expect(currentAttack(restoredPredrawTrigger.session.state.cards.find((card) => card.uid === highSynchro.uid), restoredPredrawTrigger.session.state)).toBe(3000);
    expect(currentAttack(restoredPredrawTrigger.session.state.cards.find((card) => card.uid === lowSynchro.uid), restoredPredrawTrigger.session.state)).toBe(1200);
    expect(currentAttack(restoredPredrawTrigger.session.state.cards.find((card) => card.uid === highNonSynchro.uid), restoredPredrawTrigger.session.state)).toBe(1800);

    const restoredPersistent = restoreDuelWithLuaScripts(serializeDuel(restoredPredrawTrigger.session), workspace, reader, { promptOverrides: declareMonsterPrompt });
    expectCleanRestore(restoredPersistent);
    expectRestoredLegalActions(restoredPersistent, 0);
    expect(currentAttack(restoredPersistent.session.state.cards.find((card) => card.uid === highSynchro.uid), restoredPersistent.session.state)).toBe(3000);
    expect(currentAttack(restoredPersistent.session.state.cards.find((card) => card.uid === lowSynchro.uid), restoredPersistent.session.state)).toBe(1200);
    expect(currentAttack(restoredPersistent.session.state.cards.find((card) => card.uid === highNonSynchro.uid), restoredPersistent.session.state)).toBe(1800);
    expect(restoredPersistent.session.state.eventHistory.filter((event) => ["preDraw", "confirmed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "preDraw", eventCode: 1113, eventCardUid: undefined, eventPlayer: 0, eventValue: 1, previous: undefined, current: undefined },
      { eventName: "confirmed", eventCode: 1211, eventCardUid: topMonster.uid, eventPlayer: 0, eventValue: 1, previous: "deck", current: "deck" },
    ]);
    expect(restoredPersistent.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredSummonField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 84335863, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [cloisterCode, plantSummonCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpFieldSpell(session, requireCard(session, cloisterCode));
  moveDuelCard(session.state, requireCard(session, plantSummonCode).uid, "hand", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(cloisterCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredPredrawField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 84335864, startingHandSize: 0, drawPerTurn: 1, cardReader: reader });
  loadDecks(session, { 0: { main: [cloisterCode, highSynchroCode, lowSynchroCode, highNonSynchroCode, drawCode, topMonsterCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpFieldSpell(session, requireCard(session, cloisterCode));
  moveFaceUpAttack(session, requireCard(session, highSynchroCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, lowSynchroCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, highNonSynchroCode), 0, 2);
  requireCard(session, drawCode).sequence = 0;
  requireCard(session, topMonsterCode).sequence = 1;
  session.state.phase = "main1";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  const host = createLuaScriptHost(session, workspace, { promptOverrides: declareMonsterPrompt });
  expect(host.loadCardScript(Number(cloisterCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, { promptOverrides: declareMonsterPrompt });
}

function expectCloisterScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("White Rose Cloister");
  expect(script).toContain("e0:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetRange(LOCATION_FZONE)");
  expect(script).toContain("Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0)==0");
  expect(script).toContain("return (c:IsSetCard(SET_ROSE_DRAGON) or c:IsRace(RACE_PLANT)) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_HAND,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e2:SetCode(EVENT_PREDRAW)");
  expect(script).toContain("Duel.IsTurnPlayer(tp) and Duel.GetFieldGroupCount(tp,LOCATION_DECK,0)>0");
  expect(script).toContain("e:SetLabel(Duel.SelectOption(tp,DECLTYPE_MONSTER,DECLTYPE_SPELL,DECLTYPE_TRAP))");
  expect(script).toContain("Duel.GetDecktopGroup(tp,1):GetFirst()");
  expect(script).toContain("Duel.ConfirmDecktop(tp,1)");
  expect(script).toContain("aux.RegisterClientHint(c,nil,tp,1,0,aux.Stringid(id,2))");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetTargetRange(LOCATION_MZONE,0)");
  expect(script).toContain("e1:SetTarget(function(e,c) return c:IsLevelAbove(7) and c:IsSynchroMonster() end)");
  expect(script).toContain("e1:SetValue(1000)");
  expect(script).toContain("e1:SetReset(RESET_PHASE|PHASE_END)");
}

function cards(): DuelCardData[] {
  return [
    { code: cloisterCode, name: "White Rose Cloister", kind: "spell", typeFlags: typeSpell | typeField },
    { code: plantSummonCode, name: "White Rose Cloister Plant", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePlant, attribute: attributeLight, level: 4, attack: 1400, defense: 1000 },
    { code: highSynchroCode, name: "White Rose Cloister High Synchro", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceWarrior, attribute: attributeLight, level: 7, attack: 2000, defense: 1600 },
    { code: lowSynchroCode, name: "White Rose Cloister Low Synchro", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceWarrior, attribute: attributeLight, level: 6, attack: 1200, defense: 1000 },
    { code: highNonSynchroCode, name: "White Rose Cloister High Non-Synchro", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 7, attack: 1800, defense: 1400 },
    { code: drawCode, name: "White Rose Cloister Turn Draw", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    { code: topMonsterCode, name: "White Rose Cloister Revealed Monster", kind: "monster", typeFlags: typeMonster, race: racePlant, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
  ];
}

function moveFaceUpFieldSpell(session: DuelSession, card: DuelCardInstance): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function requireCard(session: DuelSession, code: string, controller?: PlayerId): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && (controller === undefined || candidate.controller === controller));
  expect(card).toBeDefined();
  return card!;
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
