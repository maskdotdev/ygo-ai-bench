import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const leadingLadyCode = "24907044";
const attackerCode = "249070440";
const extraActorCode = "249070441";
const extraDecoyCode = "249070442";
const battleTargetCode = "249070443";
const abyssScriptCode = "249070444";
const statTargetCode = "249070445";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasLeadingLadyScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${leadingLadyCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const raceFiend = 0x8;
const attributeDark = 0x20;
const setAbyssActor = 0x10ec;
const setAbyssScript = 0x20ec;
const effectUpdateAttack = 100;
const resetEventStandard = 33427456;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasLeadingLadyScript)("Lua real script Abyss Actor Leading Lady battle damage search set stat", () => {
  it("restores PZONE battle-damage choices, monster-zone ATK loss, and destroyed Abyss Script Set", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectLeadingLadyScriptShape(workspace.readScript(`official/c${leadingLadyCode}.lua`));
    const leadingLadyData = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === leadingLadyCode);
    expect(leadingLadyData).toBeDefined();
    const reader = createCardReader([{ ...leadingLadyData!, setcodes: [setAbyssActor] }, ...fixtureCards()]);

    const restoredPzoneAttackDrop = createRestoredPzoneDamageWindow({ reader, workspace });
    expectCleanRestore(restoredPzoneAttackDrop);
    expectRestoredLegalActions(restoredPzoneAttackDrop, 1);
    const pzoneLeadingLady = requireCard(restoredPzoneAttackDrop.session, leadingLadyCode);
    const directAttacker = requireCard(restoredPzoneAttackDrop.session, attackerCode, 1);
    const directAttack = getLuaRestoreLegalActions(restoredPzoneAttackDrop, 1).find(
      (action) => action.type === "declareAttack" && action.attackerUid === directAttacker.uid && !("targetUid" in action),
    );
    expect(directAttack, JSON.stringify(getLuaRestoreLegalActions(restoredPzoneAttackDrop, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPzoneAttackDrop, directAttack!);
    passBattleUntilTrigger(restoredPzoneAttackDrop);
    expect(restoredPzoneAttackDrop.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventPlayer: trigger.eventPlayer,
      eventReason: trigger.eventReason,
      eventReasonCardUid: trigger.eventReasonCardUid,
      eventReasonPlayer: trigger.eventReasonPlayer,
      eventValue: trigger.eventValue,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-3-1143", eventCardUid: directAttacker.uid, eventCode: 1143, eventName: "battleDamageDealt", eventPlayer: 0, eventReason: duelReason.battle, eventReasonCardUid: directAttacker.uid, eventReasonPlayer: 1, eventValue: 2000, player: 0, sourceUid: pzoneLeadingLady.uid, triggerBucket: "opponentOptional" },
      { effectId: "lua-4-1143", eventCardUid: directAttacker.uid, eventCode: 1143, eventName: "battleDamageDealt", eventPlayer: 0, eventReason: duelReason.battle, eventReasonCardUid: directAttacker.uid, eventReasonPlayer: 1, eventValue: 2000, player: 0, sourceUid: pzoneLeadingLady.uid, triggerBucket: "opponentOptional" },
    ]);
    const pzoneAttackDropTrigger = getLuaRestoreLegalActions(restoredPzoneAttackDrop, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === pzoneLeadingLady.uid && action.effectId === "lua-3-1143"
    );
    expect(pzoneAttackDropTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredPzoneAttackDrop, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPzoneAttackDrop, pzoneAttackDropTrigger!);
    resolveRestoredChain(restoredPzoneAttackDrop);

    expect(currentAttack(restoredPzoneAttackDrop.session.state.cards.find((card) => card.uid === directAttacker.uid), restoredPzoneAttackDrop.session.state)).toBe(0);
    expect(restoredPzoneAttackDrop.session.state.effects.filter((effect) => effect.sourceUid === directAttacker.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", reset: { flags: resetEventStandard }, sourceUid: directAttacker.uid, value: -2000 },
    ]);
    expect(restoredPzoneAttackDrop.session.state.eventHistory.filter((event) => ["battleDamageDealt", "chainSolved"].includes(event.eventName))).toEqual([
      battleDamageEvent(directAttacker.uid, 1, 0, 2000, "deck", "monsterZone"),
      chainSolvedEvent(3, "chain-5"),
    ]);

    const restoredPzoneSearch = createRestoredPzoneDamageWindow({ reader, workspace });
    expectCleanRestore(restoredPzoneSearch);
    expectRestoredLegalActions(restoredPzoneSearch, 1);
    const searchLeadingLady = requireCard(restoredPzoneSearch.session, leadingLadyCode);
    const searchAttacker = requireCard(restoredPzoneSearch.session, attackerCode, 1);
    const extraActor = requireCard(restoredPzoneSearch.session, extraActorCode);
    const extraDecoy = requireCard(restoredPzoneSearch.session, extraDecoyCode);
    const searchDirectAttack = getLuaRestoreLegalActions(restoredPzoneSearch, 1).find(
      (action) => action.type === "declareAttack" && action.attackerUid === searchAttacker.uid && !("targetUid" in action),
    );
    expect(searchDirectAttack, JSON.stringify(getLuaRestoreLegalActions(restoredPzoneSearch, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPzoneSearch, searchDirectAttack!);
    passBattleUntilTrigger(restoredPzoneSearch);
    const toHandTrigger = getLuaRestoreLegalActions(restoredPzoneSearch, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === searchLeadingLady.uid && action.effectId === "lua-4-1143"
    );
    expect(toHandTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredPzoneSearch, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPzoneSearch, toHandTrigger!);
    resolveRestoredChain(restoredPzoneSearch);

    expect(restoredPzoneSearch.session.state.cards.find((card) => card.uid === extraActor.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: searchLeadingLady.uid,
      reasonEffectId: 4,
    });
    expect(restoredPzoneSearch.session.state.cards.find((card) => card.uid === extraDecoy.uid)).toMatchObject({ location: "extraDeck", controller: 0, faceUp: true });
    expect(restoredPzoneSearch.session.state.eventHistory.filter((event) => ["battleDamageDealt", "sentToHand", "confirmed", "sentToHandConfirmed", "chainSolved"].includes(event.eventName))).toEqual([
      battleDamageEvent(searchAttacker.uid, 1, 0, 2000, "deck", "monsterZone"),
      sentToHandEvent(extraActor.uid, searchLeadingLady.uid),
      confirmedEvent(extraActor.uid, searchLeadingLady.uid),
      sentToHandConfirmedEvent(extraActor.uid, searchLeadingLady.uid),
      chainSolvedEvent(4, "chain-5"),
    ]);

    const restoredMonsterAttackDrop = createRestoredMonsterDamageWindow({ reader, workspace });
    expectCleanRestore(restoredMonsterAttackDrop);
    expectRestoredLegalActions(restoredMonsterAttackDrop, 0);
    const monsterLeadingLady = requireCard(restoredMonsterAttackDrop.session, leadingLadyCode);
    const attackTarget = requireCard(restoredMonsterAttackDrop.session, battleTargetCode, 1);
    const statTarget = requireCard(restoredMonsterAttackDrop.session, statTargetCode, 1);
    const attack = getLuaRestoreLegalActions(restoredMonsterAttackDrop, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === monsterLeadingLady.uid && action.targetUid === attackTarget.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredMonsterAttackDrop, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredMonsterAttackDrop, attack!);
    passBattleUntilTrigger(restoredMonsterAttackDrop);
    expect(restoredMonsterAttackDrop.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventPlayer: trigger.eventPlayer,
      eventReason: trigger.eventReason,
      eventReasonCardUid: trigger.eventReasonCardUid,
      eventReasonPlayer: trigger.eventReasonPlayer,
      eventValue: trigger.eventValue,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-5-1143", eventCardUid: monsterLeadingLady.uid, eventCode: 1143, eventName: "battleDamageDealt", eventPlayer: 1, eventReason: duelReason.battle, eventReasonCardUid: monsterLeadingLady.uid, eventReasonPlayer: 0, eventValue: 500, player: 0, sourceUid: monsterLeadingLady.uid, triggerBucket: "turnOptional" },
    ]);
    const monsterAttackDropTrigger = getLuaRestoreLegalActions(restoredMonsterAttackDrop, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === monsterLeadingLady.uid && action.effectId === "lua-5-1143"
    );
    expect(monsterAttackDropTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredMonsterAttackDrop, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredMonsterAttackDrop, monsterAttackDropTrigger!);
    resolveRestoredChain(restoredMonsterAttackDrop);

    expect(currentAttack(restoredMonsterAttackDrop.session.state.cards.find((card) => card.uid === statTarget.uid), restoredMonsterAttackDrop.session.state)).toBe(1100);
    expect(restoredMonsterAttackDrop.session.state.effects.filter((effect) => effect.sourceUid === statTarget.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, event: "continuous", reset: { flags: resetEventStandard }, sourceUid: statTarget.uid, value: -500 },
    ]);
    expect(restoredMonsterAttackDrop.session.state.eventHistory.filter((event) => ["battleDamageDealt", "becameTarget", "chainSolved"].includes(event.eventName))).toEqual([
      battleDamageEvent(monsterLeadingLady.uid, 0, 1, 500, "deck", "monsterZone"),
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventValue: 1,
        eventCardUid: statTarget.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        relatedEffectId: 5,
        eventChainDepth: 1,
        eventChainLinkId: "chain-6",
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
      chainSolvedEvent(5, "chain-6"),
    ]);

    const restoredDestroyedSet = createRestoredDestroyedWindow({ reader, workspace });
    expectCleanRestore(restoredDestroyedSet);
    expectRestoredLegalActions(restoredDestroyedSet, 0);
    const destroyedLeadingLady = requireCardWhere(restoredDestroyedSet.session, leadingLadyCode, (card) => card.previousLocation === "monsterZone");
    const abyssScript = requireCard(restoredDestroyedSet.session, abyssScriptCode);
    expect(restoredDestroyedSet.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-6-1029",
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: destroyedLeadingLady.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventPlayer: 0,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: destroyedLeadingLady.uid,
        triggerBucket: "turnOptional",
      },
    ]);
    const setTrigger = getLuaRestoreLegalActions(restoredDestroyedSet, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === destroyedLeadingLady.uid && action.effectId === "lua-6-1029"
    );
    expect(setTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDestroyedSet, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroyedSet, setTrigger!);
    resolveRestoredChain(restoredDestroyedSet);

    expect(restoredDestroyedSet.session.state.cards.find((card) => card.uid === abyssScript.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: false,
      position: "faceDown",
    });
    expect(restoredDestroyedSet.session.state.eventHistory.filter((event) => ["destroyed", "spellTrapSet", "chainSolved"].includes(event.eventName))).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: destroyedLeadingLady.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "spellTrapSet",
        eventCode: 1107,
        eventCardUid: abyssScript.uid,
        eventReason: duelReason.rule,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: false, location: "spellTrapZone", position: "faceDown", sequence: 0 },
      },
      chainSolvedEvent(6, "chain-3"),
    ]);
    expect(restoredDestroyedSet.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredPzoneDamageWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 24907044, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [leadingLadyCode], extra: [extraActorCode, extraDecoyCode] }, 1: { main: [attackerCode] } });
  startDuel(session);
  movePzone(session, requireCard(session, leadingLadyCode), 0);
  moveFaceUpAttack(session, requireCard(session, attackerCode, 1), 1, 0);
  moveDuelCard(session.state, requireCard(session, extraActorCode).uid, "extraDeck", 0).faceUp = true;
  moveDuelCard(session.state, requireCard(session, extraDecoyCode).uid, "extraDeck", 0).faceUp = true;
  session.state.phase = "battle";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  registerLeadingLady(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredMonsterDamageWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 24907045, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [leadingLadyCode] }, 1: { main: [battleTargetCode, statTargetCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, leadingLadyCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, battleTargetCode, 1), 1, 0);
  moveFaceUpAttack(session, requireCard(session, statTargetCode, 1), 1, 1);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerLeadingLady(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredDestroyedWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 24907046, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [leadingLadyCode, abyssScriptCode] }, 1: { main: [] } });
  startDuel(session);
  const leadingLady = requireCard(session, leadingLadyCode);
  moveFaceUpAttack(session, leadingLady, 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerLeadingLady(session, workspace);
  destroyDuelCard(session.state, leadingLady.uid, 0, duelReason.effect | duelReason.destroy, 1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function fixtureCards(): DuelCardData[] {
  return [
    { code: attackerCode, name: "Leading Lady Direct Attacker", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 2000, defense: 1000 },
    { code: extraActorCode, name: "Leading Lady Extra Abyss Actor", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, setcodes: [setAbyssActor], race: raceFiend, attribute: attributeDark, level: 4, attack: 1200, defense: 1000 },
    { code: extraDecoyCode, name: "Leading Lady Extra Decoy", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceFiend, attribute: attributeDark, level: 4, attack: 1200, defense: 1000 },
    { code: battleTargetCode, name: "Leading Lady Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: abyssScriptCode, name: "Leading Lady Abyss Script", kind: "spell", typeFlags: typeSpell, setcodes: [setAbyssScript] },
    { code: statTargetCode, name: "Leading Lady Stat Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1600, defense: 1000 },
  ];
}

function registerLeadingLady(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(leadingLadyCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function movePzone(session: DuelSession, card: DuelCardInstance, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.sequence = sequence;
  moved.faceUp = true;
  return moved;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function requireCard(session: DuelSession, code: string, owner = 0): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && candidate.owner === owner);
  expect(card).toBeDefined();
  return card!;
}

function requireCardWhere(session: DuelSession, code: string, predicate: (card: DuelCardInstance) => boolean): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code && predicate(candidate));
  expect(card).toBeDefined();
  return card!;
}

function battleDamageEvent(cardUid: string, reasonPlayer: PlayerId, damagedPlayer: PlayerId, value: number, previousLocation: string, currentLocation: string) {
  return {
    eventName: "battleDamageDealt",
    eventCode: 1143,
    eventCardUid: cardUid,
    eventPlayer: damagedPlayer,
    eventValue: value,
    eventReason: duelReason.battle,
    eventReasonCardUid: cardUid,
    eventReasonPlayer: reasonPlayer,
    eventPreviousState: { controller: reasonPlayer, faceUp: false, location: previousLocation, position: "faceDown", sequence: 0 },
    eventCurrentState: { controller: reasonPlayer, faceUp: true, location: currentLocation, position: "faceUpAttack", sequence: 0 },
  };
}

function sentToHandEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "sentToHand",
    eventCode: 1012,
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 4,
    eventPreviousState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
  };
}

function confirmedEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "confirmed",
    eventCode: 1211,
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 4,
    eventPreviousState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
  };
}

