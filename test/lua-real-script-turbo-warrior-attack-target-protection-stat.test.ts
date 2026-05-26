import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const turboCode = "46195773";
const synchroTargetCode = "461957730";
const lowLevelTargeterCode = "461957731";
const highLevelTargeterCode = "461957732";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasTurboScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${turboCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSynchro = 0x2000;
const raceWarrior = 0x1;
const attributeWind = 0x10;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasTurboScript)("Lua real script Turbo Warrior attack target protection stat", () => {
  it("restores attack-announced Synchro ATK halve and Level-gated effect-target protection", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${turboCode}.lua`);
    expectTurboScriptShape(script);

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 46195773, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [], extra: [turboCode] },
      1: { main: [lowLevelTargeterCode, highLevelTargeterCode], extra: [synchroTargetCode] },
    });
    startDuel(session);

    const turbo = requireCard(session, turboCode);
    const synchroTarget = requireCard(session, synchroTargetCode);
    const lowLevelTargeter = requireCard(session, lowLevelTargeterCode);
    const highLevelTargeter = requireCard(session, highLevelTargeterCode);
    moveFaceUpAttack(session, turbo, 0, 0);
    moveFaceUpAttack(session, synchroTarget, 1, 0);
    moveDuelCard(session.state, lowLevelTargeter.uid, "hand", 1);
    moveDuelCard(session.state, highLevelTargeter.uid, "hand", 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(turboCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === turbo.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
      valuePredicate: typeof effect.valuePredicate,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", property: 263168, range: ["monsterZone"], triggerEvent: undefined, valuePredicate: "undefined" },
      { category: 0x200000, code: 1130, event: "trigger", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "attackDeclared", valuePredicate: "undefined" },
      { category: undefined, code: 71, event: "continuous", property: 0x20000, range: ["monsterZone"], triggerEvent: undefined, valuePredicate: "function" },
    ]);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    expect(restoredBattle.host.loadScript(effectTargetProbe(turboCode, lowLevelTargeterCode, highLevelTargeterCode), "turbo-warrior-target-probe.lua").ok).toBe(true);
    expect(restoredBattle.host.messages).toContain("turbo warrior target protection false/true");

    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === turbo.uid && action.targetUid === synchroTarget.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, attack!);
    expect(restoredBattle.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventName: trigger.eventName,
      eventPlayer: trigger.eventPlayer,
      eventReason: trigger.eventReason,
      eventTriggerTiming: trigger.eventTriggerTiming,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: "lua-3-1130",
        eventCardUid: turbo.uid,
        eventName: "attackDeclared",
        eventPlayer: 0,
        eventReason: 0,
        eventTriggerTiming: "when",
        player: 0,
        sourceUid: turbo.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === turbo.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);

    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === synchroTarget.uid), restoredTrigger.session.state)).toBe(1400);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === synchroTarget.uid && effect.code === 102).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: 102, reset: { flags: 1073741856 }, sourceUid: synchroTarget.uid, value: 1400 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "attackDeclared")).toEqual([
      {
        eventName: "attackDeclared",
        eventCode: 1130,
        eventCardUid: turbo.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventUids: [turbo.uid, synchroTarget.uid],
        eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: turboCode, name: "Turbo Warrior", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceWarrior, attribute: attributeWind, level: 6, attack: 2500, defense: 1500 },
    { code: synchroTargetCode, name: "Turbo Warrior Synchro Target", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceWarrior, attribute: attributeDark, level: 8, attack: 2800, defense: 2000 },
    { code: lowLevelTargeterCode, name: "Turbo Warrior Low-Level Targeter", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: highLevelTargeterCode, name: "Turbo Warrior High-Level Targeter", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 7, attack: 2400, defense: 1000 },
  ];
}

function expectTurboScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Synchro.AddProcedure(c,s.tfilter,1,1,Synchro.NonTuner(nil),1,99)");
  expect(script).toContain("s.material={67270095}");
  expect(script).toContain("return c:IsSummonCode(scard,sumtype,tp,67270095) or c:IsHasEffect(20932152)");
  expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e1:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("d:CreateEffectRelation(e)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_POSITION,d,1,0,0)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e1:SetValue(d:GetAttack()/2)");
  expect(script).toContain("e2:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_SINGLE_RANGE)");
  expect(script).toContain("return re:GetHandler():IsLevelBelow(6)");
}

function effectTargetProbe(targetCode: string, lowLevelCode: string, highLevelCode: string): string {
  return `
    local target=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${targetCode}),0,LOCATION_MZONE,0,nil)
    local low=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${lowLevelCode}),1,LOCATION_HAND,0,nil)
    local high=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${highLevelCode}),1,LOCATION_HAND,0,nil)
    local low_effect=Effect.CreateEffect(low)
    local high_effect=Effect.CreateEffect(high)
    Debug.Message("turbo warrior target protection " .. tostring(target:IsCanBeEffectTarget(low_effect)) .. "/" .. tostring(target:IsCanBeEffectTarget(high_effect)))
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
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
