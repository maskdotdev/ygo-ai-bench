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
const junkBerserkerCode = "59771339";
const junkCostCode = "597713390";
const attackTargetCode = "597713391";
const defenseTargetCode = "597713392";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasJunkBerserkerScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${junkBerserkerCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSynchro = 0x2000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const setJunk = 0x43;

describe.skipIf(!hasUpstreamScripts || !hasJunkBerserkerScript)("Lua real script Junk Berserker banish stat battle destroy", () => {
  it("restores SpElimFilter banish-cost ATK loss and battle-start Defense Position destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${junkBerserkerCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 59771339, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [junkCostCode], extra: [junkBerserkerCode] }, 1: { main: [attackTargetCode, defenseTargetCode] } });
    startDuel(session);

    const junkBerserker = requireCard(session, junkBerserkerCode);
    const junkCost = requireCard(session, junkCostCode);
    const attackTarget = requireCard(session, attackTargetCode);
    const defenseTarget = requireCard(session, defenseTargetCode);
    moveFaceUpAttack(session, junkBerserker, 0);
    moveDuelCard(session.state, junkCost.uid, "graveyard", 0);
    junkCost.faceUp = true;
    moveFaceUpAttack(session, attackTarget, 1);
    moveFaceUpDefense(session, defenseTarget, 1);
    defenseTarget.sequence = 1;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(junkBerserkerCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const statActivation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === junkBerserker.uid
    );
    expect(statActivation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, statActivation!);
    passRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === junkCost.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: junkBerserker.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === attackTarget.uid), restoredOpen.session.state)).toBe(800);

    restoredOpen.session.state.phase = "battle";
    restoredOpen.session.state.waitingFor = 0;
    const restoredBattleOpen = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredBattleOpen);
    expectRestoredLegalActions(restoredBattleOpen, 0);
    const attack = getLuaRestoreLegalActions(restoredBattleOpen, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === junkBerserker.uid && action.targetUid === defenseTarget.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattleOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattleOpen, attack!);
    passUntilBattleStarted(restoredBattleOpen);
    expect(restoredBattleOpen.session.state.pendingTriggers).toMatchObject([
      {
        effectId: "lua-4-1132",
        sourceUid: junkBerserker.uid,
        eventName: "battleStarted",
        eventCode: 1132,
        eventCardUid: junkBerserker.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattleOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === junkBerserker.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === defenseTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: junkBerserker.uid,
      reasonEffectId: 4,
    });
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["banished", "battleStarted", "destroyed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "banished", eventCode: 1011, eventCardUid: junkCost.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: junkBerserker.uid, eventReasonEffectId: 3, relatedEffectId: undefined, previousLocation: "graveyard", currentLocation: "banished" },
      { eventName: "battleStarted", eventCode: 1132, eventCardUid: junkBerserker.uid, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined, previousLocation: "extraDeck", currentLocation: "monsterZone" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: defenseTarget.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: junkBerserker.uid, eventReasonEffectId: 4, relatedEffectId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard" },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Synchro.AddProcedure(c,s.tunerfilter,1,1,Synchro.NonTuner(nil),1,99)");
  expect(script).toContain("c:IsSetCard(SET_JUNK) and c:IsMonster() and c:GetAttack()>0 and c:IsAbleToRemoveAsCost()");
  expect(script).toContain("and aux.SpElimFilter(c,true)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.atkcostfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,1,nil):GetFirst()");
  expect(script).toContain("e:SetLabel(sc:GetAttack())");
  expect(script).toContain("Duel.Remove(sc,POS_FACEUP,REASON_COST)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("tc:UpdateAttack(-e:GetLabel(),nil,e:GetHandler())");
  expect(script).toContain("e2:SetCode(EVENT_BATTLE_START)");
  expect(script).toContain("return e:GetHandler()==Duel.GetAttacker() and bc and bc:IsDefensePos()");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,Duel.GetAttackTarget(),1,tp,0)");
  expect(script).toContain("Duel.Destroy(bc,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: junkBerserkerCode, name: "Junk Berserker", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceWarrior, attribute: attributeDark, level: 7, attack: 2700, defense: 1800 },
    { code: junkCostCode, name: "Junk Banish Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, setcodes: [setJunk], level: 4, attack: 1200, defense: 1000 },
    { code: attackTargetCode, name: "Junk Berserker Attack Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 2000, defense: 1000 },
    { code: defenseTargetCode, name: "Junk Berserker Defense Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1900, defense: 2500 },
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

function moveFaceUpDefense(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpDefense";
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

function passUntilBattleStarted(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
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