function sentToHandConfirmedEvent(cardUid: string, sourceUid: string) {
  return {
    eventName: "sentToHandConfirmed",
    eventCode: 1212,
    eventPlayer: 1,
    eventValue: 1,
    eventUids: [cardUid],
    eventCardUid: cardUid,
    eventReason: duelReason.effect,
    eventReasonPlayer: 0,
    eventReasonCardUid: sourceUid,
    eventReasonEffectId: 4,
    eventPreviousState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
    eventCurrentState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
  };
}

function chainSolvedEvent(effectId: number, chainId: string) {
  return {
    eventName: "chainSolved",
    eventCode: 1022,
    eventPlayer: 0,
    eventValue: 1,
    eventReasonPlayer: 0,
    relatedEffectId: effectId,
    eventChainDepth: 1,
    eventChainLinkId: chainId,
  };
}

function expectLeadingLadyScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Abyss Actor - Leading Lady");
  expect(script).toContain("Pendulum.AddProcedure(c)");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetCode(EVENT_BATTLE_DAMAGE)");
  expect(script).toContain("e1:SetRange(LOCATION_PZONE)");
  expect(script).toContain("local a=Duel.GetAttacker()");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(-ev)");
  expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_ABYSS_ACTOR) and c:IsType(TYPE_PENDULUM) and c:IsAttackBelow(atk) and c:IsAbleToHand()");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_EXTRA,0,1,1,nil,ev)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
  expect(script).toContain("e3:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.GetFirstTarget()");
  expect(script).toContain("e4:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("c:IsPreviousLocation(LOCATION_MZONE)");
  expect(script).toContain("return c:IsSetCard(SET_ABYSS_SCRIPT) and c:IsSpell() and c:IsSSetable()");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.SSet(tp,g)");
}

function passBattleUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
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

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0 || restored.session.state.pendingTriggers.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain" || action.type === "declineTrigger");
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
