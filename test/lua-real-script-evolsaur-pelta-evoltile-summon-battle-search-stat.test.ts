import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const peltaCode = "16480084";
const evoltileSearchCode = "164800840";
const evolsaurDecoyCode = "164800841";
const spellDecoyCode = "164800842";
const opponentCode = "164800843";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasPeltaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${peltaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const raceReptile = 0x20000;
const attributeFire = 0x4;
const setEvoltile = 0x304e;
const setEvolsaur = 0x604e;
const summonTypeEvoltile = 0x40000000 + 150;
const effectUpdateDefense = 104;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasPeltaScript)("Lua real script Evolsaur Pelta Evoltile summon battle search stat", () => {
  it("restores Evoltile-coded Special Summon DEF gain and battle-destroyed Evoltile search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${peltaCode}.lua`);
    expect(script).toContain("Evolsaur Pelta");
    expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
    expect(script).toContain("e1:SetCondition(aux.evospcon)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_DEFENSE)");
    expect(script).toContain("e2:SetCode(EVENT_LEAVE_FIELD_P)");
    expect(script).toContain("if aux.evospcon(e) then e:SetLabel(1) else e:SetLabel(0) end");
    expect(script).toContain("e3:SetCode(EVENT_BATTLE_DESTROYED)");
    expect(script).toContain("e3:SetLabelObject(e2)");
    expect(script).toContain("return c:IsSetCard(SET_EVOLTILE) and c:IsMonster() and c:IsAbleToHand()");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)");
    expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,g)");

    const peltaData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === peltaCode);
    expect(peltaData).toBeDefined();
    const reader = createCardReader([
      peltaData!,
      ...fixtureCards(),
    ]);
    const session = createDuel({ seed: 16480084, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [peltaCode, evoltileSearchCode, evolsaurDecoyCode, spellDecoyCode] }, 1: { main: [opponentCode] } });
    startDuel(session);

    const pelta = requireCard(session, peltaCode);
    const evoltileSearch = requireCard(session, evoltileSearchCode);
    const evolsaurDecoy = requireCard(session, evolsaurDecoyCode);
    const spellDecoy = requireCard(session, spellDecoyCode);
    const opponent = requireCard(session, opponentCode, 1);
    moveDuelCard(session.state, pelta.uid, "hand", 0);
    moveFaceUpAttack(session, opponent, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(peltaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    specialSummonDuelCard(session.state, pelta.uid, 0, 0, {}, summonTypeEvoltile, true, true);

    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    expect(restoredSummon.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        player: 0,
        effectId: "lua-1-1102",
        sourceUid: pelta.uid,
        triggerBucket: "turnMandatory",
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: pelta.uid,
        eventPlayer: 0,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    const summonTrigger = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "activateTrigger" && action.uid === pelta.uid);
    expect(summonTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summonTrigger!);
    expect(restoredSummon.session.state.chain).toEqual([]);
    expect(currentDefense(restoredSummon.session.state.cards.find((card) => card.uid === pelta.uid), restoredSummon.session.state)).toBe(2500);
    expect(restoredSummon.session.state.effects.filter((effect) => effect.sourceUid === pelta.uid && effect.code === effectUpdateDefense).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateDefense, reset: { flags: 33492992 }, value: 500 },
    ]);

    restoredSummon.session.state.phase = "battle";
    restoredSummon.session.state.turnPlayer = 1;
    restoredSummon.session.state.waitingFor = 1;
    expectRestoredLegalActions(restoredSummon, 1);
    const attack = getLuaRestoreLegalActions(restoredSummon, 1).find(
      (action) => action.type === "declareAttack" && action.attackerUid === opponent.uid && action.targetUid === pelta.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, attack!);
    passBattleResponses(restoredSummon);

    const restoredBattleDestroyed = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader);
    expectCleanRestore(restoredBattleDestroyed);
    expectRestoredLegalActions(restoredBattleDestroyed, 0);
    expect(restoredBattleDestroyed.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-10-1",
        player: 0,
        effectId: "lua-3-1140",
        sourceUid: pelta.uid,
        triggerBucket: "opponentOptional",
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventPlayer: 0,
        eventCardUid: pelta.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: opponent.uid,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    const battleTrigger = getLuaRestoreLegalActions(restoredBattleDestroyed, 0).find((action) => action.type === "activateTrigger" && action.uid === pelta.uid);
    expect(battleTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredBattleDestroyed, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattleDestroyed, battleTrigger!);
    expect(restoredBattleDestroyed.session.state.chain).toEqual([]);
    expect(restoredBattleDestroyed.session.state.cards.find((card) => card.uid === pelta.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.battle | duelReason.destroy,
      reasonPlayer: 1,
      reasonCardUid: opponent.uid,
    });
    expect(restoredBattleDestroyed.session.state.cards.find((card) => card.uid === evoltileSearch.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: pelta.uid,
      reasonEffectId: 3,
    });
    expect(restoredBattleDestroyed.session.state.cards.find((card) => card.uid === evolsaurDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredBattleDestroyed.session.state.cards.find((card) => card.uid === spellDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredBattleDestroyed.session.state.battleDamage).toEqual({ 0: 1900, 1: 0 });
    expect(restoredBattleDestroyed.session.state.eventHistory.filter((event) => ["specialSummoned", "battleDestroyed", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: pelta.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: pelta.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: opponent.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      sentToHandEvent(evoltileSearch.uid, pelta.uid),
      confirmedEvent(evoltileSearch.uid, pelta.uid),
      sentToHandConfirmedEvent(evoltileSearch.uid, pelta.uid),
    ]);
  });
});

function fixtureCards(): DuelCardData[] {
  return [
    { code: evoltileSearchCode, name: "Pelta Evoltile Search Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeFire, level: 4, attack: 1200, defense: 1000, setcodes: [setEvoltile] },
    { code: evolsaurDecoyCode, name: "Pelta Evolsaur Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeFire, level: 4, attack: 1600, defense: 1200, setcodes: [setEvolsaur] },
    { code: spellDecoyCode, name: "Pelta Evoltile Spell Decoy", kind: "spell", typeFlags: typeSpell, setcodes: [setEvoltile] },
    { code: opponentCode, name: "Pelta Battle Destroyer", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeFire, level: 4, attack: 3000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string, owner = 0): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && candidate.owner === owner);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function passBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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
