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
const furyCode = "65898344";
const ownFishCode = "658983440";
const opponentMonsterCode = "658983441";
const summonedFishCode = "658983442";
const secondFishCode = "658983443";
const banishedACode = "658983444";
const banishedBCode = "658983445";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasFuryScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${furyCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceFish = 0x20000;
const raceWarrior = 0x1;
const attributeWater = 0x2;
const attributeDark = 0x20;
const effectUpdateAttack = 100;
const standbyPhaseCode = 0x1002;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasFuryScript)("Lua real script Ghoti Fury temporary banish fish summon stat", () => {
  it("restores SelectUnselectGroup temporary banish return and Fish summon ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${furyCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredBanish = createRestoredFuryBanishField({ reader, workspace });
    expectCleanRestore(restoredBanish);
    expectRestoredLegalActions(restoredBanish, 0);
    const fury = requireCard(restoredBanish.session, furyCode);
    const ownFish = requireCard(restoredBanish.session, ownFishCode);
    const opponentMonster = requireCard(restoredBanish.session, opponentMonsterCode);
    const banish = getLuaRestoreLegalActions(restoredBanish, 0).find((action) => action.type === "activateEffect" && action.uid === fury.uid && action.effectId === "lua-2-1002");
    expect(banish, JSON.stringify(getLuaRestoreLegalActions(restoredBanish, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBanish, banish!);
    resolveRestoredChain(restoredBanish);

    for (const target of [ownFish, opponentMonster]) {
      expect(restoredBanish.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
        location: "banished",
        faceUp: true,
        reason: duelReason.effect,
        reasonPlayer: 0,
        reasonCardUid: fury.uid,
        reasonEffectId: 2,
      });
    }
    expect(restoredBanish.session.state.effects.filter((effect) => effect.sourceUid === fury.uid && effect.code === standbyPhaseCode).map((effect) => ({
      code: effect.code,
      labelObjectUids: effect.labelObjectUids,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: standbyPhaseCode, labelObjectUids: [ownFish.uid, opponentMonster.uid], reset: { flags: 1342177282, count: 1 }, sourceUid: fury.uid },
    ]);
    expect(restoredBanish.session.state.eventHistory.filter((event) => ["becameTarget", "banished"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventUids: event.eventUids,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: ownFish.uid, eventUids: undefined, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 2, previous: "deck", current: "monsterZone" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: opponentMonster.uid, eventUids: undefined, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 2, previous: "deck", current: "monsterZone" },
      { eventName: "banished", eventCode: 1011, eventCardUid: ownFish.uid, eventUids: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: fury.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "monsterZone", current: "banished" },
      { eventName: "banished", eventCode: 1011, eventCardUid: opponentMonster.uid, eventUids: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: fury.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "monsterZone", current: "banished" },
      { eventName: "banished", eventCode: 1011, eventCardUid: ownFish.uid, eventUids: [ownFish.uid, opponentMonster.uid], eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: fury.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "monsterZone", current: "banished" },
    ]);

    const restoredReturn = restoreDuelWithLuaScripts(serializeDuel(restoredBanish.session), workspace, reader);
    expectCleanRestore(restoredReturn);
    restoredReturn.session.state.turnPlayer = 0;
    restoredReturn.session.state.phase = "draw";
    restoredReturn.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredReturn, 0);
    const standby = getLuaRestoreLegalActions(restoredReturn, 0).find((action) => action.type === "changePhase" && action.phase === "standby");
    expect(standby, JSON.stringify(getLuaRestoreLegalActions(restoredReturn, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredReturn, standby!);
    for (const target of [ownFish, opponentMonster]) {
      expect(restoredReturn.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
        location: "monsterZone",
        faceUp: true,
        reason: duelReason.effect,
        reasonPlayer: 0,
        reasonCardUid: fury.uid,
        reasonEffectId: 4,
      });
    }

    const restoredSummonOpen = createRestoredFurySummonStatField({ reader, workspace });
    expectCleanRestore(restoredSummonOpen);
    expectRestoredLegalActions(restoredSummonOpen, 0);
    const statFury = requireCard(restoredSummonOpen.session, furyCode);
    const summonedFish = requireCard(restoredSummonOpen.session, summonedFishCode);
    const secondFish = requireCard(restoredSummonOpen.session, secondFishCode);
    const banishedA = requireCard(restoredSummonOpen.session, banishedACode);
    const banishedB = requireCard(restoredSummonOpen.session, banishedBCode);
    specialSummonDuelCard(restoredSummonOpen.session.state, summonedFish.uid, 0);

    const restoredStatTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummonOpen.session), workspace, reader);
    expectCleanRestore(restoredStatTrigger);
    expectRestoredLegalActions(restoredStatTrigger, 0);
    expect(restoredStatTrigger.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-3-1102", eventCardUid: summonedFish.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, player: 0, sourceUid: statFury.uid, triggerBucket: "turnOptional" },
    ]);
    const boost = getLuaRestoreLegalActions(restoredStatTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === statFury.uid && action.effectId === "lua-3-1102");
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredStatTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStatTrigger, boost!);
    resolveRestoredChain(restoredStatTrigger);

    expect(restoredStatTrigger.session.state.cards.find((card) => card.uid === statFury.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: statFury.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(restoredStatTrigger.session.state.cards.find((card) => card.uid === summonedFish.uid), restoredStatTrigger.session.state)).toBe(1500);
    expect(currentAttack(restoredStatTrigger.session.state.cards.find((card) => card.uid === secondFish.uid), restoredStatTrigger.session.state)).toBe(1900);
    expect(restoredStatTrigger.session.state.effects.filter((effect) => effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: summonedFish.uid, value: 300 },
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: secondFish.uid, value: 300 },
    ]);
    expect(restoredStatTrigger.session.state.eventHistory.filter((event) => ["specialSummoned", "banished"].includes(event.eventName)).map((event) => ({
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
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: summonedFish.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "hand", current: "monsterZone" },
      { eventName: "banished", eventCode: 1011, eventCardUid: statFury.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: statFury.uid, eventReasonEffectId: 3, previous: "spellTrapZone", current: "banished" },
    ]);
    expect(restoredStatTrigger.session.state.cards.find((card) => card.uid === banishedA.uid)).toMatchObject({ location: "banished", faceUp: true });
    expect(restoredStatTrigger.session.state.cards.find((card) => card.uid === banishedB.uid)).toMatchObject({ location: "banished", faceUp: true });
    expect(restoredStatTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredFuryBanishField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 65898344, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [furyCode, ownFishCode] }, 1: { main: [opponentMonsterCode] } });
  startDuel(session);
  moveFaceUpSpellTrap(session, requireCard(session, furyCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, ownFishCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, opponentMonsterCode), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  registerFury(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredFurySummonStatField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 65898345, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [furyCode, summonedFishCode, secondFishCode, banishedACode] }, 1: { main: [banishedBCode] } });
  startDuel(session);
  moveFaceUpSpellTrap(session, requireCard(session, furyCode), 0, 0);
  moveDuelCard(session.state, requireCard(session, summonedFishCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, secondFishCode), 0, 1);
  moveDuelCard(session.state, requireCard(session, banishedACode).uid, "banished", 0, duelReason.effect, 0).faceUp = true;
  moveDuelCard(session.state, requireCard(session, banishedBCode).uid, "banished", 1, duelReason.effect, 1).faceUp = true;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;

  registerFury(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function registerFury(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(furyCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Ghoti Fury");
  expect(script).toContain("e2:SetCategory(CATEGORY_REMOVE)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("return sg:FilterCount(Card.IsControler,nil,tp)==1");
  expect(script).toContain("aux.SelectUnselectGroup(g,e,tp,2,2,s.rmrescon,0)");
  expect(script).toContain("aux.SelectUnselectGroup(g,e,tp,2,2,s.rmrescon,1,tp,HINTMSG_REMOVE)");
  expect(script).toContain("aux.RemoveUntil(tg,nil,REASON_EFFECT,PHASE_STANDBY,id,e,tp");
  expect(script).toContain("aux.DefaultFieldReturnOp");
  expect(script).toContain("e3:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e3:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return eg:IsExists(s.atkfilter,1,nil,tp) and Duel.GetFieldGroupCount(0,LOCATION_REMOVED,LOCATION_REMOVED)>0");
  expect(script).toContain("Duel.Remove(c,POS_FACEUP,REASON_COST)");
  expect(script).toContain("local atk=ct*100");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const fury = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === furyCode);
  expect(fury).toBeDefined();
  return [
    fury!,
    { code: ownFishCode, name: "Ghoti Fury Own Fish Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFish, attribute: attributeWater, level: 4, attack: 1600, defense: 1000 },
    { code: opponentMonsterCode, name: "Ghoti Fury Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1800, defense: 1000 },
    { code: summonedFishCode, name: "Ghoti Fury Summoned Fish", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFish, attribute: attributeWater, level: 4, attack: 1200, defense: 1000 },
    { code: secondFishCode, name: "Ghoti Fury Second Fish", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFish, attribute: attributeWater, level: 4, attack: 1600, defense: 1000 },
    { code: banishedACode, name: "Ghoti Fury Banished A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: banishedBCode, name: "Ghoti Fury Banished B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
  ];
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function moveFaceUpSpellTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
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
