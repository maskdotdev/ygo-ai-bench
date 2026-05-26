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
const smasherCode = "60195675";
const materialACode = "601956750";
const materialBCode = "601956751";
const linkCostCode = "601956752";
const opponentCode = "601956753";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSmasherScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${smasherCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const typeLink = 0x4000000;
const raceMachine = 0x20;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasSmasherScript)("Lua real script Infinitrack Mountain Smasher overlay stat summon", () => {
  it("restores battle-destroying overlay attach and detach-cost ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${smasherCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 60195675, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialACode, materialBCode], extra: [smasherCode] }, 1: { main: [opponentCode] } });
    startDuel(session);

    const smasher = requireCard(session, smasherCode);
    const materialA = requireCard(session, materialACode);
    const materialB = requireCard(session, materialBCode);
    const opponent = requireCard(session, opponentCode);
    moveFaceUpAttack(session, smasher, 0);
    attachOverlay(session, smasher, materialA, 0);
    attachOverlay(session, smasher, materialB, 1);
    moveFaceUpAttack(session, opponent, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(smasherCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === smasher.uid && action.targetUid === opponent.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    finishBattleUntilTrigger(restoredBattle);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === smasher.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === smasher.uid)?.overlayUids).toEqual([materialA.uid, materialB.uid, opponent.uid]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === opponent.uid)).toMatchObject({
      location: "overlay",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: smasher.uid,
      reasonEffectId: 2,
    });
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 1100 });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["destroyed", "battleDestroyed"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "destroyed", eventCode: 1029, eventCardUid: opponent.uid, eventReason: duelReason.battle | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: smasher.uid, eventReasonEffectId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "battleDestroyed", eventCode: 1140, eventCardUid: opponent.uid, eventReason: duelReason.battle | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: smasher.uid, eventReasonEffectId: undefined, previousLocation: "monsterZone", currentLocation: "graveyard" },
    ]);

    restoredTrigger.session.state.phase = "main1";
    restoredTrigger.session.state.waitingFor = 0;
    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === smasher.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    passRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === smasher.uid)?.overlayUids).toEqual([materialB.uid, opponent.uid]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === materialA.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: smasher.uid,
      reasonEffectId: 3,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === smasher.uid), restoredOpen.session.state)).toBe(3100);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 1100 });
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === smasher.uid && effect.code === 100).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, event: "continuous", property: undefined, reset: { flags: 33492992 }, value: 1000 },
    ]);
  });

  it("restores grave Machine Link release cost into Defense Position Special Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${smasherCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 60195676, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [linkCostCode], extra: [smasherCode] }, 1: { main: [] } });
    startDuel(session);

    const smasher = requireCard(session, smasherCode);
    const linkCost = requireCard(session, linkCostCode);
    moveDuelCard(session.state, smasher.uid, "graveyard", 0);
    smasher.summonType = "xyz";
    smasher.customStatusMask = 0x8;
    moveFaceUpAttack(session, linkCost, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(smasherCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === smasher.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    passRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === linkCost.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: smasher.uid,
      reasonEffectId: 4,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === smasher.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
      reason: duelReason.specialSummon | duelReason.summon,
      reasonPlayer: 0,
      reasonCardUid: smasher.uid,
      reasonEffectId: 4,
    });
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Xyz.AddProcedure(c,nil,7,2)");
  expect(script).toContain("e1:SetCode(EVENT_BATTLE_DESTROYING)");
  expect(script).toContain("Duel.SetTargetCard(bc)");
  expect(script).toContain("Duel.Overlay(c,bc,true)");
  expect(script).toContain("e2:SetCost(Cost.DetachFromSelf(1,1,nil))");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetValue(1000)");
  expect(script).toContain("Duel.CheckReleaseGroupCost(tp,s.spcostfilter,1,false,nil,nil,tp)");
  expect(script).toContain("Duel.SelectReleaseGroupCost(tp,s.spcostfilter,1,1,false,nil,nil,tp)");
  expect(script).toContain("Duel.Release(g,REASON_COST)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP_DEFENSE)");
}

function cards(): DuelCardData[] {
  return [
    { code: smasherCode, name: "Infinitrack Mountain Smasher", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceMachine, attribute: attributeEarth, level: 7, attack: 2100, defense: 3100 },
    { code: materialACode, name: "Mountain Smasher Material A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 7, attack: 1000, defense: 1000 },
    { code: materialBCode, name: "Mountain Smasher Material B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 7, attack: 1000, defense: 1000 },
    { code: linkCostCode, name: "Mountain Smasher Machine Link Cost", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceMachine, attribute: attributeEarth, level: 2, attack: 1600, defense: 0, linkMarkers: 0x3 },
    { code: opponentCode, name: "Mountain Smasher Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 4, attack: 1000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function attachOverlay(session: DuelSession, holder: DuelCardInstance, material: DuelCardInstance, sequence: number): void {
  const moved = moveDuelCard(session.state, material.uid, "overlay", holder.controller);
  moved.sequence = sequence;
  holder.overlayUids.push(material.uid);
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

function finishBattleUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(30);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
