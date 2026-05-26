import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const tacticsCode = "48032131";
const heroACode = "480321310";
const heroBCode = "480321311";
const highDestinyHeroCode = "480321312";
const banishTargetCode = "480321313";
const searchDestinyHeroCode = "480321314";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasTacticsScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${tacticsCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTrap = 0x4;
const typeContinuous = 0x20000;
const setHero = 0x8;
const setDestinyHero = 0xc008;
const raceWarrior = 0x1;
const raceFiend = 0x8;
const attributeDark = 0x20;
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasTacticsScript)("Lua real script D - Tactics standby HERO stat banish search", () => {
  it("restores Standby HERO ATK grant, high Destiny HERO summon banish, and destroyed Trap search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${tacticsCode}.lua`);
    expectTacticsScriptShape(script);
    const reader = createCardReader(cards());
    const session = createTacticsSession(reader, workspace);
    const tactics = requireCard(session, tacticsCode);
    const heroA = requireCard(session, heroACode);
    const heroB = requireCard(session, heroBCode);
    const highDestinyHero = requireCard(session, highDestinyHeroCode);
    const banishTarget = requireCard(session, banishTargetCode);
    const searchDestinyHero = requireCard(session, searchDestinyHeroCode);

    const restoredStandby = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredStandby);
    expectRestoredLegalActions(restoredStandby, 0);
    const boost = getLuaRestoreLegalActions(restoredStandby, 0).find((action) => action.type === "activateEffect" && action.uid === tactics.uid && action.effectId === "lua-2-1002");
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredStandby, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStandby, boost!);
    expect(restoredStandby.session.state.chain).toEqual([]);

    expect(currentAttack(restoredStandby.session.state.cards.find((card) => card.uid === heroA.uid), restoredStandby.session.state)).toBe(2000);
    expect(currentAttack(restoredStandby.session.state.cards.find((card) => card.uid === heroB.uid), restoredStandby.session.state)).toBe(1800);
    expect(restoredStandby.session.state.effects.filter((effect) => [heroA.uid, heroB.uid].includes(effect.sourceUid) && effect.code === 100).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 100, property: 0x400, reset: { flags: 33427456 }, sourceUid: heroA.uid, value: 400 },
      { code: 100, property: 0x400, reset: { flags: 33427456 }, sourceUid: heroB.uid, value: 400 },
    ]);

    specialSummonDuelCard(restoredStandby.session.state, highDestinyHero.uid, 0, 0, { eventReasonCardUid: tactics.uid, eventReasonEffectId: 900 }, 0, true, true);
    const restoredBanishWindow = restoreDuelWithLuaScripts(serializeDuel(restoredStandby.session), workspace, reader);
    expectCleanRestore(restoredBanishWindow);
    expectRestoredLegalActions(restoredBanishWindow, 0);
    expect(restoredBanishWindow.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonCardUid: trigger.eventReasonCardUid,
      eventReasonEffectId: trigger.eventReasonEffectId,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-3-1102",
        eventCardUid: highDestinyHero.uid,
        eventCode: 1102,
        eventName: "specialSummoned",
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonCardUid: tactics.uid,
        eventReasonEffectId: 900,
        player: 0,
        sourceUid: tactics.uid,
        triggerBucket: "turnOptional",
      },
    ]);
    const banish = getLuaRestoreLegalActions(restoredBanishWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === tactics.uid && action.effectId === "lua-3-1102");
    expect(banish, JSON.stringify(getLuaRestoreLegalActions(restoredBanishWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBanishWindow, banish!);
    expect(restoredBanishWindow.session.state.chain).toEqual([]);

    expect(restoredBanishWindow.session.state.cards.find((card) => card.uid === banishTarget.uid)).toMatchObject({
      location: "banished",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: tactics.uid,
      reasonEffectId: 3,
    });
    expect(restoredBanishWindow.session.state.eventHistory.filter((event) => ["specialSummoned", "banished"].includes(event.eventName)).map((event) => ({
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
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: highDestinyHero.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: tactics.uid, eventReasonEffectId: 900, previous: "hand", current: "monsterZone" },
      { eventName: "banished", eventCode: 1011, eventCardUid: banishTarget.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: tactics.uid, eventReasonEffectId: 3, previous: "graveyard", current: "banished" },
    ]);

    destroyDuelCard(restoredBanishWindow.session.state, tactics.uid, 0, duelReason.effect | duelReason.destroy, 0);
    const restoredSearchWindow = restoreDuelWithLuaScripts(serializeDuel(restoredBanishWindow.session), workspace, reader);
    expectCleanRestore(restoredSearchWindow);
    expectRestoredLegalActions(restoredSearchWindow, 0);
    const search = getLuaRestoreLegalActions(restoredSearchWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === tactics.uid && action.effectId === "lua-4-1029");
    expect(search, JSON.stringify(getLuaRestoreLegalActions(restoredSearchWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSearchWindow, search!);
    expect(restoredSearchWindow.session.state.chain).toEqual([]);

    expect(restoredSearchWindow.session.state.cards.find((card) => card.uid === tactics.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
    });
    expect(restoredSearchWindow.session.state.cards.find((card) => card.uid === searchDestinyHero.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: tactics.uid,
      reasonEffectId: 4,
    });
    expect(restoredSearchWindow.host.messages).toContain(`confirmed 1: ${searchDestinyHeroCode}`);
    expect(restoredSearchWindow.session.state.eventHistory.filter((event) => ["destroyed", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "destroyed", eventCode: 1029, eventCardUid: tactics.uid, eventPlayer: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "spellTrapZone", current: "graveyard" },
      { eventName: "sentToHand", eventCode: 1012, eventCardUid: searchDestinyHero.uid, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: tactics.uid, eventReasonEffectId: 4, previous: "deck", current: "hand" },
      { eventName: "confirmed", eventCode: 1211, eventCardUid: searchDestinyHero.uid, eventPlayer: 1, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: tactics.uid, eventReasonEffectId: 4, previous: "deck", current: "hand" },
      { eventName: "sentToHandConfirmed", eventCode: 1212, eventCardUid: searchDestinyHero.uid, eventPlayer: 1, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: tactics.uid, eventReasonEffectId: 4, previous: "deck", current: "hand" },
    ]);
    expect(restoredSearchWindow.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createTacticsSession(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): DuelSession {
  const session = createDuel({ seed: 48032131, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [tacticsCode, heroACode, heroBCode, highDestinyHeroCode, searchDestinyHeroCode] }, 1: { main: [banishTargetCode] } });
  startDuel(session);
  moveFaceUpSpellTrap(session, requireCard(session, tacticsCode), 0);
  moveFaceUpAttack(session, requireCard(session, heroACode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, heroBCode), 0, 1);
  moveDuelCard(session.state, requireCard(session, highDestinyHeroCode).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, banishTargetCode).uid, "graveyard", 1);
  session.state.phase = "standby";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(tacticsCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
}

function expectTacticsScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e0:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
  expect(script).toContain("e1:SetRange(LOCATION_SZONE)");
  expect(script).toContain("return Duel.IsPhase(PHASE_STANDBY)");
  expect(script).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsSetCard,SET_HERO),tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,g,#g,tp,400)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(400)");
  expect(script).toContain("e2:SetCategory(CATEGORY_REMOVE)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return eg:IsExists(s.rmconfilter,1,nil,tp)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,Card.IsAbleToRemove,tp,0,LOCATION_HAND|LOCATION_ONFIELD|LOCATION_GRAVE,1,1,nil)");
  expect(script).toContain("Duel.HintSelection(g)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_EFFECT)");
  expect(script).toContain("e3:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)");
  expect(script).toContain("e3:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("return c:IsReason(REASON_EFFECT) and c:IsPreviousLocation(LOCATION_STZONE)");
  expect(script).toContain("return c:IsSetCard(SET_DESTINY_HERO) and c:IsMonster() and c:IsAbleToHand()");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
}

function cards(): DuelCardData[] {
  return [
    { code: tacticsCode, name: "D - Tactics", kind: "trap", typeFlags: typeTrap | typeContinuous },
    { code: heroACode, name: "D - Tactics HERO A", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setHero], race: raceWarrior, attribute: attributeLight, level: 4, attack: 1600, defense: 1200 },
    { code: heroBCode, name: "D - Tactics HERO B", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setHero], race: raceWarrior, attribute: attributeLight, level: 4, attack: 1400, defense: 1000 },
    { code: highDestinyHeroCode, name: "D - Tactics Level 8 Destiny HERO", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setDestinyHero], race: raceWarrior, attribute: attributeDark, level: 8, attack: 2500, defense: 2000 },
    { code: banishTargetCode, name: "D - Tactics Opponent Banish Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1200, defense: 1000 },
    { code: searchDestinyHeroCode, name: "D - Tactics Destiny HERO Search Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setDestinyHero], race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
  ];
}

function moveFaceUpSpellTrap(session: DuelSession, card: DuelCardInstance, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.sequence = sequence;
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

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
