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
const jiaWenCode = "6438003";
const continuousCode = "64380030";
const allyCode = "64380031";
const opponentCode = "64380032";
const ancientGraveCode = "64380033";
const destroyedOpponentCode = "64380034";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasJiaWenScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${jiaWenCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeEffect = 0x20;
const typeContinuous = 0x20000;
const raceBeastWarrior = 0x400000;
const attributeFire = 0x4;
const setAncientWarriors = 0x137;
const effectSetAttackFinal = 102;

describe.skipIf(!hasUpstreamScripts || !hasJiaWenScript)("Lua real script Ancient Warriors Jia Wen send halve destroyed to-hand stat", () => {
  it("restores Continuous send-to-GY into two final ATK halves and destroyed opponent recovery", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${jiaWenCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 6438003, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [jiaWenCode, continuousCode, allyCode, ancientGraveCode] }, 1: { main: [opponentCode, destroyedOpponentCode] } });
    startDuel(session);

    const jiaWen = requireCard(session, jiaWenCode);
    const continuous = requireCard(session, continuousCode);
    const ally = requireCard(session, allyCode);
    const opponent = requireCard(session, opponentCode);
    const ancientGrave = requireCard(session, ancientGraveCode);
    const destroyedOpponent = requireCard(session, destroyedOpponentCode);
    moveFaceUpAttack(session, jiaWen, 0, 0);
    moveFaceUpAttack(session, ally, 0, 1);
    moveFaceUpAttack(session, opponent, 1, 0);
    moveFaceUpAttack(session, destroyedOpponent, 1, 1);
    moveDuelCard(session.state, continuous.uid, "spellTrapZone", 0).faceUp = true;
    moveDuelCard(session.state, ancientGrave.uid, "graveyard", 0).faceUp = true;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(jiaWenCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const halve = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === jiaWen.uid && action.effectId === "lua-1"
    );
    expect(halve, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, halve!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === continuous.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: jiaWen.uid,
      reasonEffectId: 1,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === jiaWen.uid), restoredOpen.session.state)).toBe(700);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === ally.uid), restoredOpen.session.state)).toBe(900);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === opponent.uid), restoredOpen.session.state)).toBe(2200);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.code === effectSetAttackFinal).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, reset: { flags: 1107169792 }, sourceUid: jiaWen.uid, value: 700 },
      { code: effectSetAttackFinal, reset: { flags: 1107169792 }, sourceUid: ally.uid, value: 900 },
    ]);

    destroyDuelCard(restoredOpen.session.state, destroyedOpponent.uid, 1, duelReason.effect | duelReason.destroy, 0, "graveyard", {
      eventReasonCardUid: jiaWen.uid,
      eventReasonEffectId: 99,
    });
    expect(restoredOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventPreviousState: trigger.eventPreviousState,
      eventReason: trigger.eventReason,
      eventReasonCardUid: trigger.eventReasonCardUid,
      eventReasonEffectId: trigger.eventReasonEffectId,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-2-1029",
        eventCardUid: destroyedOpponent.uid,
        eventCode: 1029,
        eventName: "destroyed",
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonCardUid: jiaWen.uid,
        eventReasonEffectId: 99,
        player: 0,
        sourceUid: jiaWen.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const recover = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === jiaWen.uid && action.effectId === "lua-2-1029"
    );
    expect(recover, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, recover!);
    resolveRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === ancientGrave.uid)).toMatchObject({
      location: "hand",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: jiaWen.uid,
      reasonEffectId: 2,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["sentToGraveyard", "destroyed", "sentToHand"].includes(event.eventName)).map((event) => ({
      current: event.eventCurrentState?.location,
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      previous: event.eventPreviousState?.location,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { current: "graveyard", eventCardUid: continuous.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonCardUid: jiaWen.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, previous: "spellTrapZone", relatedEffectId: undefined },
      { current: "graveyard", eventCardUid: destroyedOpponent.uid, eventCode: 1029, eventName: "destroyed", eventReason: duelReason.effect | duelReason.destroy, eventReasonCardUid: jiaWen.uid, eventReasonEffectId: 99, eventReasonPlayer: 0, previous: "monsterZone", relatedEffectId: undefined },
      { current: "graveyard", eventCardUid: destroyedOpponent.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect | duelReason.destroy, eventReasonCardUid: jiaWen.uid, eventReasonEffectId: 99, eventReasonPlayer: 0, previous: "monsterZone", relatedEffectId: undefined },
      { current: "hand", eventCardUid: ancientGrave.uid, eventCode: 1012, eventName: "sentToHand", eventReason: duelReason.effect, eventReasonCardUid: jiaWen.uid, eventReasonEffectId: 2, eventReasonPlayer: 0, previous: "graveyard", relatedEffectId: undefined },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Ancient Warriors - Deceptive Jia Wen");
  expect(script).toContain("e1:SetCategory(CATEGORY_TOGRAVE+CATEGORY_ATKCHANGE)");
  expect(script).toContain("Duel.SelectTarget(tp,s.tgfilter,tp,LOCATION_ONFIELD,0,1,1,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_TOGRAVE,g,1,0,0)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,nil,2,0,0)");
  expect(script).toContain("Duel.SendtoGrave(tc,REASON_EFFECT)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.atkfilter,tp,LOCATION_MZONE,LOCATION_MZONE,2,2,nil)");
  expect(script).toContain("Duel.HintSelection(sg)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(card:GetAttack()//2)");
  expect(script).toContain("e2:SetCategory(CATEGORY_TOHAND)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_DELAY+EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("e2:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("c:IsPreviousLocation(LOCATION_ONFIELD) and c:GetPreviousControler()==1-tp");
  expect(script).toContain("return c:IsSetCard(SET_ANCIENT_WARRIORS) and c:IsAbleToHand() and not c:IsCode(id)");
  expect(script).toContain("Duel.SelectTarget(tp,s.thfilter,tp,LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoHand(tc,nil,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: jiaWenCode, name: "Ancient Warriors - Deceptive Jia Wen", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeFire, level: 4, attack: 1400, defense: 1200, setcodes: [setAncientWarriors] },
    { code: continuousCode, name: "Jia Wen Continuous Cost", kind: "spell", typeFlags: typeSpell | typeContinuous },
    { code: allyCode, name: "Jia Wen Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeFire, level: 4, attack: 1800, defense: 1000, setcodes: [setAncientWarriors] },
    { code: opponentCode, name: "Jia Wen Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeFire, level: 4, attack: 2200, defense: 1000 },
    { code: ancientGraveCode, name: "Jia Wen Ancient Warriors Grave", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeFire, level: 4, attack: 1600, defense: 1000, setcodes: [setAncientWarriors] },
    { code: destroyedOpponentCode, name: "Jia Wen Destroyed Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeastWarrior, attribute: attributeFire, level: 4, attack: 1200, defense: 1000 },
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
