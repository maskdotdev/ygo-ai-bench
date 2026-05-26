import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const ceratoCode = "80651316";
const evoltileSearchCode = "806513160";
const evolsaurDecoyCode = "806513161";
const spellDecoyCode = "806513162";
const opponentCode = "806513163";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasCeratoScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${ceratoCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const raceReptile = 0x20000;
const attributeFire = 0x4;
const setEvoltile = 0x304e;
const setEvolsaur = 0x604e;
const summonTypeEvoltile = 0x40000000 + 150;
const effectUpdateAttack = 100;
const resetEventStandardDisable = 33492992;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasCeratoScript)("Lua real script Evolsaur Cerato evosp attack battle search stat", () => {
  it("restores Evoltile-coded Special Summon ATK gain and battle-destroying Evoltile search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectCeratoScriptShape(workspace.readScript(`official/c${ceratoCode}.lua`));
    const ceratoData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === ceratoCode);
    expect(ceratoData).toBeDefined();
    const reader = createCardReader([
      { ...ceratoData!, setcodes: [setEvolsaur] },
      ...fixtureCards(),
    ]);

    const session = createDuel({ seed: 80651316, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ceratoCode, evoltileSearchCode, evolsaurDecoyCode, spellDecoyCode] }, 1: { main: [opponentCode] } });
    startDuel(session);
    const cerato = requireCard(session, ceratoCode);
    const evoltileSearch = requireCard(session, evoltileSearchCode);
    const evolsaurDecoy = requireCard(session, evolsaurDecoyCode);
    const spellDecoy = requireCard(session, spellDecoyCode);
    const opponent = requireCard(session, opponentCode, 1);
    moveDuelCard(session.state, cerato.uid, "hand", 0);
    moveFaceUpAttack(session, opponent, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(ceratoCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    specialSummonDuelCard(session.state, cerato.uid, 0, 0, {}, summonTypeEvoltile, true, true);

    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    expect(restoredSummon.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        player: 0,
        effectId: "lua-1-1102",
        sourceUid: cerato.uid,
        triggerBucket: "turnMandatory",
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: cerato.uid,
        eventPlayer: 0,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    const summonTrigger = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "activateTrigger" && action.uid === cerato.uid);
    expect(summonTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summonTrigger!);
    expect(restoredSummon.session.state.chain).toEqual([]);
    expect(currentAttack(restoredSummon.session.state.cards.find((card) => card.uid === cerato.uid), restoredSummon.session.state)).toBe(2100);
    expect(restoredSummon.session.state.effects.filter((effect) => effect.sourceUid === cerato.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: resetEventStandardDisable }, value: 200 },
    ]);
    expect(restoredSummon.session.state.effects.filter((effect) => effect.sourceUid === cerato.uid && effect.triggerEvent === "battleDestroyed" && effect.code === 1139).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      optional: effect.optional,
      reset: effect.reset,
      triggerCode: effect.triggerCode,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: 0x20008, code: 1139, event: "trigger", optional: true, reset: { flags: resetEventStandardDisable }, triggerCode: 1139, triggerEvent: "battleDestroyed" },
    ]);

    restoredSummon.session.state.phase = "battle";
    restoredSummon.session.state.turnPlayer = 0;
    restoredSummon.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredSummon, 0);
    const attack = getLuaRestoreLegalActions(restoredSummon, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === cerato.uid && action.targetUid === opponent.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, attack!);
    passRestoredBattleUntilTrigger(restoredSummon);

    const restoredSearchTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader);
    expectCleanRestore(restoredSearchTrigger);
    expectRestoredLegalActions(restoredSearchTrigger, 0);
    expect(restoredSearchTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-9-1",
        player: 0,
        effectId: "lua-3-1139",
        sourceUid: cerato.uid,
        triggerBucket: "turnOptional",
        eventName: "battleDestroyed",
        eventCode: 1139,
        eventPlayer: 1,
        eventCardUid: cerato.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: cerato.uid,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    const searchTrigger = getLuaRestoreLegalActions(restoredSearchTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === cerato.uid && action.effectId === "lua-3-1139"
    );
    expect(searchTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredSearchTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSearchTrigger, searchTrigger!);
    expect(restoredSearchTrigger.session.state.chain).toEqual([]);

    expect(restoredSearchTrigger.session.state.cards.find((card) => card.uid === opponent.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.battle | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: cerato.uid,
    });
    expect(restoredSearchTrigger.session.state.cards.find((card) => card.uid === evoltileSearch.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: cerato.uid,
      reasonEffectId: 3,
    });
    expect(restoredSearchTrigger.session.state.cards.find((card) => card.uid === evolsaurDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredSearchTrigger.session.state.cards.find((card) => card.uid === spellDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredSearchTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 1100 });
    expect(restoredSearchTrigger.session.state.eventHistory.filter((event) => ["specialSummoned", "battleDestroyed", "battleDamageDealt", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: cerato.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: cerato.uid,
        eventPlayer: 1,
        eventReason: duelReason.battle,
        eventReasonPlayer: 0,
        eventReasonCardUid: cerato.uid,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventValue: 1100,
      },
      {
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: opponent.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: cerato.uid,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      sentToHandEvent(evoltileSearch.uid, cerato.uid),
      confirmedEvent(evoltileSearch.uid, cerato.uid),
      sentToHandConfirmedEvent(evoltileSearch.uid, cerato.uid),
    ]);
  });
});

function fixtureCards(): DuelCardData[] {
  return [
    { code: evoltileSearchCode, name: "Cerato Evoltile Search Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeFire, level: 4, attack: 1200, defense: 1000, setcodes: [setEvoltile] },
    { code: evolsaurDecoyCode, name: "Cerato Evolsaur Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeFire, level: 4, attack: 1600, defense: 1200, setcodes: [setEvolsaur] },
    { code: spellDecoyCode, name: "Cerato Evoltile Spell Decoy", kind: "spell", typeFlags: typeSpell, setcodes: [setEvoltile] },
    { code: opponentCode, name: "Cerato Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeFire, level: 4, attack: 1000, defense: 1000 },
  ];
}

function expectCeratoScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Evolsaur Cerato");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("e1:SetCondition(aux.evospcon)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(200)");
  expect(script).toContain("e1:SetReset(RESET_EVENT|RESETS_STANDARD_DISABLE)");
  expect(script).toContain("e2:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
  expect(script).toContain("e2:SetCode(EVENT_BATTLE_DESTROYING)");
  expect(script).toContain("e2:SetReset(RESET_EVENT|RESETS_STANDARD_DISABLE)");
  expect(script).toContain("return c:IsSetCard(SET_EVOLTILE) and c:IsMonster() and c:IsAbleToHand()");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.sfilter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
}

function requireCard(session: DuelSession, code: string, owner = 0): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && candidate.owner === owner);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function sentToHandEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "sentToHand",
    eventCode: 1012,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 3,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
  };
}

function confirmedEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "confirmed",
    eventCode: 1211,
    eventCardUid: cardUid,
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 3,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
  };
}

function sentToHandConfirmedEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "sentToHandConfirmed",
    eventCode: 1212,
    eventCardUid: cardUid,
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 3,
    eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 3 },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
  };
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

function passRestoredBattleUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(30);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
