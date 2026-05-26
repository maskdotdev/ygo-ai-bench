import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter, getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const movingPointCode = "5208118";
const pendulumCode = "52081180";
const fusionCode = "52081181";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMovingPointScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${movingPointCode}.lua`));
const tCounter = 0x218;
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const typePendulum = 0x1000000;
const typeSpell = 0x2;
const typeContinuous = 0x20000;
const raceSpellcaster = 0x80;
const raceMachine = 0x20;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasMovingPointScript)("Lua real script Moving Point Pendulum counter column damage", () => {
  it("restores T Counter quick effect into adjacent move, column destroy, and previous-ATK damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${movingPointCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 5208118, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [movingPointCode, pendulumCode] }, 1: { main: [fusionCode] } });
    startDuel(session);
    const movingPoint = requireCard(session, movingPointCode);
    const pendulum = requireCard(session, pendulumCode);
    const fusion = requireCard(session, fusionCode);
    moveFaceUpSpell(session, movingPoint, 0, 0);
    moveFaceUpAttack(session, pendulum, 0, 2);
    moveFaceUpAttack(session, fusion, 1, 1);
    expect(addDuelCardCounter(movingPoint, tCounter, 1)).toBe(true);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(movingPointCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const quick = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === movingPoint.uid);
    expect(quick, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestored(restoredOpen, quick!);
    passRestoredChain(restoredOpen);

    expect(getDuelCardCounter(restoredOpen.session.state.cards.find((card) => card.uid === movingPoint.uid), tCounter)).toBe(1);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === pendulum.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      sequence: 1,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === fusion.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.destroy | duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: movingPoint.uid,
      reasonEffectId: 4,
    });
    expect(restoredOpen.session.state.players[1].lifePoints).toBe(5700);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["becameTarget", "breakEffect", "destroyed", "damageDealt"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "becameTarget", eventCardUid: pendulum.uid, eventPlayer: undefined, eventValue: undefined, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 4, previous: "deck", current: "monsterZone" },
      { eventName: "breakEffect", eventCardUid: undefined, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: movingPoint.uid, eventReasonEffectId: 4, relatedEffectId: undefined, previous: undefined, current: undefined },
      { eventName: "destroyed", eventCardUid: fusion.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.destroy | duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: movingPoint.uid, eventReasonEffectId: 4, relatedEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "damageDealt", eventCardUid: undefined, eventPlayer: 1, eventValue: 2300, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: movingPoint.uid, eventReasonEffectId: 4, relatedEffectId: undefined, previous: undefined, current: undefined },
    ]);
    expect(restoredOpen.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Moving Point Pendulum");
  expect(script).toContain("c:EnableCounterPermit(COUNTER_T)");
  expect(script).toContain("e0:SetType(EFFECT_TYPE_ACTIVATE)");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e1:SetCode(EVENT_PHASE+PHASE_STANDBY)");
  expect(script).toContain("e:GetHandler():AddCounter(COUNTER_T,1)");
  expect(script).toContain("e2:SetCategory(CATEGORY_DESTROY+CATEGORY_DAMAGE)");
  expect(script).toContain("Duel.SelectTarget(tp,s.movefilter,tp,LOCATION_MMZONE,0,1,1,nil)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_DESTROY,nil,1,1-tp,LOCATION_MZONE)");
  expect(script).toContain("tc:MoveAdjacent()");
  expect(script).toContain("tc:GetColumnGroup():Match(s.desfilter,nil,opp,tc:GetScale())");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("Duel.Destroy(column_g,REASON_EFFECT)");
  expect(script).toContain("Duel.GetOperatedGroup():GetSum(Card.GetPreviousAttackOnField)");
  expect(script).toContain("Duel.Damage(opp,total_atk,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: movingPointCode, name: "Moving Point Pendulum", kind: "spell", typeFlags: typeSpell | typeContinuous },
    { code: pendulumCode, name: "Moving Point Pendulum Monster", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 1200, defense: 1200, leftScale: 4, rightScale: 4 },
    { code: fusionCode, name: "Moving Point Fusion Target", kind: "extra", typeFlags: typeMonster | typeEffect | typeFusion, race: raceMachine, attribute: attributeDark, level: 4, attack: 2300, defense: 1600 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function moveFaceUpSpell(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
  moved.sequence = sequence;
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

function applyRestored(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
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
    applyRestored(restored, pass!);
  }
}
