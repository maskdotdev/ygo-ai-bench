import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const pandemicDragonCode = "68299524";
const allyCode = "682995240";
const opponentCode = "682995241";
const destroyTargetCode = "682995242";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasPandemicDragonScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${pandemicDragonCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceDragon = 0x2000;
const raceWarrior = 0x1;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasPandemicDragonScript)("Lua real script Pandemic Dragon announce LP destroy stat", () => {
  it("restores AnnounceNumber LP cost into group ATK loss, target destruction, and destroyed-trigger debuff", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${pandemicDragonCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 68299524, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [pandemicDragonCode, allyCode] }, 1: { main: [opponentCode, destroyTargetCode] } });
    startDuel(session);

    const pandemicDragon = requireCard(session, pandemicDragonCode);
    const ally = requireCard(session, allyCode);
    const opponent = requireCard(session, opponentCode);
    const destroyTarget = requireCard(session, destroyTargetCode);
    moveFaceUpAttack(session, pandemicDragon, 0);
    moveFaceUpAttack(session, ally, 0);
    ally.sequence = 1;
    moveFaceUpAttack(session, opponent, 1);
    moveFaceUpAttack(session, destroyTarget, 1);
    destroyTarget.sequence = 1;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(pandemicDragonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const statActivation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === pandemicDragon.uid && action.effectId.endsWith("-1")
    );
    expect(statActivation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, statActivation!);
    passRestoredChain(restoredOpen);

    expect(restoredOpen.host.promptDecisions).toEqual([
      {
        id: "lua-prompt-1",
        api: "AnnounceNumber",
        player: 0,
        options: Array.from({ length: 27 }, (_, index) => (index + 1) * 100),
        descriptions: Array.from({ length: 27 }, (_, index) => (index + 1) * 100),
        returned: 100,
      },
    ]);
    expect(restoredOpen.session.state.players[0].lifePoints).toBe(7900);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === pandemicDragon.uid), restoredOpen.session.state)).toBe(2500);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === ally.uid), restoredOpen.session.state)).toBe(2600);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === opponent.uid), restoredOpen.session.state)).toBe(2600);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === destroyTarget.uid), restoredOpen.session.state)).toBe(400);
    expect(restoredOpen.session.state.eventHistory.filter((event) => event.eventName === "lifePointCostPaid")).toEqual([
      {
        eventName: "lifePointCostPaid",
        eventCode: 1201,
        eventPlayer: 0,
        eventValue: 100,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: pandemicDragon.uid,
        eventReasonEffectId: 1,
      },
    ]);

    const restoredDestroyOpen = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredDestroyOpen);
    expectRestoredLegalActions(restoredDestroyOpen, 0);
    const destroyActivation = getLuaRestoreLegalActions(restoredDestroyOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === pandemicDragon.uid && action.effectId.endsWith("-2")
    );
    expect(destroyActivation, JSON.stringify(getLuaRestoreLegalActions(restoredDestroyOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroyOpen, destroyActivation!);
    passRestoredChain(restoredDestroyOpen);

    expect(restoredDestroyOpen.session.state.cards.find((card) => card.uid === pandemicDragon.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: pandemicDragon.uid,
      reasonEffectId: 2,
    });
    expect(restoredDestroyOpen.session.state.cards.find((card) => card.uid === destroyTarget.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restoredDestroyOpen.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-7-1",
        effectId: "lua-3-1029",
        sourceUid: pandemicDragon.uid,
        player: 0,
        triggerBucket: "turnMandatory",
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: pandemicDragon.uid,
        eventPlayer: 0,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: pandemicDragon.uid,
        eventReasonEffectId: 2,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDestroyOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === pandemicDragon.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === ally.uid), restoredTrigger.session.state)).toBe(1600);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === opponent.uid), restoredTrigger.session.state)).toBe(1600);
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === destroyTarget.uid), restoredTrigger.session.state)).toBe(-600);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["destroyed", "lifePointCostPaid"].includes(event.eventName)).map((event) => ({
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
      { eventName: "lifePointCostPaid", eventCode: 1201, eventCardUid: undefined, eventPlayer: 0, eventValue: 100, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: pandemicDragon.uid, eventReasonEffectId: 1, previousLocation: undefined, currentLocation: undefined },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: pandemicDragon.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: pandemicDragon.uid, eventReasonEffectId: 2, previousLocation: "monsterZone", currentLocation: "graveyard" },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("Duel.CheckLPCost(tp,100)");
  expect(script).toContain("Duel.GetMatchingGroup(s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,e:GetHandler())");
  expect(script).toContain("local tg,atk=g:GetMaxGroup(Card.GetAttack)");
  expect(script).toContain("Duel.AnnounceNumber(tp,table.unpack(t))");
  expect(script).toContain("Duel.PayLPCost(tp,cost)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(-val)");
  expect(script).toContain("e2:SetCategory(CATEGORY_DESTROY)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("Duel.SelectTarget(tp,s.desfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil,c:GetAttack())");
  expect(script).toContain("Duel.Destroy(tc,REASON_EFFECT)");
  expect(script).toContain("e3:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e3:SetCode(EVENT_DESTROYED)");
  expect(script).toContain("return (r&REASON_EFFECT+REASON_BATTLE)~=0");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)");
  expect(script).toContain("e1:SetValue(-1000)");
}

function cards(): DuelCardData[] {
  return [
    { code: pandemicDragonCode, name: "Pandemic Dragon", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceDragon, attribute: attributeDark, level: 7, attack: 2500, defense: 1000 },
    { code: allyCode, name: "Pandemic Dragon Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 2700, defense: 1000 },
    { code: opponentCode, name: "Pandemic Dragon Opponent", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 2700, defense: 1000 },
    { code: destroyTargetCode, name: "Pandemic Dragon Destroy Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 500, defense: 1000 },
  ];
}

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
