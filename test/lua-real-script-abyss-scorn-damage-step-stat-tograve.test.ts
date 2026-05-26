import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const abyssScornCode = "79206750";
const mermailCode = "792067500";
const offSetCode = "792067501";
const opponentCode = "792067502";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasAbyssScornScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${abyssScornCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTrap = 0x4;
const raceAqua = 0x40;
const attributeWater = 0x10;
const setMermail = 0x74;
const effectUpdateAttack = 100;
const eventToGrave = 1014;

describe.skipIf(!hasUpstreamScripts || !hasAbyssScornScript)("Lua real script Abyss-scorn damage step stat to-Grave", () => {
  it("restores Damage Step Mermail ATK update and facedown on-field to-Grave target send", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectAbyssScornScriptShape(workspace.readScript(`official/c${abyssScornCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 79206750, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [abyssScornCode, mermailCode, offSetCode] }, 1: { main: [opponentCode] } });
    startDuel(session);

    const abyssScorn = requireCard(session, abyssScornCode);
    const mermail = requireCard(session, mermailCode);
    const offSet = requireCard(session, offSetCode);
    const opponent = requireCard(session, opponentCode);
    setFaceDownTrap(session, abyssScorn, 0, 0);
    moveFaceUpAttack(session, mermail, 0, 0);
    moveFaceUpAttack(session, offSet, 0, 1);
    moveFaceUpAttack(session, opponent, 1, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(abyssScornCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === mermail.uid && action.targetUid === opponent.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    passBattleAction(session, 1, "passAttack");
    passBattleAction(session, 0, "passAttack");
    passBattleAction(session, 1, "passDamage");

    const restoredBoost = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredBoost);
    expectRestoredLegalActions(restoredBoost, 0);
    const boost = getLuaRestoreLegalActions(restoredBoost, 0).find((action) =>
      action.type === "activateEffect" && action.uid === abyssScorn.uid && action.effectId === "lua-1-1002"
    );
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredBoost, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBoost, boost!);
    resolveRestoredChain(restoredBoost);

    expect(currentAttack(restoredBoost.session.state.cards.find((card) => card.uid === mermail.uid), restoredBoost.session.state)).toBe(2600);
    expect(currentAttack(restoredBoost.session.state.cards.find((card) => card.uid === offSet.uid), restoredBoost.session.state)).toBe(900);
    expect(restoredBoost.session.state.effects.filter((effect) => effect.sourceUid === mermail.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([{ code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: mermail.uid, value: 1000 }]);
    expect(restoredBoost.session.state.eventHistory.filter((event) => event.eventName === "becameTarget").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toContainEqual({ eventCardUid: mermail.uid, eventCode: 1028, eventName: "becameTarget", eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 });
    expect(restoredBoost.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const triggerSession = createDuel({ seed: 79206751, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(triggerSession, { 0: { main: [abyssScornCode] }, 1: { main: [opponentCode] } });
    startDuel(triggerSession);
    const triggerScorn = requireCard(triggerSession, abyssScornCode);
    const triggerOpponent = requireCard(triggerSession, opponentCode);
    setFaceDownTrap(triggerSession, triggerScorn, 0, 0);
    moveFaceUpAttack(triggerSession, triggerOpponent, 1, 0);
    triggerSession.state.turn = 2;
    triggerSession.state.phase = "main1";
    triggerSession.state.turnPlayer = 0;
    triggerSession.state.waitingFor = 0;
    const triggerHost = createLuaScriptHost(triggerSession, workspace);
    expect(triggerHost.loadCardScript(Number(abyssScornCode), workspace).ok).toBe(true);
    expect(triggerHost.registerInitialEffects()).toBe(1);

    sendDuelCardToGraveyard(triggerSession.state, triggerScorn.uid, 0, duelReason.effect, 1);
    expect(triggerSession.state.pendingTriggers.map((trigger) => ({
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
      { effectId: "lua-2-1014", eventCardUid: triggerScorn.uid, eventCode: eventToGrave, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonPlayer: 1, player: 0, sourceUid: triggerScorn.uid, triggerBucket: "turnMandatory" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(triggerSession), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const send = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.effectId === "lua-2-1014");
    expect(send, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, send!);
    resolveRestoredChain(restoredTrigger);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === triggerOpponent.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: triggerScorn.uid,
      reasonEffectId: 2,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["becameTarget", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: triggerScorn.uid, eventCode: eventToGrave, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 1, previous: "spellTrapZone", current: "graveyard" },
      { eventCardUid: triggerOpponent.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, previous: "deck", current: "monsterZone" },
      { eventCardUid: triggerOpponent.uid, eventCode: eventToGrave, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonCardUid: triggerScorn.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "monsterZone", current: "graveyard" },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectAbyssScornScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Abyss-scorn");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(1000)");
  expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("e:GetHandler():IsPreviousLocation(LOCATION_ONFIELD) and e:GetHandler():IsPreviousPosition(POS_FACEDOWN)");
  expect(script).toContain("Duel.SelectTarget(tp,nil,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,g,#g,0,0)");
  expect(script).toContain("Duel.SendtoGrave(tc,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: abyssScornCode, name: "Abyss-scorn", kind: "trap", typeFlags: typeTrap },
    { code: mermailCode, name: "Abyss-scorn Mermail", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeWater, level: 4, attack: 1600, defense: 1200, setcodes: [setMermail] },
    { code: offSetCode, name: "Abyss-scorn Off-Set", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeWater, level: 4, attack: 900, defense: 900, setcodes: [0x123] },
    { code: opponentCode, name: "Abyss-scorn Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeWater, level: 4, attack: 1200, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function setFaceDownTrap(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
  moved.faceUp = false;
  moved.position = "faceDown";
  return moved;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function passBattleAction(session: DuelSession, player: PlayerId, type: "passAttack" | "passDamage"): void {
  const pass = getLegalActions(session, player).find((action) => action.type === type);
  expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
  applyAndAssert(session, pass!);
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
