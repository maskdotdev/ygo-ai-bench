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
const dracoCode = "5041348";
const battleTargetCode = "50413480";
const secondTargetCode = "50413481";
const responderCode = "50413482";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasDracoScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${dracoCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSynchro = 0x2000;
const raceWyrm = 0x800000;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const effectCannotDirectAttack = 73;
const effectUpdateAttack = 100;
const effectExtraAttack = 194;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasDracoScript)("Lua real script Draco Berserker battle destroying banish attack stat", () => {
  it("restores battle-destroying ATK gain plus monster-only extra attack lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${dracoCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredBattle = createRestoredDracoBattleField({ reader, workspace });
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const draco = requireCard(restoredBattle.session, dracoCode);
    const battleTarget = requireCard(restoredBattle.session, battleTargetCode);
    const secondTarget = requireCard(restoredBattle.session, secondTargetCode);

    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === draco.uid && action.targetUid === battleTarget.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    finishBattleUntilTrigger(restoredBattle);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === draco.uid
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === battleTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.battle | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: draco.uid,
    });
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === draco.uid), restoredTrigger.session.state)).toBe(4800);
    expect(restoredTrigger.session.state.effects.filter((effect) =>
      effect.sourceUid === draco.uid && [effectCannotDirectAttack, effectUpdateAttack, effectExtraAttack].includes(effect.code ?? -1)
    ).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, property: undefined, reset: { flags: 33492992 }, sourceUid: draco.uid, value: 1800 },
      { code: effectCannotDirectAttack, property: 0x4000000, reset: { flags: 1107169408 }, sourceUid: draco.uid, value: undefined },
      { code: effectExtraAttack, property: 0x4000000, reset: { flags: 1107169408 }, sourceUid: draco.uid, value: 1 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["attackDeclared", "destroyed", "battleDestroyed"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventCurrentLocation: event.eventCurrentState?.location,
      eventName: event.eventName,
      eventPreviousLocation: event.eventPreviousState?.location,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: draco.uid, eventCode: 1130, eventCurrentLocation: "monsterZone", eventName: "attackDeclared", eventPreviousLocation: "extraDeck", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: battleTarget.uid, eventCode: 1029, eventCurrentLocation: "graveyard", eventName: "destroyed", eventPreviousLocation: "monsterZone", eventReason: duelReason.battle | duelReason.destroy, eventReasonCardUid: draco.uid, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
      { eventCardUid: battleTarget.uid, eventCode: 1140, eventCurrentLocation: "graveyard", eventName: "battleDestroyed", eventPreviousLocation: "monsterZone", eventReason: duelReason.battle | duelReason.destroy, eventReasonCardUid: draco.uid, eventReasonEffectId: undefined, eventReasonPlayer: 0 },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 1200 });

    const restoredSecondAttack = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredSecondAttack);
    expectRestoredLegalActions(restoredSecondAttack, 0);
    const secondActions = getLuaRestoreLegalActions(restoredSecondAttack, 0);
    const secondAttack = secondActions.find((action) =>
      action.type === "declareAttack" && action.attackerUid === draco.uid && action.targetUid === secondTarget.uid
    );
    expect(secondAttack, JSON.stringify(secondActions, null, 2)).toBeDefined();
    expect(hasDirectAttack(secondActions, draco.uid)).toBe(false);
  });

  it("restores opponent monster-effect chain response into targeted banish", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${dracoCode}.lua`);
    expectScriptShape(script);
    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return responderScript();
        return workspace.readScript(name);
      },
    };
    const reader = createCardReader(cards(workspace));

    const restoredOpen = createRestoredDracoChainField({ reader, source, workspace });
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 1);
    const draco = requireCard(restoredOpen.session, dracoCode);
    const responder = requireCard(restoredOpen.session, responderCode);
    const opponentEffect = getLuaRestoreLegalActions(restoredOpen, 1).find((action) =>
      action.type === "activateEffect" && action.uid === responder.uid
    );
    expect(opponentEffect, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, opponentEffect!);

    const dracoResponse = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === draco.uid
    );
    expect(dracoResponse, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    if (!dracoResponse || dracoResponse.type !== "activateEffect") throw new Error("Expected Draco Berserker chain response");
    const dracoEffectNumericId = Number(dracoResponse.effectId.split("-")[1]);
    applyRestoredActionAndAssert(restoredOpen, dracoResponse);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === responder.uid)).toMatchObject({
      location: "banished",
      controller: 1,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: draco.uid,
      reasonEffectId: dracoEffectNumericId,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["becameTarget", "banished"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: responder.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, relatedEffectId: dracoEffectNumericId },
      { eventCardUid: responder.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.effect, eventReasonCardUid: draco.uid, eventReasonEffectId: dracoEffectNumericId, eventReasonPlayer: 0, relatedEffectId: undefined },
    ]);
    expect(restoredOpen.host.messages).toContain("draco responder resolved");
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredDracoBattleField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 5041348, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [], extra: [dracoCode] }, 1: { main: [battleTargetCode, secondTargetCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, dracoCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, battleTargetCode), 1, 0);
  moveFaceUpAttack(session, requireCard(session, secondTargetCode), 1, 1);
  session.state.phase = "battle";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(dracoCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredDracoChainField({
  reader,
  source,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  source: { readScript(name: string): string | undefined };
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 5041349, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [], extra: [dracoCode] }, 1: { main: [responderCode] } });
  startDuel(session);
  moveFaceUpAttack(session, requireCard(session, dracoCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, responderCode), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(dracoCode), source).ok).toBe(true);
  expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(2);
  return restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Draco Berserker of the Tenyi");
  expect(script).toContain("c:EnableReviveLimit()");
  expect(script).toContain("Synchro.AddProcedure(c,nil,1,1,Synchro.NonTuner(nil),1,99)");
  expect(script).toContain("CATEGORY_REMOVE");
  expect(script).toContain("EFFECT_TYPE_QUICK_O");
  expect(script).toContain("EVENT_CHAINING");
  expect(script).toContain("return rp==1-tp and re:IsMonsterEffect() and re:GetHandler():IsRelateToEffect(re)");
  expect(script).toContain("Duel.SetTargetCard(rc)");
  expect(script).toContain("Duel.Remove(rc,POS_FACEUP,REASON_EFFECT)");
  expect(script).toContain("CATEGORY_ATKCHANGE");
  expect(script).toContain("EVENT_BATTLE_DESTROYING");
  expect(script).toContain("bc:IsLocation(LOCATION_GRAVE) and bc:IsType(TYPE_EFFECT)");
  expect(script).toContain("Duel.SetTargetCard(e:GetHandler():GetBattleTarget())");
  expect(script).toContain("EFFECT_UPDATE_ATTACK");
  expect(script).toContain("tc:GetBaseAttack()");
  expect(script).toContain("RESET_EVENT|RESETS_STANDARD_DISABLE");
  expect(script).toContain("EFFECT_CANNOT_DIRECT_ATTACK");
  expect(script).toContain("EFFECT_FLAG_CLIENT_HINT");
  expect(script).toContain("EFFECT_EXTRA_ATTACK");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const draco = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === dracoCode);
  expect(draco).toBeDefined();
  return [
    { ...draco!, kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceWyrm, attribute: attributeDark },
    { code: battleTargetCode, name: "Draco Berserker Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000 },
    { code: secondTargetCode, name: "Draco Berserker Second Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
    { code: responderCode, name: "Draco Berserker Opponent Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000 },
  ];
}

function responderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_MZONE)
      e:SetOperation(function(e,tp) Debug.Message("draco responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
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

function hasDirectAttack(actions: DuelAction[], attackerUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.directAttack === true);
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
