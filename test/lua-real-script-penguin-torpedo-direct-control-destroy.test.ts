import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { isCardDisabled } from "#duel/continuous-effects.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createEffectContext } from "#duel/effect-context.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const penguinCode = "17679043";
const targetCode = "176790430";
const typeMonster = 0x1;
const typeEffect = 0x20;
const categoryControl = 0x2000;
const categoryDestroy = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Penguin Torpedo direct control destroy", () => {
  it("restores direct battle-damage control into temporary negation, cannot attack, and self-destroy", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${penguinCode}.lua`);
    expect(script).toContain("--Penguin Torpedo");
    expect(script).toContain("e1:SetCode(EFFECT_DIRECT_ATTACK)");
    expect(script).toContain("e2:SetCategory(CATEGORY_CONTROL)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)");
    expect(script).toContain("e2:SetProperty(EFFECT_FLAG_CARD_TARGET)");
    expect(script).toContain("e2:SetCode(EVENT_BATTLE_DAMAGE)");
    expect(script).toContain("return ep==1-tp");
    expect(script).toContain("return c:IsLevelBelow(6) and c:IsFaceup() and c:IsControlerCanBeChanged()");
    expect(script).toContain("Duel.GetControl(tc,tp,PHASE_END,1)");
    expect(script).toContain("tc:NegateEffects(c,RESET_CONTROL)");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ATTACK)");
    expect(script).toContain("e3:SetCode(EVENT_DAMAGE_STEP_END)");
    expect(script).toContain("return e:GetHandler()==Duel.GetAttacker()");
    expect(script).toContain("Duel.Destroy(c,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === penguinCode),
      { code: targetCode, name: "Penguin Torpedo Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 17679043, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [penguinCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const penguin = requireCard(session, penguinCode);
    const target = requireCard(session, targetCode);
    moveFaceUpAttack(session, penguin, 0);
    moveFaceUpAttack(session, target, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(penguinCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === penguin.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 74, countLimit: undefined, event: "continuous", property: undefined, range: ["monsterZone"], triggerEvent: undefined },
      { category: categoryControl, code: 1143, countLimit: 1, event: "trigger", property: 16, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "battleDamageDealt" },
      { category: categoryDestroy, code: 1141, countLimit: undefined, event: "trigger", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "damageStepEnded" },
    ]);

    const directAttack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === penguin.uid && action.directAttack
    );
    expect(directAttack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, directAttack!);
    passRestoredUntilPendingTrigger(restoredOpen);
    expect(restoredOpen.session.state.players[1]!.lifePoints).toBe(7450);
    expect(restoredOpen.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-5-1",
        effectId: "lua-2-1143",
        eventCardUid: penguin.uid,
        eventCode: 1143,
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventName: "battleDamageDealt",
        eventPlayer: 1,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventReason: duelReason.battle,
        eventReasonCardUid: penguin.uid,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventValue: 550,
        player: 0,
        sourceUid: penguin.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredDamageTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredDamageTrigger);
    expectRestoredLegalActions(restoredDamageTrigger, 0);
    const controlTrigger = getLuaRestoreLegalActions(restoredDamageTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === penguin.uid);
    expect(controlTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDamageTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDamageTrigger, controlTrigger!);
    resolveRestoredChain(restoredDamageTrigger);

    const controlledTarget = requireCard(restoredDamageTrigger.session, targetCode);
    expect(controlledTarget).toMatchObject({
      controller: 0,
      previousController: 1,
      location: "monsterZone",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: penguin.uid,
      reasonEffectId: 2,
    });
    expect(isCardDisabled(restoredDamageTrigger.session.state, controlledTarget, (effect, sourceCard, targetCard) =>
      createEffectContext(restoredDamageTrigger.session.state, sourceCard, effect.controller, undefined, targetCard, [], true),
    )).toBe(true);
    expect(restoredDamageTrigger.session.state.effects.filter((effect) => effect.sourceUid === controlledTarget.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 4608, event: "continuous", property: undefined, reset: { flags: 1082135040, count: 1 }, value: 1 },
      { code: 2, event: "continuous", property: 1024, reset: { flags: 66981888, count: 1 }, value: undefined },
      { code: 8, event: "continuous", property: 1024, reset: { flags: 66981888, count: 1 }, value: 131072 },
      { code: 85, event: "continuous", property: 67109888, reset: { flags: 66981888 }, value: undefined },
    ]);
    expect(restoredDamageTrigger.session.state.eventHistory.filter((event) => event.eventName === "controlChanged" && event.eventCardUid === target.uid)).toEqual([
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: target.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: penguin.uid,
        eventReasonEffectId: 2,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 1 },
      },
    ]);

    passRestoredUntilPendingTrigger(restoredDamageTrigger);
    expect(restoredDamageTrigger.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-8-1",
        effectId: "lua-3-1141",
        eventCardUid: penguin.uid,
        eventCode: 1141,
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventName: "damageStepEnded",
        eventPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: penguin.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredDestroyTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDamageTrigger.session), workspace, reader);
    expectCleanRestore(restoredDestroyTrigger);
    expectRestoredLegalActions(restoredDestroyTrigger, 0);
    const destroyTrigger = getLuaRestoreLegalActions(restoredDestroyTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === penguin.uid && action.effectId === "lua-3-1141");
    expect(destroyTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDestroyTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDestroyTrigger, destroyTrigger!);
    resolveRestoredChain(restoredDestroyTrigger);
    expect(restoredDestroyTrigger.session.state.cards.find((card) => card.uid === penguin.uid)).toMatchObject({
      controller: 0,
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: penguin.uid,
      reasonEffectId: 3,
    });
  });
});

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: 0 | 1): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
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

function passRestoredUntilPendingTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
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
