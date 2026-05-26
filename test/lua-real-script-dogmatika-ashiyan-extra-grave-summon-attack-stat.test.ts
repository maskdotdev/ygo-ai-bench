import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const ashiyanCode = "13694209";
const gyDogmatikaCode = "136942090";
const allyDogmatikaCode = "136942091";
const extraSentCode = "136942092";
const opponentAttackerCode = "136942093";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAshiyanScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${ashiyanCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceSpellcaster = 0x2;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const attributeEarth = 0x1;
const setDogmatika = 0x146;
const effectUpdateAttack = 100;
const eventAttackAnnounce = 1130;
const eventSpecialSummonSuccess = 1102;
const eventToGrave = 1014;

describe.skipIf(!hasUpstreamScripts || !hasAshiyanScript)("Lua real script Dogmatika Ashiyan extra grave summon attack stat", () => {
  it("restores Extra Deck to-GY self summon, hand-summon recovery, and opponent attack Dogmatika boosts", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectAshiyanScriptShape(workspace.readScript(`official/c${ashiyanCode}.lua`));
    const reader = createCardReader(cards());

    const restoredOpen = createRestoredAshiyanSummon({ reader, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const ashiyan = requireCard(restoredOpen.session, ashiyanCode);
    const extraSent = requireCard(restoredOpen.session, extraSentCode);
    const gyDogmatika = requireCard(restoredOpen.session, gyDogmatikaCode);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === ashiyan.uid).map((effect) => ({
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
      { category: 0x200, code: eventToGrave, countLimit: 1, event: "trigger", id: "lua-1-1014", property: 0x10000, range: ["hand"], triggerEvent: "sentToGraveyard", value: undefined },
      { category: 0x8, code: eventSpecialSummonSuccess, countLimit: 1, event: "trigger", id: "lua-2-1102", property: 0x10010, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "specialSummoned", value: undefined },
      { category: 0x200000, code: eventAttackAnnounce, countLimit: 1, event: "trigger", id: "lua-3-1130", property: undefined, range: ["monsterZone"], triggerEvent: "attackDeclared", value: undefined },
    ]);

    sendDuelCardToGraveyard(restoredOpen.session.state, extraSent.uid, 0, duelReason.effect, 0);
    expect(restoredOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonPlayer: trigger.eventReasonPlayer,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-1-1014", eventCardUid: extraSent.uid, eventCode: eventToGrave, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonPlayer: 0, player: 0, sourceUid: ashiyan.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredSummonTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredSummonTrigger);
    expectRestoredLegalActions(restoredSummonTrigger, 0);
    const summon = getLuaRestoreLegalActions(restoredSummonTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === ashiyan.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummonTrigger, 0), null, 2)).toBeDefined();
    expect(summon).not.toHaveProperty("operationInfos");
    expect(summon).toMatchObject({
      effectId: "lua-1-1014",
      triggerBucket: "turnOptional",
    });
    applyRestoredActionAndAssert(restoredSummonTrigger, summon!);
    resolveRestoredChain(restoredSummonTrigger);
    expect(restoredSummonTrigger.session.state.cards.find((card) => card.uid === ashiyan.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: ashiyan.uid,
      reasonEffectId: 1,
    });
    expect(restoredSummonTrigger.session.state.pendingTriggers.map((trigger) => ({
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
      { effectId: "lua-2-1102", eventCardUid: ashiyan.uid, eventCode: eventSpecialSummonSuccess, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: ashiyan.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, player: 0, sourceUid: ashiyan.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredRecovery = restoreDuelWithLuaScripts(serializeDuel(restoredSummonTrigger.session), workspace, reader);
    expectCleanRestore(restoredRecovery);
    expectRestoredLegalActions(restoredRecovery, 0);
    const recover = getLuaRestoreLegalActions(restoredRecovery, 0).find((action) => action.type === "activateTrigger" && action.uid === ashiyan.uid && action.effectId === "lua-2-1102");
    expect(recover, JSON.stringify(getLuaRestoreLegalActions(restoredRecovery, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRecovery, recover!);
    resolveRestoredChain(restoredRecovery);
    expect(restoredRecovery.session.state.cards.find((card) => card.uid === gyDogmatika.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: ashiyan.uid,
      reasonEffectId: 2,
    });
    expect(restoredRecovery.session.state.eventHistory.filter((event) => ["sentToGraveyard", "specialSummoned", "becameTarget", "sentToHand"].includes(event.eventName)).map((event) => ({
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
      { eventName: "sentToGraveyard", eventCode: eventToGrave, eventCardUid: extraSent.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined, previous: "extraDeck", current: "graveyard" },
      { eventName: "specialSummoned", eventCode: eventSpecialSummonSuccess, eventCardUid: ashiyan.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: ashiyan.uid, eventReasonEffectId: 1, relatedEffectId: undefined, previous: "hand", current: "monsterZone" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: gyDogmatika.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 2, previous: "deck", current: "graveyard" },
      { eventName: "sentToHand", eventCode: 1012, eventCardUid: gyDogmatika.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: ashiyan.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "graveyard", current: "hand" },
    ]);

    const restoredAttack = createRestoredAshiyanAttack({ reader, workspace });
    expectCleanRestore(restoredAttack);
    expectRestoredLegalActions(restoredAttack, 1);
    const attackAshiyan = requireCard(restoredAttack.session, ashiyanCode);
    const ally = requireCard(restoredAttack.session, allyDogmatikaCode);
    const opponent = requireCard(restoredAttack.session, opponentAttackerCode);
    const attack = getLuaRestoreLegalActions(restoredAttack, 1).find(
      (action) => action.type === "declareAttack" && action.attackerUid === opponent.uid && action.targetUid === attackAshiyan.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredAttack, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttack, attack!);
    expect(restoredAttack.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonPlayer: trigger.eventReasonPlayer,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-3-1130", eventCardUid: opponent.uid, eventCode: eventAttackAnnounce, eventName: "attackDeclared", eventReason: 0, eventReasonPlayer: 1, player: 0, sourceUid: attackAshiyan.uid, triggerBucket: "opponentOptional" },
    ]);

    const restoredAttackTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredAttack.session), workspace, reader);
    expectCleanRestore(restoredAttackTrigger);
    expectRestoredLegalActions(restoredAttackTrigger, 0);
    const boost = getLuaRestoreLegalActions(restoredAttackTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === attackAshiyan.uid);
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredAttackTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttackTrigger, boost!);
    resolveRestoredChain(restoredAttackTrigger);
    expect(currentAttack(restoredAttackTrigger.session.state.cards.find((card) => card.uid === attackAshiyan.uid), restoredAttackTrigger.session.state)).toBe(2500);
    expect(currentAttack(restoredAttackTrigger.session.state.cards.find((card) => card.uid === ally.uid), restoredAttackTrigger.session.state)).toBe(2300);
    expect(currentAttack(restoredAttackTrigger.session.state.cards.find((card) => card.uid === opponent.uid), restoredAttackTrigger.session.state)).toBe(2600);
    expect(restoredAttackTrigger.session.state.effects.filter((effect) => effect.code === effectUpdateAttack && effect.value === 500).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: 0x400, reset: { flags: 33427456 }, sourceUid: attackAshiyan.uid, value: 500 },
      { code: effectUpdateAttack, property: 0x400, reset: { flags: 33427456 }, sourceUid: ally.uid, value: 500 },
    ]);
    expect(restoredAttackTrigger.session.state.eventHistory.filter((event) => event.eventName === "attackDeclared").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "attackDeclared", eventCode: eventAttackAnnounce, eventCardUid: opponent.uid, eventReason: 0, eventReasonPlayer: 1, previous: "deck", current: "monsterZone" },
    ]);
    expect(restoredAttackTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredAshiyanSummon({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 13694209, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [ashiyanCode, gyDogmatikaCode], extra: [extraSentCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, ashiyanCode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, gyDogmatikaCode).uid, "graveyard", 0).faceUp = true;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(ashiyanCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredAshiyanAttack({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 13694210, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [ashiyanCode, allyDogmatikaCode] }, 1: { main: [opponentAttackerCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, ashiyanCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, allyDogmatikaCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, opponentAttackerCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(ashiyanCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectAshiyanScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_DELAY)");
  expect(script).toContain("e1:SetRange(LOCATION_HAND)");
  expect(script).toContain("e1:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("return eg:IsExists(Card.IsType,1,nil,TYPE_EXTRA)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,c,1,0,0)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e2:SetCategory(CATEGORY_TOHAND)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DELAY+EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("return e:GetHandler():IsSummonLocation(LOCATION_HAND)");
  expect(script).toContain("return c:IsSetCard(SET_DOGMATIKA) and c:IsAbleToHand() and not c:IsCode(id)");
  expect(script).toContain("Duel.SelectTarget(tp,s.thfilter,tp,LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoHand(tc,nil,REASON_EFFECT)");
  expect(script).toContain("e3:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e3:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("return Duel.GetAttacker():IsControler(1-tp)");
  expect(script).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsSetCard,SET_DOGMATIKA),tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(500)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD)");
}

function cards(): DuelCardData[] {
  return [
    { code: ashiyanCode, name: "Dogmatika Ashiyan", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeLight, level: 8, attack: 2000, defense: 1500, setcodes: [setDogmatika] },
    { code: gyDogmatikaCode, name: "Ashiyan Grave Dogmatika", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeLight, level: 4, attack: 1500, defense: 1500, setcodes: [setDogmatika] },
    { code: allyDogmatikaCode, name: "Ashiyan Field Dogmatika", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeLight, level: 4, attack: 1800, defense: 1500, setcodes: [setDogmatika] },
    { code: extraSentCode, name: "Ashiyan Extra Deck Sent Fusion", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceSpellcaster, attribute: attributeLight, level: 8, attack: 2500, defense: 2000 },
    { code: opponentAttackerCode, name: "Ashiyan Opponent Attacker", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2600, defense: 1000 },
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
