import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const staffCode = "64753157";
const superAgentCode = "41091257";
const recoveryAgentCode = "647531570";
const opponentCode = "647531571";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasStaffScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${staffCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const raceFairy = 0x4;
const attributeEarth = 0x1;
const attributeLight = 0x10;
const eventAttackAnnounce = 1130;
const eventDestroyed = 1029;
const eventToGrave = 1014;
const eventBattleDestroyed = 1140;
const effectSetAttackFinal = 102;

describe.skipIf(!hasUpstreamScripts || !hasStaffScript)("Lua real script Charming Resort Staff Super Agent stat", () => {
  it("restores Super Agent attack ATK zero, destroyed Deck summon, and GY self-banish recovery", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectStaffScriptShape(workspace.readScript(`official/c${staffCode}.lua`));
    const reader = createCardReader(cards());

    const restoredAttack = createRestoredAttack({ reader, workspace });
    expectCleanRestore(restoredAttack);
    expectRestoredLegalActions(restoredAttack, 0);
    const attackStaff = requireCard(restoredAttack.session, staffCode);
    const attackAgent = requireCard(restoredAttack.session, superAgentCode);
    const opponent = requireCard(restoredAttack.session, opponentCode);
    expect(restoredAttack.session.state.effects.filter((effect) => effect.sourceUid === attackStaff.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: 0x200000, code: eventAttackAnnounce, event: "trigger", id: "lua-1-1130", property: undefined, range: ["monsterZone"], triggerEvent: "attackDeclared" },
      { category: 0x200, code: eventDestroyed, event: "trigger", id: "lua-2-1029", property: 0x10000, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "destroyed" },
      { category: 0x8, code: eventBattleDestroyed, event: "trigger", id: "lua-3-1140", property: 0x10000, range: ["graveyard"], triggerEvent: "battleDestroyed" },
      { category: 0x8, code: eventToGrave, event: "trigger", id: "lua-4-1014", property: 0x10000, range: ["graveyard"], triggerEvent: "sentToGraveyard" },
    ]);
    const attack = getLuaRestoreLegalActions(restoredAttack, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === attackAgent.uid && action.targetUid === opponent.uid,
    );
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
      { effectId: "lua-1-1130", eventCardUid: attackAgent.uid, eventCode: eventAttackAnnounce, eventName: "attackDeclared", eventReason: 0, eventReasonPlayer: 0, player: 0, sourceUid: attackStaff.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredAttackTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredAttack.session), workspace, reader);
    expectCleanRestore(restoredAttackTrigger);
    expectRestoredLegalActions(restoredAttackTrigger, 0);
    const stat = getLuaRestoreLegalActions(restoredAttackTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === attackStaff.uid);
    expect(stat, JSON.stringify(getLuaRestoreLegalActions(restoredAttackTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttackTrigger, stat!);
    resolveRestoredChain(restoredAttackTrigger);
    expect(currentAttack(restoredAttackTrigger.session.state.cards.find((card) => card.uid === opponent.uid), restoredAttackTrigger.session.state)).toBe(0);
    expect(currentAttack(restoredAttackTrigger.session.state.cards.find((card) => card.uid === attackAgent.uid), restoredAttackTrigger.session.state)).toBe(1900);
    expect(restoredAttackTrigger.session.state.effects.filter((effect) => effect.code === effectSetAttackFinal && effect.value === 0).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, reset: { flags: 33427456 }, sourceUid: opponent.uid, value: 0 },
    ]);
    expect(restoredAttackTrigger.session.state.eventHistory.filter((event) => ["attackDeclared", "becameTarget"].includes(event.eventName)).map((event) => ({
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
      { eventName: "attackDeclared", eventCode: eventAttackAnnounce, eventCardUid: attackAgent.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined, previous: "deck", current: "monsterZone" },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: opponent.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 1, previous: "deck", current: "monsterZone" },
    ]);

    const restoredDestroyed = createRestoredDestroyed({ reader, workspace });
    expectCleanRestore(restoredDestroyed);
    expectRestoredLegalActions(restoredDestroyed, 0);
    const destroyedStaff = requireCard(restoredDestroyed.session, staffCode);
    const deckAgent = requireCard(restoredDestroyed.session, superAgentCode);
    destroyDuelCard(restoredDestroyed.session.state, destroyedStaff.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(restoredDestroyed.session.state.pendingTriggers.map((trigger) => ({
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
      { effectId: "lua-2-1029", eventCardUid: destroyedStaff.uid, eventCode: eventDestroyed, eventName: "destroyed", eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, player: 0, sourceUid: destroyedStaff.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(restoredDestroyed.session), workspace, reader);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "activateTrigger" && action.uid === destroyedStaff.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summon!);
    resolveRestoredChain(restoredSummon);
    expect(restoredSummon.session.state.cards.find((card) => card.uid === deckAgent.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: destroyedStaff.uid,
      reasonEffectId: 2,
    });

    const restoredGrave = createRestoredGraveRecovery({ reader, workspace });
    expectCleanRestore(restoredGrave);
    expectRestoredLegalActions(restoredGrave, 0);
    const graveStaff = requireCard(restoredGrave.session, staffCode);
    const fieldAgent = requireCard(restoredGrave.session, superAgentCode);
    sendDuelCardToGraveyard(restoredGrave.session.state, fieldAgent.uid, 0, duelReason.effect, 0);
    expect(restoredGrave.session.state.pendingTriggers.map((trigger) => ({
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
      { effectId: "lua-4-1014", eventCardUid: fieldAgent.uid, eventCode: eventToGrave, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonPlayer: 0, player: 0, sourceUid: graveStaff.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredRecovery = restoreDuelWithLuaScripts(serializeDuel(restoredGrave.session), workspace, reader);
    expectCleanRestore(restoredRecovery);
    expectRestoredLegalActions(restoredRecovery, 0);
    const recover = getLuaRestoreLegalActions(restoredRecovery, 0).find((action) => action.type === "activateTrigger" && action.uid === graveStaff.uid && action.effectId === "lua-4-1014");
    expect(recover, JSON.stringify(getLuaRestoreLegalActions(restoredRecovery, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredRecovery, recover!);
    resolveRestoredChain(restoredRecovery);
    expect(restoredRecovery.session.state.cards.find((card) => card.uid === graveStaff.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: graveStaff.uid,
      reasonEffectId: 4,
    });
    expect(restoredRecovery.session.state.cards.find((card) => card.uid === fieldAgent.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: graveStaff.uid,
      reasonEffectId: 4,
    });
    expect(restoredRecovery.session.state.eventHistory.filter((event) => ["sentToGraveyard", "banished", "sentToHand", "confirmed", "sentToHandConfirmed"].includes(event.eventName)).map((event) => ({
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
      { eventName: "sentToGraveyard", eventCode: eventToGrave, eventCardUid: fieldAgent.uid, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "banished", eventCode: 1011, eventCardUid: graveStaff.uid, eventPlayer: undefined, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: graveStaff.uid, eventReasonEffectId: 4, previous: "graveyard", current: "banished" },
      { eventName: "sentToHand", eventCode: 1012, eventCardUid: fieldAgent.uid, eventPlayer: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: graveStaff.uid, eventReasonEffectId: 4, previous: "graveyard", current: "hand" },
      { eventName: "confirmed", eventCode: 1211, eventCardUid: fieldAgent.uid, eventPlayer: 1, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: graveStaff.uid, eventReasonEffectId: 4, previous: "graveyard", current: "hand" },
      { eventName: "sentToHandConfirmed", eventCode: 1212, eventCardUid: fieldAgent.uid, eventPlayer: 1, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: graveStaff.uid, eventReasonEffectId: 4, previous: "graveyard", current: "hand" },
    ]);
    expect(restoredRecovery.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredAttack({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 64753157, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [staffCode, superAgentCode] }, 1: { main: [opponentCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, staffCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, superAgentCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, opponentCode), 1, 0);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(staffCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredDestroyed({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 64753158, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [staffCode, superAgentCode] }, 1: { main: [] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, staffCode), 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(staffCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredGraveRecovery({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 64753159, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [staffCode, superAgentCode, recoveryAgentCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, staffCode).uid, "graveyard", 0).faceUp = true;
  moveFaceUpAttack(session, requireCard(session, superAgentCode), 0, 0);
  moveDuelCard(session.state, requireCard(session, recoveryAgentCode).uid, "graveyard", 0).faceUp = true;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(staffCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectStaffScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("local a=Duel.GetAttacker()");
  expect(script).toContain("local d=Duel.GetAttackTarget()");
  expect(script).toContain("if a:IsControler(tp) and a:IsCode(41091257) then e:SetLabelObject(d)");
  expect(script).toContain("elseif d:IsControler(tp) and d:IsCode(41091257) then e:SetLabelObject(a)");
  expect(script).toContain("Duel.SetTargetCard(tc)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(0)");
  expect(script).toContain("e2:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("return r&(REASON_EFFECT|REASON_BATTLE)>0");
  expect(script).toContain("return c:IsCode(41091257) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)");
  expect(script).toContain("Duel.SpecialSummon(tg,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e3:SetCode(EVENT_BATTLE_DESTROYED)");
  expect(script).toContain("e3:SetCost(Cost.SelfBanish)");
  expect(script).toContain("e4:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("return not eg:IsContains(e:GetHandler()) and eg:IsExists(s.cfilter,1,nil,tp)");
  expect(script).toContain("return c:IsCode(41091257) and c:IsPreviousControler(tp) and c:IsPreviousLocation(LOCATION_MZONE) and c:IsPreviousPosition(POS_FACEUP)");
  expect(script).toContain("Duel.SendtoHand(g,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,g)");
}

function cards(): DuelCardData[] {
  return [
    { code: staffCode, name: "Charming Resort Staff", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, attribute: attributeLight, level: 3, attack: 300, defense: 200 },
    { code: superAgentCode, name: "SPYRAL Super Agent", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1900, defense: 1200 },
    { code: recoveryAgentCode, name: "SPYRAL Super Agent Recovery Copy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1900, defense: 1200 },
    { code: opponentCode, name: "Charming Staff Opponent", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2400, defense: 1000 },
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
