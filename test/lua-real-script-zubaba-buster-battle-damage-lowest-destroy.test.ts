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
const zubabaCode = "57036718";
const lowMonsterCode = "570367180";
const highMonsterCode = "570367181";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasZubabaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${zubabaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasZubabaScript)("Lua real script Zubaba Buster battle damage lowest destroy", () => {
  it("restores battle-damage flag into Damage Step End lowest-ATK destruction and self ATK loss", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${zubabaCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_BATTLE_DAMAGE)");
    expect(script).toContain("e:GetHandler():RegisterFlagEffect(id,RESET_EVENT|RESETS_STANDARD|RESET_PHASE|PHASE_DAMAGE,0,1)");
    expect(script).toContain("e2:SetCategory(CATEGORY_DESTROY+CATEGORY_ATKCHANGE)");
    expect(script).toContain("e2:SetCode(EVENT_DAMAGE_STEP_END)");
    expect(script).toContain("return e:GetHandler():GetFlagEffect(id)~=0");
    expect(script).toContain("Duel.GetMatchingGroup(s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
    expect(script).toContain("local tg=g:GetMinGroup(Card.GetAttack)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,tg,1,0,0)");
    expect(script).toContain("Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_DESTROY)");
    expect(script).toContain("Duel.Destroy(sg,REASON_EFFECT)");
    expect(script).toContain("Duel.Destroy(tg,REASON_EFFECT)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(-800)");

    const cards: DuelCardData[] = [
      { code: zubabaCode, name: "Zubaba Buster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 3, attack: 1800, defense: 600 },
      { code: lowMonsterCode, name: "Zubaba Lowest ATK Fixture", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 500, defense: 1000 },
      { code: highMonsterCode, name: "Zubaba Higher ATK Fixture", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 57036718, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [zubabaCode, lowMonsterCode] }, 1: { main: [highMonsterCode] } });
    startDuel(session);

    const zubaba = requireCard(session, zubabaCode);
    const lowMonster = requireCard(session, lowMonsterCode);
    const highMonster = requireCard(session, highMonsterCode);
    moveFaceUpAttack(session, zubaba, 0);
    moveFaceUpAttack(session, lowMonster, 0);
    moveFaceUpAttack(session, highMonster, 0);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(zubabaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === zubaba.uid && action.targetUid === undefined);
    expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    passUntilPendingTrigger(session);
    expect(session.state.players[1].lifePoints).toBe(6200);
    expect(session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventPlayer: trigger.eventPlayer,
      eventValue: trigger.eventValue,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-2-1141", eventCardUid: zubaba.uid, eventCode: 1141, eventName: "damageStepEnded", eventPlayer: 0, eventValue: undefined, player: 0, sourceUid: zubaba.uid, triggerBucket: "turnMandatory" },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const trigger = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateTrigger" && action.uid === zubaba.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    expect(JSON.stringify(trigger)).not.toContain("operationInfos");
    applyLuaRestoreAndAssert(restored, trigger!);
    passRestoredChain(restored);

    expect(restored.session.state.cards.find((card) => card.uid === lowMonster.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: zubaba.uid,
      reasonEffectId: 2,
    });
    expect(restored.session.state.cards.find((card) => card.uid === highMonster.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(currentAttack(restored.session.state.cards.find((card) => card.uid === zubaba.uid), restored.session.state)).toBe(1000);
    expect(restored.session.state.effects.filter((effect) => effect.sourceUid === zubaba.uid && effect.code === 100).map((effect) => ({
      sourceUid: effect.sourceUid,
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { sourceUid: zubaba.uid, code: 100, event: "continuous", reset: { flags: 33427456 }, value: -800 },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["battleDamageDealt", "damageStepEnded", "destroyed", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "battleDamageDealt", eventCode: 1143, eventCardUid: zubaba.uid, eventPlayer: 1, eventValue: 1800, eventReason: duelReason.battle, eventReasonPlayer: 0, eventReasonCardUid: zubaba.uid, eventReasonEffectId: undefined, previousLocation: "deck", currentLocation: "monsterZone" },
      { eventName: "damageStepEnded", eventCode: 1141, eventCardUid: zubaba.uid, eventPlayer: undefined, eventValue: undefined, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previousLocation: "deck", currentLocation: "monsterZone" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: lowMonster.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: zubaba.uid, eventReasonEffectId: 2, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: lowMonster.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: zubaba.uid, eventReasonEffectId: 2, previousLocation: "monsterZone", currentLocation: "graveyard" },
    ]);
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passUntilPendingTrigger(session: DuelSession): void {
  let guard = 0;
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
