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
const cascadeCode = "27012990";
const linkMarincessCode = "270129900";
const targetCode = "270129901";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCascadeScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${cascadeCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const typeTrap = 0x4;
const setMarincess = 0x12b;
const raceCyberse = 0x1000000;
const attributeWater = 0x2;
const effectUpdateAttack = 100;
const standbyPhaseCode = 0x1002;

describe.skipIf(!hasUpstreamScripts || !hasCascadeScript)("Lua real script Marincess Cascade hand Trap banish return stat", () => {
  it("restores hand Trap activation, temporary Marincess Link banish cost, ATK gain, and Standby return", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${cascadeCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 27012990, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [cascadeCode, targetCode], extra: [linkMarincessCode] }, 1: { main: [] } });
    startDuel(session);
    const cascade = requireCard(session, cascadeCode);
    const marincessLink = requireCard(session, linkMarincessCode);
    const target = requireCard(session, targetCode);
    moveDuelCard(session.state, cascade.uid, "hand", 0);
    moveFaceUpAttack(session, marincessLink, 0, 1);
    moveFaceUpAttack(session, target, 0, 2);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(cascadeCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const activate = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === cascade.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, activate!);
    resolveRestoredChain(restored);

    expect(findCard(restored.session, marincessLink.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost | duelReason.temporary,
      reasonPlayer: 0,
      reasonCardUid: cascade.uid,
      reasonEffectId: 1,
    });
    expect(findCard(restored.session, cascade.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.rule,
      reasonPlayer: 0,
    });
    expect(currentAttack(findCard(restored.session, target.uid), restored.session.state)).toBe(2700);
    expect(restored.session.state.effects.filter((effect) =>
      effect.sourceUid === target.uid && effect.code === effectUpdateAttack
    ).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107169792 }, sourceUid: target.uid, value: 900 },
    ]);
    expect(restored.session.state.effects.filter((effect) =>
      effect.sourceUid === cascade.uid && effect.code === standbyPhaseCode
    ).map((effect) => ({
      code: effect.code,
      labelObjectUids: effect.labelObjectUids,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
    }))).toEqual([
      { code: standbyPhaseCode, labelObjectUids: [marincessLink.uid], reset: { flags: 1342177282 }, sourceUid: cascade.uid },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => ["becameTarget", "banished", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      relatedEffectId: event.relatedEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventCardUid: marincessLink.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.cost | duelReason.temporary, eventReasonCardUid: cascade.uid, eventReasonEffectId: 1, eventReasonPlayer: 0, relatedEffectId: undefined, previousLocation: "monsterZone", currentLocation: "banished" },
      { eventCardUid: target.uid, eventCode: 1028, eventName: "becameTarget", eventReason: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, relatedEffectId: 1, previousLocation: "deck", currentLocation: "monsterZone" },
      { eventCardUid: cascade.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.rule, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, relatedEffectId: undefined, previousLocation: "spellTrapZone", currentLocation: "graveyard" },
    ]);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });

    const restoredReturn = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expectCleanRestore(restoredReturn);
    restoredReturn.session.state.turnPlayer = 0;
    restoredReturn.session.state.phase = "draw";
    restoredReturn.session.state.waitingFor = 0;
    expectRestoredLegalActions(restoredReturn, 0);
    const standby = getLuaRestoreLegalActions(restoredReturn, 0).find((action) => action.type === "changePhase" && action.phase === "standby");
    expect(standby, JSON.stringify(getLuaRestoreLegalActions(restoredReturn, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredReturn, standby!);
    expect(findCard(restoredReturn.session, marincessLink.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: cascade.uid,
      reasonEffectId: 3,
    });
  });
});

function cards(): DuelCardData[] {
  return [
    { code: cascadeCode, name: "Marincess Cascade", kind: "trap", typeFlags: typeTrap },
    { code: linkMarincessCode, name: "Cascade Link-3 Marincess", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, setcodes: [setMarincess], race: raceCyberse, attribute: attributeWater, level: 3, attack: 2300, defense: 0, linkMarkers: 0x2a },
    { code: targetCode, name: "Cascade Face-up ATK Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeWater, level: 4, attack: 1800, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Marincess Cascade");
  expect(script).toContain("EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP");
  expect(script).toContain("aux.StatChangeDamageStepCondition");
  expect(script).toContain("c:IsFaceup() and c:IsLinkMonster() and c:IsSetCard(SET_MARINCESS)");
  expect(script).toContain("Duel.GetTargetCount(Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
  expect(script).toContain("aux.SelectUnselectGroup(mg,e,tp,1,ct,s.rescon,1,tp,HINTMSG_REMOVE,nil,nil)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST|REASON_TEMPORARY)");
  expect(script).toContain("Duel.RegisterEffect(e1,tp)");
  expect(script).toContain("Duel.ReturnToField(c)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("e:GetLabelObject():GetSum(Card.GetLink)*300");
  expect(script).toContain("EFFECT_UPDATE_ATTACK");
  expect(script).toContain("EFFECT_TRAP_ACT_IN_HAND");
  expect(script).toContain("c:IsFaceup() and c:IsSetCard(SET_MARINCESS) and c:IsLinkMonster() and c:IsLinkAbove(3)");
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
