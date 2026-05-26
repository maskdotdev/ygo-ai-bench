import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const blazeCode = "4059313";
const raCode = "10000010";
const tributeCode = "40593130";
const defenderCode = "40593131";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasBlazeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${blazeCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSpell = 0x2;
const typeQuickPlay = 0x10000;
const raceDivineBeast = 0x2000000;
const raceWarrior = 0x1;
const attributeDivine = 0x40;
const attributeEarth = 0x1;
const effectImmuneEffect = 1;
const effectUpdateAttack = 100;
const eventAttackAnnounce = 1130;
const eventBattled = 1138;

describe.skipIf(!hasUpstreamScripts || !hasBlazeScript)("Lua real script Blaze Cannon Ra grant attack send stat", () => {
  it("restores Ra effect grants into attack-announce tribute ATK gain and battled send-all", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectBlazeScriptShape(workspace.readScript(`official/c${blazeCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 4059313, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [blazeCode, raCode, tributeCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const blaze = requireCard(session, blazeCode);
    const ra = requireCard(session, raCode);
    const tribute = requireCard(session, tributeCode);
    const defender = requireCard(session, defenderCode);
    moveDuelCard(session.state, blaze.uid, "hand", 0);
    moveFaceUpAttack(session, ra, 0, 0);
    moveFaceUpAttack(session, tribute, 0, 1);
    moveFaceUpAttack(session, defender, 1, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(blazeCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === blaze.uid);
    expect(activate, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, activate!);
    resolveChain(session);

    expect(session.state.cards.find((card) => card.uid === blaze.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(session.state.effects.filter((effect) => effect.sourceUid === ra.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: effectImmuneEffect, event: "continuous", id: "lua-2-1", property: 0x4020000, range: ["monsterZone"], reset: { flags: 1107169792 }, triggerEvent: undefined },
      { category: 0x200000, code: eventAttackAnnounce, event: "trigger", id: "lua-3-1130", property: undefined, range: ["monsterZone"], reset: { flags: 1107169792 }, triggerEvent: "attackDeclared" },
      { category: 0x20, code: eventBattled, event: "trigger", id: "lua-4-1138", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], reset: { flags: 1107169792 }, triggerEvent: "afterDamageCalculation" },
    ]);

    const restoredAttack = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredAttack);
    expectRestoredLegalActions(restoredAttack, 0);
    const attack = getLuaRestoreLegalActions(restoredAttack, 0).find((action) => action.type === "declareAttack" && action.attackerUid === ra.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredAttack, 0), null, 2)).toBeDefined();
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
      { effectId: "lua-3-1130", eventCardUid: ra.uid, eventCode: eventAttackAnnounce, eventName: "attackDeclared", eventReason: 0, eventReasonPlayer: 0, player: 0, sourceUid: ra.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredAttackTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredAttack.session), workspace, reader);
    expectCleanRestore(restoredAttackTrigger);
    expectRestoredLegalActions(restoredAttackTrigger, 0);
    const tributeBoost = getLuaRestoreLegalActions(restoredAttackTrigger, 0).find((action) => action.type === "activateTrigger" && action.effectId === "lua-3-1130");
    expect(tributeBoost, JSON.stringify(getLuaRestoreLegalActions(restoredAttackTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttackTrigger, tributeBoost!);
    resolveRestoredChain(restoredAttackTrigger);
    expect(restoredAttackTrigger.session.state.cards.find((card) => card.uid === tribute.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.release | duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: ra.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(restoredAttackTrigger.session.state.cards.find((card) => card.uid === ra.uid), restoredAttackTrigger.session.state)).toBe(5500);
    expect(restoredAttackTrigger.session.state.effects.filter((effect) => effect.sourceUid === ra.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([{ code: effectUpdateAttack, reset: { flags: 1107235328 }, sourceUid: ra.uid, value: 1500 }]);
    expect(restoredAttackTrigger.session.state.eventHistory.filter((event) => event.eventCardUid !== blaze.uid && ["attackDeclared", "released", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventName: "attackDeclared", eventCode: eventAttackAnnounce, eventCardUid: ra.uid, eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventName: "released", eventCode: 1017, eventCardUid: tribute.uid, eventReason: duelReason.release | duelReason.cost, eventReasonCardUid: ra.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: tribute.uid, eventReason: duelReason.release | duelReason.cost, eventReasonCardUid: ra.uid, eventReasonEffectId: 3, eventReasonPlayer: 0 },
    ]);

    passBattleResponses(restoredAttackTrigger);
    expect(restoredAttackTrigger.session.state.pendingTriggers.map((trigger) => ({
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
      { effectId: "lua-4-1138", eventCardUid: ra.uid, eventCode: eventBattled, eventName: "afterDamageCalculation", eventReason: 0, eventReasonPlayer: 0, player: 0, sourceUid: ra.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredBattledTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredAttackTrigger.session), workspace, reader);
    expectCleanRestore(restoredBattledTrigger);
    expectRestoredLegalActions(restoredBattledTrigger, 0);
    const sendAll = getLuaRestoreLegalActions(restoredBattledTrigger, 0).find((action) => action.type === "activateTrigger" && action.effectId === "lua-4-1138");
    expect(sendAll, JSON.stringify(getLuaRestoreLegalActions(restoredBattledTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattledTrigger, sendAll!);
    resolveRestoredChain(restoredBattledTrigger);
    expect(restoredBattledTrigger.session.state.cards.find((card) => card.uid === defender.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: ra.uid,
      reasonEffectId: 4,
    });
    expect(restoredBattledTrigger.session.state.eventHistory.filter((event) => event.eventCardUid === defender.uid && event.eventName === "sentToGraveyard").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: defender.uid, eventReason: duelReason.effect, eventReasonCardUid: ra.uid, eventReasonEffectId: 4, eventReasonPlayer: 0 },
    ]);
    expect(restoredBattledTrigger.session.state.battleDamage).toEqual({ 0: 500, 1: 0 });
  });
});

function expectBlazeScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Blaze Cannon");
  expect(script).toContain("s.listed_names={CARD_RA}");
  expect(script).toContain("Duel.IsExistingMatchingCard(s.selfilter,tp,LOCATION_MZONE,0,1,nil)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.selfilter,tp,LOCATION_MZONE,0,1,1,nil):GetFirst()");
  expect(script).toContain("tc:RegisterFlagEffect(id,RESETS_STANDARD_PHASE_END,EFFECT_FLAG_CLIENT_HINT,1,0,aux.Stringid(id,0))");
  expect(script).toContain("e1:SetCode(EFFECT_IMMUNE_EFFECT)");
  expect(script).toContain("e2:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.atkfilter,1,false,nil,e:GetHandler(),tp)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.atkfilter,1,99,false,nil,e:GetHandler(),tp)");
  expect(script).toContain("Duel.Release(g,REASON_COST)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e3:SetCode(EVENT_BATTLED)");
  expect(script).toContain("Duel.GetMatchingGroup(nil,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("Duel.SendtoGrave(g,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: blazeCode, name: "Blaze Cannon", kind: "spell", typeFlags: typeSpell | typeQuickPlay },
    { code: raCode, name: "The Winged Dragon of Ra", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDivineBeast, attribute: attributeDivine, level: 10, attack: 4000, defense: 4000 },
    { code: tributeCode, name: "Blaze Cannon Tribute", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1500, defense: 1000 },
    { code: defenderCode, name: "Blaze Cannon Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 8, attack: 6000, defense: 3000 },
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

function resolveChain(session: DuelSession): void {
  let guard = 0;
  while (session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const pass = getLegalActions(session, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
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

function passBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain" || action.type === "passAttack" || action.type === "passDamage");
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

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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
