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
const breakoutCode = "29111045";
const releaseCostCode = "291110450";
const summonGoblinCode = "291110451";
const goblinXyzCode = "291110452";
const overlayMaterialCode = "291110453";
const attackerCode = "291110454";
const opponentOtherCode = "291110455";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBreakoutScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${breakoutCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeQuickPlay = 0x10000;
const typeXyz = 0x800000;
const raceBeastWarrior = 0x4000;
const attributeDark = 0x20;
const setGoblin = 0xac;
const eventAttackAnnounce = 1130;
const effectCannotAttack = 85;
const effectUpdateAttack = 100;
const effectFlagCannotDisableClientHint = 67109888;
const resetStandardPhaseEnd = 1107169792;

describe.skipIf(!hasUpstreamScripts || !hasBreakoutScript)("Lua real script Goblin Biker Grand Breakout release summon overlay stat", () => {
  it("restores release-cost Deck summon lock and grave attack-announce overlay ATK loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${breakoutCode}.lua`));
    const reader = createCardReader(cards());

    const restoredActivation = createRestoredActivationField({ reader, workspace });
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    const handBreakout = requireCard(restoredActivation.session, breakoutCode);
    const releaseCost = requireCard(restoredActivation.session, releaseCostCode);
    const summonedGoblin = requireCard(restoredActivation.session, summonGoblinCode);
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) =>
      action.type === "activateEffect" && action.uid === handBreakout.uid && action.effectId === "lua-1-1002",
    );
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredActivation, activation!);
    resolveRestoredChain(restoredActivation);
    expect(restoredActivation.session.state.cards.find((card) => card.uid === handBreakout.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(restoredActivation.session.state.cards.find((card) => card.uid === releaseCost.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: handBreakout.uid,
      reasonEffectId: 1,
    });
    expect(restoredActivation.session.state.cards.find((card) => card.uid === summonedGoblin.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: handBreakout.uid,
      reasonEffectId: 1,
    });
    expect(restoredActivation.session.state.effects.filter((effect) => effect.sourceUid === summonedGoblin.uid && effect.code === effectCannotAttack).map((effect) => ({
      code: effect.code,
      description: effect.description,
      property: effect.property,
      registryKey: effect.registryKey,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      {
        code: effectCannotAttack,
        description: 3206,
        property: effectFlagCannotDisableClientHint,
        registryKey: `lua:${breakoutCode}:lua-3-85`,
        reset: { flags: resetStandardPhaseEnd },
        sourceUid: summonedGoblin.uid,
        value: undefined,
      },
    ]);
    expect(restoredActivation.session.state.eventHistory.filter((event) => ["released", "sentToGraveyard", "specialSummoned"].includes(event.eventName)).map((event) => ({
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
      { eventName: "released", eventCode: 1017, eventCardUid: releaseCost.uid, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: handBreakout.uid, eventReasonEffectId: 1, previous: "monsterZone", current: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: releaseCost.uid, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: handBreakout.uid, eventReasonEffectId: 1, previous: "monsterZone", current: "graveyard" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: summonedGoblin.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: handBreakout.uid, eventReasonEffectId: 1, previous: "deck", current: "monsterZone" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: handBreakout.uid, eventReason: duelReason.rule, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "spellTrapZone", current: "graveyard" },
    ]);

    const restoredActivationPersistent = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), workspace, reader);
    expectCleanRestore(restoredActivationPersistent);
    expectRestoredLegalActions(restoredActivationPersistent, 0);
    restoredActivationPersistent.session.state.phase = "battle";
    expect(getLuaRestoreLegalActions(restoredActivationPersistent, 0).some((action) =>
      action.type === "declareAttack" && action.attackerUid === summonedGoblin.uid,
    )).toBe(false);

    const restoredAttackOpen = createRestoredAttackField({ reader, workspace });
    expectCleanRestore(restoredAttackOpen);
    expectRestoredLegalActions(restoredAttackOpen, 1);
    const graveBreakout = requireCard(restoredAttackOpen.session, breakoutCode);
    const goblinXyz = requireCard(restoredAttackOpen.session, goblinXyzCode);
    const material = requireCard(restoredAttackOpen.session, overlayMaterialCode);
    const attacker = requireCard(restoredAttackOpen.session, attackerCode);
    const opponentOther = requireCard(restoredAttackOpen.session, opponentOtherCode);
    const attack = getLuaRestoreLegalActions(restoredAttackOpen, 1).find((action) =>
      action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === goblinXyz.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredAttackOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttackOpen, attack!);
    expect(restoredAttackOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventPlayer: trigger.eventPlayer,
      eventReason: trigger.eventReason,
      eventReasonPlayer: trigger.eventReasonPlayer,
      eventTriggerTiming: trigger.eventTriggerTiming,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-2-1130",
        eventCardUid: attacker.uid,
        eventCode: eventAttackAnnounce,
        eventName: "attackDeclared",
        eventPlayer: 1,
        eventReason: 0,
        eventReasonPlayer: 1,
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: graveBreakout.uid,
        triggerBucket: "opponentOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredAttackOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === graveBreakout.uid && action.effectId === "lua-2-1130",
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === graveBreakout.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: graveBreakout.uid,
      reasonEffectId: 2,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === goblinXyz.uid)?.overlayUids).toEqual([]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: graveBreakout.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === attacker.uid), restoredTrigger.session.state)).toBe(800);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === opponentOther.uid), restoredTrigger.session.state)).toBe(500);
    expect(restoredTrigger.session.state.effects.filter((effect) =>
      [attacker.uid, opponentOther.uid].includes(effect.sourceUid) && effect.code === effectUpdateAttack
    ).map((effect) => ({
      code: effect.code,
      property: effect.property,
      registryKey: effect.registryKey,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: 0x400, registryKey: `lua:${breakoutCode}:lua-3-100`, reset: { flags: resetStandardPhaseEnd }, sourceUid: attacker.uid, value: -1000 },
      { code: effectUpdateAttack, property: 0x400, registryKey: `lua:${breakoutCode}:lua-4-100`, reset: { flags: resetStandardPhaseEnd }, sourceUid: opponentOther.uid, value: -1000 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["attackDeclared", "banished", "sentToGraveyard", "detachedMaterial"].includes(event.eventName)).map((event) => ({
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
      { eventName: "attackDeclared", eventCode: eventAttackAnnounce, eventCardUid: attacker.uid, eventReason: 0, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "deck", current: "monsterZone" },
      { eventName: "banished", eventCode: 1011, eventCardUid: graveBreakout.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: graveBreakout.uid, eventReasonEffectId: 2, previous: "graveyard", current: "banished" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: material.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: graveBreakout.uid, eventReasonEffectId: 2, previous: "overlay", current: "graveyard" },
      { eventName: "detachedMaterial", eventCode: 1202, eventCardUid: material.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: graveBreakout.uid, eventReasonEffectId: 2, previous: "overlay", current: "graveyard" },
    ]);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 1);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === attacker.uid), restoredStat.session.state)).toBe(800);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === opponentOther.uid), restoredStat.session.state)).toBe(500);
    expect(restoredStat.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredActivationField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 29111045, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [breakoutCode, releaseCostCode, summonGoblinCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, breakoutCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, releaseCostCode), 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(breakoutCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredAttackField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 29111046, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [breakoutCode, overlayMaterialCode], extra: [goblinXyzCode] }, 1: { main: [attackerCode, opponentOtherCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, breakoutCode).uid, "graveyard", 0).faceUp = true;
  const xyz = moveFaceUpAttack(session, requireCard(session, goblinXyzCode), 0, 0);
  const material = moveDuelCard(session.state, requireCard(session, overlayMaterialCode).uid, "overlay", 0, duelReason.material | duelReason.xyz);
  material.sequence = 0;
  xyz.overlayUids.push(material.uid);
  moveFaceUpAttack(session, requireCard(session, attackerCode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, opponentOtherCode), 1, 1);
  session.state.phase = "battle";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(breakoutCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Goblin Biker Grand Breakout");
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e1:SetCost(s.spcost)");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.spcostfilter,1,false,nil,nil,tp)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.spcostfilter,1,1,false,nil,nil,tp)");
  expect(script).toContain("Duel.Release(sg,REASON_COST)");
  expect(script).toContain("return c:IsSetCard(SET_GOBLIN) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_DECK,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_CLIENT_HINT)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ATTACK)");
  expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e2:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("e2:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("return c:IsSetCard(SET_GOBLIN) and c:IsType(TYPE_XYZ) and c:IsFaceup() and c:GetOverlayCount()>0");
  expect(script).toContain("Duel.Remove(c,POS_FACEUP,REASON_COST)");
  expect(script).toContain("Duel.RemoveOverlayCard(tp,0,0,1,maxct,REASON_COST,xyzg)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,atkg,#atkg,tp,e:GetLabel()*-1000)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(atk)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
}

function cards(): DuelCardData[] {
  return [
    { code: breakoutCode, name: "Goblin Biker Grand Breakout", kind: "spell", typeFlags: typeSpell | typeQuickPlay },
    { code: releaseCostCode, name: "Grand Breakout Release Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeDark, level: 3, attack: 1000, defense: 1000 },
    { code: summonGoblinCode, name: "Grand Breakout Goblin Summon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeDark, level: 3, attack: 1700, defense: 1000, setcodes: [setGoblin] },
    { code: goblinXyzCode, name: "Grand Breakout Goblin Xyz", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceBeastWarrior, attribute: attributeDark, level: 3, attack: 2100, defense: 0, setcodes: [setGoblin] },
    { code: overlayMaterialCode, name: "Grand Breakout Overlay Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeDark, level: 3, attack: 900, defense: 900 },
    { code: attackerCode, name: "Grand Breakout Opponent Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeDark, level: 4, attack: 1800, defense: 1000 },
    { code: opponentOtherCode, name: "Grand Breakout Opponent Other", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeDark, level: 4, attack: 1500, defense: 1000 },
  ];
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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
