import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const dragodiesCode = "65472618";
const discardCode = "654726180";
const attackerCode = "654726181";
const opponentBattleCode = "654726182";
const searchCode = "654726183";
const highAttackDecoyCode = "654726184";
const wrongRaceDecoyCode = "654726185";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasDragodiesScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${dragodiesCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const raceDragon = 0x2000;
const attributeLight = 0x10;
const effectSetAttackFinal = 102;
const effectSetDefenseFinal = 106;
const phaseEndEventCode = 0x1200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasDragodiesScript)("Lua real script Dragodies PZone battle destroyed search stat", () => {
  it("restores PZone battle discard into opposing ATK/DEF halving and delayed destroyed End Phase search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${dragodiesCode}.lua`);
    expect(script).toContain("Pendulum.AddProcedure(c)");
    expect(script).toContain("e1:SetCode(EVENT_BATTLE_START)");
    expect(script).toContain("e1:SetRange(LOCATION_PZONE)");
    expect(script).toContain("Duel.DiscardHand(tp,Card.IsDiscardable,1,1,REASON_DISCARD+REASON_COST,nil)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
    expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE_FINAL)");
    expect(script).toContain("e2:SetCode(EVENT_DESTROYED)");
    expect(script).toContain("rp==1-tp and c:IsPreviousControler(tp) and c:IsPreviousLocation(LOCATION_MZONE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)");
    expect(script).toContain("e1:SetCode(EVENT_PHASE+PHASE_END)");
    expect(script).toContain("return c:IsAttackBelow(2000) and c:IsRace(RACE_WARRIOR|RACE_SPELLCASTER) and not c:IsCode(id) and c:IsAbleToHand()");
    expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
    expect(script).toContain("Duel.ConfirmCards(1-tp,g)");

    const dragodiesData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === dragodiesCode);
    expect(dragodiesData).toBeDefined();
    const reader = createCardReader([
      dragodiesData!,
      ...fixtureCards(),
    ]);

    const battleSession = createDuel({ seed: 65472618, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(battleSession, { 0: { main: [dragodiesCode, discardCode, attackerCode] }, 1: { main: [opponentBattleCode] } });
    startDuel(battleSession);

    const battleScale = requireCard(battleSession, dragodiesCode);
    const discard = requireCard(battleSession, discardCode);
    const attacker = requireCard(battleSession, attackerCode);
    const opponentBattle = requireCard(battleSession, opponentBattleCode, 1);
    moveToPZone(battleSession, battleScale, 0);
    moveDuelCard(battleSession.state, discard.uid, "hand", 0);
    moveFaceUpAttack(battleSession, attacker, 0);
    moveFaceUpAttack(battleSession, opponentBattle, 1);
    battleSession.state.phase = "battle";
    battleSession.state.turnPlayer = 0;
    battleSession.state.waitingFor = 0;

    const battleHost = createLuaScriptHost(battleSession, workspace);
    expect(battleHost.loadCardScript(Number(dragodiesCode), workspace).ok).toBe(true);
    expect(battleHost.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(battleSession, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === opponentBattle.uid,
    );
    expect(attack, JSON.stringify(getLegalActions(battleSession, 0), null, 2)).toBeDefined();
    applyAndAssert(battleSession, attack!);
    passUntilPendingTrigger(battleSession, "battleStarted");

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(battleSession), workspace, reader);
    expectCleanRestore(restoredBattle);
    expect(restoredBattle.session.state.battleWindow?.kind).toBe("startDamageStep");
    expectRestoredLegalActions(restoredBattle, 0);
    const pzoneTrigger = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "activateTrigger" && action.uid === battleScale.uid);
    expect(pzoneTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, pzoneTrigger!);
    expect(restoredBattle.session.state.chain).toEqual([]);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === discard.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: battleScale.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(restoredBattle.session.state.cards.find((card) => card.uid === opponentBattle.uid), restoredBattle.session.state)).toBe(1200);
    expect(currentDefense(restoredBattle.session.state.cards.find((card) => card.uid === opponentBattle.uid), restoredBattle.session.state)).toBe(800);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredBattle.session.state.effects.filter((effect) => effect.sourceUid === opponentBattle.uid && [effectSetAttackFinal, effectSetDefenseFinal].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, reset: { flags: 33427456 }, sourceUid: opponentBattle.uid, value: 1200 },
      { code: effectSetDefenseFinal, reset: { flags: 33427456 }, sourceUid: opponentBattle.uid, value: 800 },
    ]);
    expect(restoredBattle.session.state.eventHistory.filter((event) => ["battleStarted", "discarded", "chainSolved"].includes(event.eventName))).toEqual([
      {
        eventName: "battleStarted",
        eventCode: 1132,
        eventCardUid: attacker.uid,
        eventUids: [attacker.uid, opponentBattle.uid],
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "discarded",
        eventCode: 1018,
        eventCardUid: discard.uid,
        eventReason: duelReason.cost | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: battleScale.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "chainSolved",
        eventCode: 1022,
        eventPlayer: 0,
        eventValue: 1,
        eventReasonPlayer: 0,
        relatedEffectId: 3,
        eventChainDepth: 1,
        eventChainLinkId: "chain-4",
      },
    ]);

    const searchSession = createDuel({ seed: 65472619, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(searchSession, { 0: { main: [dragodiesCode, searchCode, highAttackDecoyCode, wrongRaceDecoyCode] }, 1: { main: [] } });
    startDuel(searchSession);

    const monsterDragodies = requireCard(searchSession, dragodiesCode);
    const searchTarget = requireCard(searchSession, searchCode);
    const highAttackDecoy = requireCard(searchSession, highAttackDecoyCode);
    const wrongRaceDecoy = requireCard(searchSession, wrongRaceDecoyCode);
    moveFaceUpAttack(searchSession, monsterDragodies, 0);
    searchSession.state.phase = "main2";
    searchSession.state.turnPlayer = 0;
    searchSession.state.waitingFor = 0;

    const searchHost = createLuaScriptHost(searchSession, workspace);
    expect(searchHost.loadCardScript(Number(dragodiesCode), workspace).ok).toBe(true);
    expect(searchHost.registerInitialEffects()).toBe(1);
    const destroyed = destroyDuelCard(searchSession.state, monsterDragodies.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(destroyed).toMatchObject({
      location: "extraDeck",
      controller: 0,
      faceUp: true,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 1,
    });

    const restoredDestroyed = restoreDuelWithLuaScripts(serializeDuel(searchSession), workspace, reader);
    expectCleanRestore(restoredDestroyed);
    expectRestoredLegalActions(restoredDestroyed, 0);
    const destroyedTrigger = getLuaRestoreLegalActions(restoredDestroyed, 0).find((action) => action.type === "activateTrigger" && action.uid === monsterDragodies.uid);
    expect(destroyedTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDestroyed, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroyed, destroyedTrigger!);
    expect(restoredDestroyed.session.state.chain).toEqual([]);
    expect(restoredDestroyed.session.state.effects.find((effect) => effect.sourceUid === monsterDragodies.uid && effect.code === phaseEndEventCode)).toMatchObject({
      event: "continuous",
      sourceUid: monsterDragodies.uid,
      reset: { flags: 1073742336 },
    });

    const restoredRegistered = restoreDuelWithLuaScripts(serializeDuel(restoredDestroyed.session), workspace, reader);
    expectCleanRestore(restoredRegistered);
    expectRestoredLegalActions(restoredRegistered, 0);
    const endPhase = getLuaRestoreLegalActions(restoredRegistered, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(endPhase, JSON.stringify(getLuaRestoreLegalActions(restoredRegistered, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRegistered, endPhase!);

    const restoredEnd = restoreDuelWithLuaScripts(serializeDuel(restoredRegistered.session), workspace, reader);
    expectCleanRestore(restoredEnd);
    expectRestoredLegalActions(restoredEnd, 0);
    const endTurn = getLuaRestoreLegalActions(restoredEnd, 0).find((action) => action.type === "endTurn");
    expect(endTurn, JSON.stringify(getLuaRestoreLegalActions(restoredEnd, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEnd, endTurn!);
    expect(restoredEnd.session.state.cards.find((card) => card.uid === searchTarget.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: monsterDragodies.uid,
      reasonEffectId: 5,
    });
    expect(restoredEnd.session.state.cards.find((card) => card.uid === highAttackDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredEnd.session.state.cards.find((card) => card.uid === wrongRaceDecoy.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredEnd.session.state.eventHistory.filter((event) => ["destroyed", "phaseEnd", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: monsterDragodies.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
      },
      sentToHandEvent(searchTarget.uid, monsterDragodies.uid),
      confirmedEvent(searchTarget.uid, monsterDragodies.uid),
      sentToHandConfirmedEvent(searchTarget.uid, monsterDragodies.uid),
      { eventName: "phaseEnd", eventCode: phaseEndEventCode },
    ]);
  });
});

function fixtureCards(): DuelCardData[] {
  return [
    { code: discardCode, name: "Dragodies Discard Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    { code: attackerCode, name: "Dragodies Battle Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    { code: opponentBattleCode, name: "Dragodies Opponent Battle Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeLight, level: 4, attack: 2400, defense: 1600 },
    { code: searchCode, name: "Dragodies Search Warrior", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1800, defense: 1000 },
    { code: highAttackDecoyCode, name: "Dragodies High Attack Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 2100, defense: 1000 },
    { code: wrongRaceDecoyCode, name: "Dragodies Wrong Race Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeLight, level: 4, attack: 1500, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string, owner = 0): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && candidate.owner === owner);
  expect(card).toBeDefined();
  return card!;
}

function moveToPZone(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = 0;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
}

function passUntilPendingTrigger(session: DuelSession, eventName: string): void {
  let guard = 0;
  while (!session.state.pendingTriggers.some((trigger) => trigger.eventName === eventName)) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const pass = getLegalActions(session, player).find((action) => action.type === "passAttack");
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
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
    eventReasonEffectId: 5,
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
    eventReasonEffectId: 5,
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
    eventReasonEffectId: 5,
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
