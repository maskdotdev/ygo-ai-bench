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
const tinkhecCode = "42055234";
const dragonmaidTargetCode = "420552340";
const dragonmaidFusionCode = "420552341";
const dragonmaidLevel3Code = "420552342";
const attackerCode = "420552343";
const defenderCode = "420552344";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasTinkhecScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${tinkhecCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceDragon = 0x2000;
const raceWarrior = 0x1;
const attributeFire = 0x4;
const attributeEarth = 0x1;
const setDragonmaid = 0x133;
const effectIndestructableEffect = 41;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasTinkhecScript)("Lua real script Dragonmaid Tinkhec self-discard battle summon stat", () => {
  it("restores self-discard Damage Step boost, Fusion protection, and battle-end hand summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectTinkhecScriptShape(workspace.readScript(`official/c${tinkhecCode}.lua`));
    const reader = createCardReader(cards());

    const restoredDamageStep = createRestoredDamageStep({ reader, workspace });
    expectCleanRestore(restoredDamageStep);
    expectRestoredLegalActions(restoredDamageStep, 0);
    const tinkhec = requireCard(restoredDamageStep.session, tinkhecCode);
    const target = requireCard(restoredDamageStep.session, dragonmaidTargetCode);
    const attacker = requireCard(restoredDamageStep.session, attackerCode);
    const defender = requireCard(restoredDamageStep.session, defenderCode);
    expect(restoredDamageStep.session.state.effects.filter((effect) => effect.sourceUid === tinkhec.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      { category: 0x200000, code: 1002, countLimit: 1, event: "quick", id: "lua-1-1002", property: 0x4010, range: ["hand"], triggerEvent: undefined, value: undefined },
      { category: undefined, code: effectIndestructableEffect, countLimit: undefined, event: "continuous", id: "lua-2-41", property: 0x20000, range: ["monsterZone"], triggerEvent: undefined, value: 1 },
      { category: 0x208, code: 4224, countLimit: 1, event: "trigger", id: "lua-3-4224", property: undefined, range: ["monsterZone"], triggerEvent: "phaseBattle", value: undefined },
    ]);
    const attack = getLuaRestoreLegalActions(restoredDamageStep, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === defender.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredDamageStep, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDamageStep, attack!);
    passRestoredBattleAction(restoredDamageStep, 1, "passAttack");
    passRestoredBattleAction(restoredDamageStep, 0, "passAttack");
    expect(restoredDamageStep.session.state.battleWindow).toMatchObject({ kind: "startDamageStep", step: "damage", responsePlayer: 1 });
    passRestoredBattleAction(restoredDamageStep, 1, "passDamage");
    expect(restoredDamageStep.session.state.battleWindow).toMatchObject({ kind: "startDamageStep", step: "damage", responsePlayer: 0 });
    expect(currentAttack(target, restoredDamageStep.session.state)).toBe(1500);

    const boost = getLuaRestoreLegalActions(restoredDamageStep, 0).find((action) => action.type === "activateEffect" && action.uid === tinkhec.uid);
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredDamageStep, 0), null, 2)).toBeDefined();
    expect(boost).toMatchObject({ effectId: "lua-1-1002", windowKind: "battle" });
    applyRestoredActionAndAssert(restoredDamageStep, boost!);
    expect(restoredDamageStep.session.state.chain).toHaveLength(0);
    expect(restoredDamageStep.session.state.cards.find((card) => card.uid === tinkhec.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: tinkhec.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredDamageStep.session.state.cards.find((card) => card.uid === target.uid), restoredDamageStep.session.state)).toBe(3500);
    expect(restoredDamageStep.session.state.effects.filter((effect) => effect.code === effectUpdateAttack && effect.value === 2000).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: 0x400, reset: { flags: 1107169792 }, sourceUid: target.uid, value: 2000 },
    ]);
    expect(restoredDamageStep.session.state.eventHistory.filter((event) => ["sentToGraveyard", "becameTarget"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: tinkhec.uid, eventReason: duelReason.cost | duelReason.discard, eventReasonPlayer: 0, eventReasonCardUid: tinkhec.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previous: "hand", current: "graveyard" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: target.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 1, previous: "deck", current: "monsterZone" },
    ]);

    const restoredProtection = createRestoredProtection({ reader, workspace });
    expectCleanRestore(restoredProtection);
    expectRestoredLegalActions(restoredProtection, 0);
    const protectedTinkhec = requireCard(restoredProtection.session, tinkhecCode);
    const destroyProbe = restoredProtection.host.loadScript(
      `
      local tinkhec=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${tinkhecCode}),0,LOCATION_MZONE,0,nil)
      Debug.Message("tinkhec destroy protected " .. Duel.Destroy(tinkhec,REASON_EFFECT))
      `,
      "dragonmaid-tinkhec-fusion-protection-probe.lua",
    );
    expect(destroyProbe.ok, destroyProbe.error).toBe(true);
    expect(restoredProtection.host.messages).toContain("tinkhec destroy protected 0");
    expect(restoredProtection.session.state.cards.find((card) => card.uid === protectedTinkhec.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredProtection.session.state.effects.filter((effect) => effect.sourceUid === protectedTinkhec.uid && effect.code === effectIndestructableEffect).map((effect) => ({
      code: effect.code,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectIndestructableEffect, property: 0x20000, range: ["monsterZone"], sourceUid: protectedTinkhec.uid, value: 1 },
    ]);

    const restoredBattleEnd = createRestoredBattleEnd({ reader, workspace });
    expectCleanRestore(restoredBattleEnd);
    expectRestoredLegalActions(restoredBattleEnd, 0);
    const battleTinkhec = requireCard(restoredBattleEnd.session, tinkhecCode);
    const level3 = requireCard(restoredBattleEnd.session, dragonmaidLevel3Code);
    const main2 = getLuaRestoreLegalActions(restoredBattleEnd, 0).find((action) => action.type === "changePhase" && action.phase === "main2");
    expect(main2, JSON.stringify(getLuaRestoreLegalActions(restoredBattleEnd, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattleEnd, main2!);
    expect(restoredBattleEnd.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventTriggerTiming: trigger.eventTriggerTiming,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-3-4224", eventCode: 0x1080, eventName: "phaseBattle", eventTriggerTiming: "when", player: 0, sourceUid: battleTinkhec.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattleEnd.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const summon = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === battleTinkhec.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    expect(summon).not.toHaveProperty("operationInfos");
    expect(summon).toMatchObject({
      effectId: "lua-3-4224",
      triggerBucket: "turnOptional",
    });
    applyRestoredActionAndAssert(restoredTrigger, summon!);
    resolveRestoredChain(restoredTrigger);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === battleTinkhec.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: battleTinkhec.uid,
      reasonEffectId: 3,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === level3.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: battleTinkhec.uid,
      reasonEffectId: 3,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["phaseBattle", "sentToHand", "specialSummoned"].includes(event.eventName)).map((event) => ({
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
      { eventName: "phaseBattle", eventCode: 0x1080, eventCardUid: undefined, eventReason: undefined, eventReasonPlayer: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: undefined, current: undefined },
      { eventName: "sentToHand", eventCode: 1012, eventCardUid: battleTinkhec.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: battleTinkhec.uid, eventReasonEffectId: 3, previous: "monsterZone", current: "hand" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: level3.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: battleTinkhec.uid, eventReasonEffectId: 3, previous: "hand", current: "monsterZone" },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredDamageStep({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 42055234, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [tinkhecCode, dragonmaidTargetCode, attackerCode] }, 1: { main: [defenderCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, tinkhecCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, dragonmaidTargetCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, attackerCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, defenderCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(tinkhecCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredProtection({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 42055235, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [tinkhecCode], extra: [dragonmaidFusionCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, tinkhecCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, dragonmaidFusionCode), 0, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(tinkhecCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredBattleEnd({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 42055236, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [tinkhecCode, dragonmaidLevel3Code] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, tinkhecCode), 0, 0);
  moveDuelCard(session.state, requireCard(session, dragonmaidLevel3Code).uid, "hand", 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(tinkhecCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectTinkhecScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e1:SetRange(LOCATION_HAND)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("e1:SetCost(Cost.SelfDiscard)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(2000)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
  expect(script).toContain("e2:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)");
  expect(script).toContain("return Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsType,TYPE_FUSION),e:GetHandlerPlayer(),LOCATION_MZONE,0,1,nil)");
  expect(script).toContain("e3:SetCategory(CATEGORY_TOHAND+CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e3:SetCode(EVENT_PHASE|PHASE_BATTLE)");
  expect(script).toContain("return c:GetLevel()==3 and c:IsSetCard(SET_DRAGONMAID) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
  expect(script).toContain("Duel.SendtoHand(c,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_HAND,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");
}

function cards(): DuelCardData[] {
  return [
    { code: tinkhecCode, name: "Dragonmaid Tinkhec", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeFire, level: 8, attack: 2700, defense: 1700, setcodes: [setDragonmaid] },
    { code: dragonmaidTargetCode, name: "Tinkhec Dragonmaid Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeFire, level: 4, attack: 1500, defense: 1000, setcodes: [setDragonmaid] },
    { code: dragonmaidFusionCode, name: "Tinkhec Dragonmaid Fusion", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceDragon, attribute: attributeFire, level: 8, attack: 3000, defense: 2000, setcodes: [setDragonmaid] },
    { code: dragonmaidLevel3Code, name: "Tinkhec Level 3 Dragonmaid", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeFire, level: 3, attack: 500, defense: 1700, setcodes: [setDragonmaid] },
    { code: attackerCode, name: "Tinkhec Damage Step Attacker", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
    { code: defenderCode, name: "Tinkhec Damage Step Defender", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function passRestoredBattleAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, type: "passAttack" | "passDamage"): void {
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === type);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, action!);
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
