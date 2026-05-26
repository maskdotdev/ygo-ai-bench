import fs from "node:fs";
import path from "node:path";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import { describe, expect, it } from "vitest";

const upstreamRoot = path.resolve(".upstream/ignis");
const tokenSupportCode = "53545926";
const allianceTokenCode = "53545927";
const attackTargetCode = "535459260";
const costTokenACode = "535459261";
const costTokenBCode = "535459262";
const opponentCode = "535459263";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasTokenSupportScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${tokenSupportCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeNormal = 0x10;
const typeEffect = 0x20;
const typeToken = 0x4000;
const typeContinuous = 0x20000;
const raceWarrior = 0x1;
const raceBeast = 0x4000;
const attributeEarth = 0x1;
const effectUpdateAttack = 100;
const effectExtraAttackMonster = 346;

describe.skipIf(!hasUpstreamScripts || !hasTokenSupportScript)("Lua real script Token Support release token attack summon stat", () => {
  it("restores Token release ATK boost, extra monster attacks, destroyed-Token count, and battle-end Token summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectTokenSupportScriptShape(workspace.readScript(`official/c${tokenSupportCode}.lua`));
    const reader = createCardReader(cards());

    const restoredIgnition = createRestoredIgnition({ reader, workspace });
    expectCleanRestore(restoredIgnition);
    expectRestoredLegalActions(restoredIgnition, 0);
    const ignitionSupport = requireCard(restoredIgnition.session, tokenSupportCode);
    const target = requireCard(restoredIgnition.session, attackTargetCode);
    const costTokenA = requireCard(restoredIgnition.session, costTokenACode);
    const costTokenB = requireCard(restoredIgnition.session, costTokenBCode);
    expect(restoredIgnition.session.state.effects.filter((effect) => effect.sourceUid === ignitionSupport.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 1002, countLimit: undefined, event: "ignition", id: "lua-1-1002", property: undefined, range: ["hand", "spellTrapZone"], triggerEvent: undefined },
      { category: 0x200000, code: undefined, countLimit: 1, event: "ignition", id: "lua-2", property: 0x10, range: ["spellTrapZone"], triggerEvent: undefined },
      { category: 0x200, code: 4224, countLimit: 1, event: "trigger", id: "lua-3-4224", property: undefined, range: ["spellTrapZone"], triggerEvent: "phaseBattle" },
      { category: undefined, code: 1029, countLimit: undefined, event: "continuous", id: "lua-4-1029", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: undefined },
    ]);
    const boost = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) => action.type === "activateEffect" && action.uid === ignitionSupport.uid && action.effectId === "lua-2");
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredIgnition, boost!);
    resolveRestoredChain(restoredIgnition);
    for (const token of [costTokenA, costTokenB]) {
      expect(restoredIgnition.session.state.cards.find((card) => card.uid === token.uid)).toMatchObject({
        location: "graveyard",
        controller: 0,
        reason: duelReason.cost | duelReason.release,
        reasonPlayer: 0,
        reasonCardUid: ignitionSupport.uid,
        reasonEffectId: 2,
      });
    }
    expect(currentAttack(restoredIgnition.session.state.cards.find((card) => card.uid === target.uid), restoredIgnition.session.state)).toBe(2000);
    expect(restoredIgnition.session.state.effects.filter((effect) => effect.sourceUid === target.uid && [effectUpdateAttack, effectExtraAttackMonster].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: 0x4000400, reset: { flags: 1107169792 }, sourceUid: target.uid, value: 2000 },
      { code: effectExtraAttackMonster, property: 0x4000400, reset: { flags: 1107169792 }, sourceUid: target.uid, value: 1 },
    ]);
    expect(restoredIgnition.session.state.eventHistory.filter((event) => ["released", "sentToGraveyard", "becameTarget"].includes(event.eventName)).map((event) => ({
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
      { eventName: "released", eventCode: 1017, eventCardUid: costTokenA.uid, eventUids: undefined, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: ignitionSupport.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: costTokenA.uid, eventUids: undefined, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: ignitionSupport.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "released", eventCode: 1017, eventCardUid: costTokenB.uid, eventUids: undefined, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: ignitionSupport.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: costTokenB.uid, eventUids: undefined, eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: ignitionSupport.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "released", eventCode: 1017, eventCardUid: costTokenA.uid, eventUids: [costTokenA.uid, costTokenB.uid], eventReason: duelReason.cost | duelReason.release, eventReasonPlayer: 0, eventReasonCardUid: ignitionSupport.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: target.uid, eventUids: undefined, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 2, previous: "deck", current: "monsterZone" },
    ]);

    const restoredBattleEnd = createRestoredBattleEnd({ reader, workspace });
    expectCleanRestore(restoredBattleEnd);
    expectRestoredLegalActions(restoredBattleEnd, 1);
    const battleSupport = requireCard(restoredBattleEnd.session, tokenSupportCode);
    expect(restoredBattleEnd.session.state.flagEffects.filter((flag) => flag.code === Number(tokenSupportCode)).map((flag) => ({
      code: flag.code,
      ownerId: flag.ownerId,
      ownerType: flag.ownerType,
      reset: flag.reset,
      resetCount: flag.resetCount,
      turn: flag.turn,
      value: flag.value,
    }))).toEqual([
      { code: Number(tokenSupportCode), ownerId: "0", ownerType: "player", reset: 0x40000080, resetCount: 1, turn: 1, value: 0 },
      { code: Number(tokenSupportCode), ownerId: "0", ownerType: "player", reset: 0x40000080, resetCount: 1, turn: 1, value: 0 },
    ]);
    const main2 = getLuaRestoreLegalActions(restoredBattleEnd, 1).find((action) => action.type === "changePhase" && action.phase === "main2");
    expect(main2, JSON.stringify(getLuaRestoreLegalActions(restoredBattleEnd, 1), null, 2)).toBeDefined();
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
      { effectId: "lua-3-4224", eventCode: 0x1080, eventName: "phaseBattle", eventTriggerTiming: "when", player: 0, sourceUid: battleSupport.uid, triggerBucket: "opponentOptional" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattleEnd.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const tokenSummon = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === battleSupport.uid && action.effectId === "lua-3-4224");
    expect(tokenSummon, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, tokenSummon!);
    resolveRestoredChain(restoredTrigger);
    expect(restoredTrigger.host.promptDecisions.flatMap((prompt) => prompt.api === "AnnounceNumberRange" ? [{
      api: prompt.api,
      options: prompt.options,
      player: prompt.player,
      returned: prompt.returned,
    }] : [])).toEqual([{ api: "AnnounceNumberRange", options: [1, 2], player: 0, returned: 1 }]);
    const summonedToken = restoredTrigger.session.state.cards.find((card) => card.code === allianceTokenCode && card.location === "monsterZone" && card.controller === 0);
    expect(summonedToken).toMatchObject({
      location: "monsterZone",
      controller: 0,
      owner: 0,
      faceUp: true,
      position: "faceUpAttack",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: battleSupport.uid,
      reasonEffectId: 3,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["destroyed", "sentToGraveyard", "phaseBattle", "specialSummoned"].includes(event.eventName)).map((event) => ({
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
      { eventName: "destroyed", eventCode: 1029, eventCardUid: costTokenA.uid, eventReason: duelReason.battle | duelReason.destroy, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: costTokenA.uid, eventReason: duelReason.battle | duelReason.destroy, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: costTokenB.uid, eventReason: duelReason.battle | duelReason.destroy, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: costTokenB.uid, eventReason: duelReason.battle | duelReason.destroy, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "phaseBattle", eventCode: 0x1080, eventCardUid: undefined, eventReason: undefined, eventReasonPlayer: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: undefined, current: undefined },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: summonedToken!.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: battleSupport.uid, eventReasonEffectId: 3, previous: "hand", current: "monsterZone" },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredIgnition({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createTokenSupportBase({ seed: 53545926, reader, workspace });
  moveFaceUpAttack(session, requireCard(session, attackTargetCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, costTokenACode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, costTokenBCode), 0, 2);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredBattleEnd({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createTokenSupportBase({ seed: 53545927, reader, workspace });
  moveFaceUpAttack(session, requireCard(session, costTokenACode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, costTokenBCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, opponentCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  destroyDuelCard(session.state, requireCard(session, costTokenACode).uid, 0, duelReason.battle | duelReason.destroy, 1);
  destroyDuelCard(session.state, requireCard(session, costTokenBCode).uid, 0, duelReason.battle | duelReason.destroy, 1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createTokenSupportBase({
  seed,
  reader,
  workspace,
}: {
  seed: number;
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): DuelSession {
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [tokenSupportCode, attackTargetCode, costTokenACode, costTokenBCode] }, 1: { main: [opponentCode] } });
  startDuel(session);
  const support = moveDuelCard(session.state, requireCard(session, tokenSupportCode).uid, "spellTrapZone", 0);
  support.sequence = 0;
  support.faceUp = true;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(tokenSupportCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return session;
}

function expectTokenSupportScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("local TOKEN_ALLIANCE=id+1");
  expect(script).toContain("e0:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e1:SetRange(LOCATION_SZONE)");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.atkcostfilter,1,false,s.spcheck,nil,tp)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.atkcostfilter,1,99,false,s.spcheck,nil,tp)");
  expect(script).toContain("Duel.Release(g,REASON_COST)");
  expect(script).toContain("Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsAttack,0),tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(ct*1000)");
  expect(script).toContain("e2:SetCode(EFFECT_EXTRA_ATTACK_MONSTER)");
  expect(script).toContain("e2:SetValue(ct-1)");
  expect(script).toContain("e2:SetCode(EVENT_PHASE|PHASE_BATTLE)");
  expect(script).toContain("Duel.HasFlagEffect(0,id)");
  expect(script).toContain("Duel.RegisterFlagEffect(0,id,RESET_PHASE|PHASE_BATTLE,0,1)");
  expect(script).toContain("Duel.AnnounceNumberRange(tp,1,math.min(ft,Duel.GetFlagEffect(0,id)))");
  expect(script).toContain("Duel.CreateToken(tp,TOKEN_ALLIANCE)");
  expect(script).toContain("Duel.SpecialSummonStep(token,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("Duel.SpecialSummonComplete()");
}

function cards(): DuelCardData[] {
  return [
    { code: tokenSupportCode, name: "Token Support", kind: "spell", typeFlags: typeSpell | typeContinuous },
    { code: allianceTokenCode, name: "Support Token", kind: "monster", typeFlags: typeMonster | typeNormal | typeToken, race: raceBeast, attribute: attributeEarth, level: 1, attack: 0, defense: 0 },
    { code: attackTargetCode, name: "Token Support ATK Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 0, defense: 1000 },
    { code: costTokenACode, name: "Token Support Cost Token A", kind: "monster", typeFlags: typeMonster | typeNormal | typeToken, race: raceBeast, attribute: attributeEarth, level: 1, attack: 0, defense: 0 },
    { code: costTokenBCode, name: "Token Support Cost Token B", kind: "monster", typeFlags: typeMonster | typeNormal | typeToken, race: raceBeast, attribute: attributeEarth, level: 1, attack: 0, defense: 0 },
    { code: opponentCode, name: "Token Support Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1500, defense: 1000 },
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
