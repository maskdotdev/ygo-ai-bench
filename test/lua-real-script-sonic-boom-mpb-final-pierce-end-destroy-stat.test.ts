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
const sonicBoomCode = "93211810";
const targetCode = "932118100";
const otherMachineCode = "932118101";
const opponentTargetCode = "932118102";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSonicBoomScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${sonicBoomCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeQuickPlay = 0x10000;
const typeEffect = 0x20;
const raceMachine = 0x20;
const attributeWind = 0x8;
const setMechaPhantomBeast = 0x101b;
const effectImmuneEffect = 1;
const effectCannotAttack = 85;
const effectSetAttackFinal = 102;
const effectPierce = 203;
const phaseEndCode = 0x1200;

describe.skipIf(!hasUpstreamScripts || !hasSonicBoomScript)("Lua real script Sonic Boom MPB final pierce end destroy stat", () => {
  it("restores Mecha Phantom Beast final ATK, pierce and immunity grants, attack oath, and End Phase Machine destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${sonicBoomCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 93211810, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [sonicBoomCode, targetCode, otherMachineCode] },
      1: { main: [opponentTargetCode] },
    });
    startDuel(session);
    const sonicBoom = requireCard(session, sonicBoomCode);
    const target = requireCard(session, targetCode);
    const otherMachine = requireCard(session, otherMachineCode);
    const opponentTarget = requireCard(session, opponentTargetCode);
    moveDuelCard(session.state, sonicBoom.uid, "hand", 0);
    moveFaceUpAttack(session, target, 0, 0);
    moveFaceUpAttack(session, otherMachine, 0, 1);
    moveFaceUpAttack(session, opponentTarget, 1, 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sonicBoomCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "activateEffect" && action.uid === sonicBoom.uid && action.effectId === "lua-1-1002"
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activate!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === sonicBoom.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === target.uid), restoredOpen.session.state)).toBe(3000);
    expect(restoredOpen.session.state.effects.filter((effect) => [effectCannotAttack, effectSetAttackFinal, effectPierce, effectImmuneEffect, phaseEndCode].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      label: effect.label,
      property: effect.property,
      range: effect.range,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      targetRange: effect.targetRange,
      triggerEvent: effect.triggerEvent,
      value: effect.value,
    }))).toEqual([
      { code: effectCannotAttack, event: "continuous", label: target.fieldId, property: 0x80000, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], reset: { flags: 1073742336 }, sourceUid: sonicBoom.uid, targetRange: [4, 0], triggerEvent: undefined, value: undefined },
      { code: effectSetAttackFinal, event: "continuous", label: undefined, property: undefined, range: ["monsterZone"], reset: { flags: 1107169792 }, sourceUid: target.uid, targetRange: undefined, triggerEvent: undefined, value: 3000 },
      { code: effectPierce, event: "continuous", label: undefined, property: 0x4000000, range: ["monsterZone"], reset: { flags: 1107169792 }, sourceUid: target.uid, targetRange: undefined, triggerEvent: undefined, value: undefined },
      { code: effectImmuneEffect, event: "continuous", label: undefined, property: 0x4020000, range: ["monsterZone"], reset: { flags: 1107169792 }, sourceUid: target.uid, targetRange: undefined, triggerEvent: undefined, value: undefined },
      { code: phaseEndCode, event: "continuous", label: undefined, property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], reset: { flags: 1073742336 }, sourceUid: sonicBoom.uid, targetRange: undefined, triggerEvent: undefined, value: undefined },
    ]);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["becameTarget", "sentToGraveyard"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: target.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 2 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        relatedEffectId: 1,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: sonicBoom.uid,
        eventReason: duelReason.rule,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
      },
    ]);

    const restoredBattle = restoredOpen;
    restoredBattle.session.state.phase = "battle";
    restoredBattle.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredBattle, 0);
    const targetAttacks = getLuaRestoreLegalActions(restoredBattle, 0).filter((action) => action.type === "declareAttack" && action.attackerUid === target.uid);
    const otherAttacks = getLuaRestoreLegalActions(restoredBattle, 0).filter((action) => action.type === "declareAttack" && action.attackerUid === otherMachine.uid);
    expect(targetAttacks).toHaveLength(1);
    expect(otherAttacks).toEqual([]);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    restoredBattle.session.state.phase = "main2";
    restoredBattle.session.state.waitingFor = 0;
    const endPhase = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(endPhase, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    const beforeEndHistoryLength = restoredBattle.session.state.eventHistory.length;
    applyRestoredActionAndAssert(restoredBattle, endPhase!);
    expect(restoredBattle.session.state.pendingTriggers).toEqual([]);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject(endDestroyedState(sonicBoom.uid, 8));
    expect(restoredBattle.session.state.cards.find((card) => card.uid === otherMachine.uid)).toMatchObject(endDestroyedState(sonicBoom.uid, 8));
    expect(restoredBattle.session.state.cards.find((card) => card.uid === opponentTarget.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredBattle.session.state.eventHistory.slice(beforeEndHistoryLength).filter((event) => ["phaseEnd", "destroyed", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      eventUids: event.eventUids,
    }))).toEqual([
      { eventCardUid: target.uid, eventCode: 1029, eventName: "destroyed", eventReason: duelReason.effect | duelReason.destroy, eventReasonCardUid: sonicBoom.uid, eventReasonEffectId: 8, eventReasonPlayer: 0, eventUids: undefined },
      { eventCardUid: target.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect | duelReason.destroy, eventReasonCardUid: sonicBoom.uid, eventReasonEffectId: 8, eventReasonPlayer: 0, eventUids: undefined },
      { eventCardUid: otherMachine.uid, eventCode: 1029, eventName: "destroyed", eventReason: duelReason.effect | duelReason.destroy, eventReasonCardUid: sonicBoom.uid, eventReasonEffectId: 8, eventReasonPlayer: 0, eventUids: undefined },
      { eventCardUid: otherMachine.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect | duelReason.destroy, eventReasonCardUid: sonicBoom.uid, eventReasonEffectId: 8, eventReasonPlayer: 0, eventUids: undefined },
      { eventCardUid: target.uid, eventCode: 1029, eventName: "destroyed", eventReason: duelReason.effect | duelReason.destroy, eventReasonCardUid: sonicBoom.uid, eventReasonEffectId: 8, eventReasonPlayer: 0, eventUids: [target.uid, otherMachine.uid] },
      { eventCardUid: undefined, eventCode: phaseEndCode, eventName: "phaseEnd", eventReason: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: undefined, eventUids: undefined },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Sonic Boom");
  expect(script).toContain("aux.GlobalCheck(s,function()");
  expect(script).toContain("ge1:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("aux.AddValuesReset(function()");
  expect(script).toContain("aux.StatChangeDamageStepCondition()");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil,tp)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_ATTACK)");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e2:SetCode(EFFECT_PIERCE)");
  expect(script).toContain("e3:SetCode(EFFECT_IMMUNE_EFFECT)");
  expect(script).toContain("e4:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: sonicBoomCode, name: "Sonic Boom", kind: "spell", typeFlags: typeSpell | typeQuickPlay },
    { code: targetCode, name: "Sonic Boom Mecha Phantom Beast", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeWind, setcodes: [setMechaPhantomBeast], level: 4, attack: 1500, defense: 1000 },
    { code: otherMachineCode, name: "Sonic Boom Other Machine", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeWind, level: 4, attack: 1200, defense: 1000 },
    { code: opponentTargetCode, name: "Sonic Boom Opponent Machine", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeWind, level: 4, attack: 1000, defense: 1000 },
  ];
}

function endDestroyedState(sourceUid: string, reasonEffectId: number) {
  return {
    location: "graveyard",
    reason: duelReason.effect | duelReason.destroy,
    reasonPlayer: 0,
    reasonCardUid: sourceUid,
    reasonEffectId,
  };
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
