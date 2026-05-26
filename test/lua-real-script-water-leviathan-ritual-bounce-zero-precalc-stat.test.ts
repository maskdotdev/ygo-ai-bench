import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { luaSummonTypeRitual } from "#duel/summon-type-codes.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const leviathanCode = "37061511";
const opponentLowCode = "370615110";
const opponentHighCode = "370615111";
const linkGraveCode = "370615112";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasLeviathanScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${leviathanCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceCyberse = 0x1000000;
const attributeWater = 0x2;
const attributeDark = 0x20;
const effectSetAttackFinal = 102;

describe.skipIf(!hasUpstreamScripts || !hasLeviathanScript)("Lua real script Water Leviathan ritual bounce zero precalc stat", () => {
  it("restores Ritual Summon success into opponent low-ATK monster bounce", () => {
    const { workspace, reader, session } = createLeviathanSession(37061511);
    const leviathan = requireCard(session, leviathanCode);
    const low = requireCard(session, opponentLowCode);
    const high = requireCard(session, opponentHighCode);
    moveFaceUpAttack(session, low, 1, 0);
    moveFaceUpAttack(session, high, 1, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(leviathanCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    specialSummonDuelCard(session.state, leviathan.uid, 0, 0, {}, luaSummonTypeRitual, true, true);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const trigger = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateTrigger" && action.uid === leviathan.uid && action.effectId === "lua-2-1102");
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, trigger!);
    passRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === low.uid)).toMatchObject({
      location: "hand",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: leviathan.uid,
      reasonEffectId: 2,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === high.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "sentToHand").map((event) => ({
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
      { eventCardUid: low.uid, eventCode: 1012, eventName: "sentToHand", eventReason: duelReason.effect, eventReasonCardUid: leviathan.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "monsterZone", current: "hand" },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });

  it("restores grave Link to Deck target zero and pre-damage battle halve", () => {
    const { workspace, reader, session } = createLeviathanSession(37061512);
    const leviathan = requireCard(session, leviathanCode);
    const target = requireCard(session, opponentLowCode);
    const link = requireCard(session, linkGraveCode);
    moveFaceUpAttack(session, leviathan, 0, 0);
    moveFaceUpAttack(session, target, 1, 0);
    moveDuelCard(session.state, link.uid, "graveyard", 0).faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(leviathanCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredIgnition = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredIgnition);
    expectRestoredLegalActions(restoredIgnition, 0);
    const zero = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) => action.type === "activateEffect" && action.uid === leviathan.uid && action.effectId === "lua-3");
    expect(zero, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredIgnition, zero!);
    passRestoredChain(restoredIgnition);

    expect(restoredIgnition.session.state.cards.find((card) => card.uid === link.uid)).toMatchObject({
      location: "extraDeck",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: leviathan.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(restoredIgnition.session.state.cards.find((card) => card.uid === target.uid), restoredIgnition.session.state)).toBe(0);
    expect(restoredIgnition.session.state.effects.filter((effect) => effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, reset: { flags: 33427456 }, sourceUid: target.uid, value: 0 },
    ]);
    expect(restoredIgnition.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const battle = createLeviathanSession(37061513);
    const battleLeviathan = requireCard(battle.session, leviathanCode);
    const battleTarget = requireCard(battle.session, opponentLowCode);
    moveFaceUpAttack(battle.session, battleLeviathan, 0, 0);
    moveFaceUpAttack(battle.session, battleTarget, 1, 0);
    battle.session.state.phase = "battle";
    battle.session.state.turnPlayer = 0;
    battle.session.state.waitingFor = 0;
    const battleHost = createLuaScriptHost(battle.session, battle.workspace);
    expect(battleHost.loadCardScript(Number(leviathanCode), battle.workspace).ok).toBe(true);
    expect(battleHost.registerInitialEffects()).toBe(1);
    const restoredSetup = restoreDuelWithLuaScripts(serializeDuel(battle.session), battle.workspace, battle.reader);
    expectCleanRestore(restoredSetup);
    expectRestoredLegalActions(restoredSetup, 0);
    const attack = getLuaRestoreLegalActions(restoredSetup, 0).find((action) => action.type === "declareAttack" && action.attackerUid === battleLeviathan.uid && action.targetUid === battleTarget.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredSetup, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSetup, attack!);
    passRestoredBattleAction(restoredSetup, 1, "passAttack");
    passRestoredBattleAction(restoredSetup, 0, "passAttack");
    passRestoredBattleAction(restoredSetup, 1, "passDamage");
    passRestoredBattleAction(restoredSetup, 0, "passDamage");
    passRestoredBattleAction(restoredSetup, 1, "passDamage");

    const halve = getLuaRestoreLegalActions(restoredSetup, 0).find((action) => action.type === "activateEffect" && action.uid === battleLeviathan.uid && action.effectId === "lua-4-1134");
    expect(halve, JSON.stringify(getLuaRestoreLegalActions(restoredSetup, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSetup, halve!);
    expect(currentAttack(restoredSetup.session.state.cards.find((card) => card.uid === battleTarget.uid), restoredSetup.session.state)).toBe(1150);
    expect(restoredSetup.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createLeviathanSession(seed: number) {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  expectScriptShape(workspace.readScript(`official/c${leviathanCode}.lua`));
  const reader = createCardReader(cards());
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [leviathanCode, linkGraveCode] }, 1: { main: [opponentLowCode, opponentHighCode] } });
  startDuel(session);
  return { workspace, reader, session };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Water Leviathan @Ignister");
  expect(script).toContain("return e:GetHandler():IsRitualSummoned()");
  expect(script).toContain("Duel.SendtoHand(sg,nil,REASON_EFFECT)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.HasNonZeroAttack,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.SendtoDeck(g,nil,SEQ_DECKTOP,REASON_EFFECT)>0");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e3:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
  expect(script).toContain("c:RegisterFlagEffect(id,RESET_CHAIN,0,1)");
  expect(script).toContain("e1:SetValue(tc:GetAttack()/2)");
}

function cards(): DuelCardData[] {
  return [
    { code: leviathanCode, name: "Water Leviathan @Ignister", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeWater, level: 7, attack: 2300, defense: 2000 },
    { code: opponentLowCode, name: "Water Leviathan Low ATK Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeDark, level: 4, attack: 2300, defense: 1000 },
    { code: opponentHighCode, name: "Water Leviathan High ATK Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeDark, level: 4, attack: 2400, defense: 1000 },
    { code: linkGraveCode, name: "Water Leviathan Link Grave", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeDark, level: 0, attack: 1000, defense: 0 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function passRestoredBattleAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, type: "passAttack" | "passDamage"): void {
  expectRestoredLegalActions(restored, player);
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === type);
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
}

function passUntilPendingTrigger(session: DuelSession): void {
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
