import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const overwindCode = "24920410";
const windUpTargetCode = "249204100";
const nonWindUpCode = "249204101";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasOverwindScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${overwindCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const setWindUp = 0x58;
const effectSetAttackFinal = 102;
const effectSetDefenseFinal = 106;
const eventPhaseEnd = 0x1200;

describe.skipIf(!hasUpstreamScripts || !hasOverwindScript)("Lua real script Overwind damage-step End Phase to-hand stat", () => {
  it("restores Damage Step Wind-Up targeting into final stat doubling and End Phase self-return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${overwindCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 24920410, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [overwindCode, windUpTargetCode, nonWindUpCode] }, 1: { main: [] } });
    startDuel(session);
    const overwind = requireCard(session, overwindCode);
    const target = requireCard(session, windUpTargetCode);
    const nonWindUp = requireCard(session, nonWindUpCode);
    moveDuelCard(session.state, overwind.uid, "hand", 0);
    moveFaceUpAttack(session, target, 0, 0);
    moveFaceUpAttack(session, nonWindUp, 0, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(overwindCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const activate = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === overwind.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    expect(JSON.stringify(activate)).not.toContain(nonWindUp.uid);
    applyRestoredActionAndAssert(restored, activate!);
    resolveRestoredChain(restored);

    expect(findCard(restored.session, overwind.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(currentAttack(findCard(restored.session, target.uid), restored.session.state)).toBe(2400);
    expect(currentDefense(findCard(restored.session, target.uid), restored.session.state)).toBe(3200);
    expect(currentAttack(findCard(restored.session, nonWindUp.uid), restored.session.state)).toBe(900);
    expect(restored.session.state.effects.filter((effect) =>
      effect.sourceUid === target.uid && [effectSetAttackFinal, effectSetDefenseFinal, eventPhaseEnd].includes(effect.code ?? -1)
    ).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: effectSetAttackFinal, event: "continuous", range: ["monsterZone"], reset: { flags: 33427456 }, value: 2400 },
      { code: effectSetDefenseFinal, event: "continuous", range: ["monsterZone"], reset: { flags: 33427456 }, value: 3200 },
      { code: eventPhaseEnd, event: "continuous", range: ["monsterZone"], reset: { flags: 1107169792 }, value: undefined },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["becameTarget", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
    }))).toEqual([
      { eventCardUid: target.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonPlayer: 0, relatedEffectId: 1 },
      { eventCardUid: overwind.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.rule, eventReasonPlayer: 0, relatedEffectId: undefined },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredEndPhase = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredEndPhase);
    restoredEndPhase.session.state.phase = "main2";
    restoredEndPhase.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredEndPhase, 0);
    const endPhase = getLuaRestoreLegalActions(restoredEndPhase, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(endPhase, JSON.stringify(getLuaRestoreLegalActions(restoredEndPhase, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEndPhase, endPhase!);
    expect(findCard(restoredEndPhase.session, target.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: target.uid,
      reasonEffectId: 4,
    });
    expect(restoredEndPhase.session.state.eventHistory.filter((event) => event.eventName === "sentToHand").map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      {
        eventCardUid: target.uid,
        eventCode: 1012,
        eventName: "sentToHand",
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: target.uid,
        eventReasonEffectId: 4,
        previousLocation: "monsterZone",
        currentLocation: "hand",
      },
    ]);
    expect(restoredEndPhase.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: overwindCode, name: "Overwind", kind: "spell", typeFlags: 0x2 | 0x10000 },
    { code: windUpTargetCode, name: "Overwind Wind-Up Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setWindUp], level: 4, attack: 1200, defense: 1600 },
    { code: nonWindUpCode, name: "Overwind Non-Wind-Up Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 900, defense: 900 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Overwind");
  expect(script).toContain("e1:SetHintTiming(TIMING_DAMAGE_STEP)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
  expect(script).toContain("e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)");
  expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
  expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_WIND_UP)");
  expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)");
  expect(script).toContain("Duel.GetFirstTarget()");
  expect(script).toContain("e1:SetCode(EFFECT_SET_ATTACK_FINAL)");
  expect(script).toContain("e2:SetCode(EFFECT_SET_DEFENSE_FINAL)");
  expect(script).toContain("e3:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("Duel.SendtoHand(e:GetHandler(),nil,REASON_EFFECT)");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
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
