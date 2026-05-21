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
const gingerbreadCode = "79922118";
const destroyTargetACode = "799221180";
const destroyTargetBCode = "799221181";
const survivorCode = "799221182";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasGingerbreadScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${gingerbreadCode}.lua`));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typeContinuous = 0x20000;
const raceFiend = 0x8;
const attributeDark = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasGingerbreadScript)("Lua real script Gingerbread House standby stat destroy recover", () => {
  it("restores opponent Standby ATK gain into BreakEffect destroy and recovery count", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${gingerbreadCode}.lua`);
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("e1:SetCode(EVENT_FREE_CHAIN)");
    expect(script).toContain("e2:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DESTROY)");
    expect(script).toContain("e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)");
    expect(script).toContain("e2:SetCode(EVENT_PHASE|PHASE_STANDBY)");
    expect(script).toContain("e2:SetRange(LOCATION_SZONE)");
    expect(script).toContain("return Duel.IsTurnPlayer(1-tp)");
    expect(script).toContain("return c:IsFaceup() and c:GetAttack()+600>=2500");
    expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsFaceup,tp,0,LOCATION_MZONE,1,nil)");
    expect(script).toContain("Duel.GetMatchingGroup(s.desfilter,tp,0,LOCATION_MZONE,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,#g,0,0)");
    expect(script).toContain("for tc in aux.Next(g) do");
    expect(script).toContain("tc:UpdateAttack(600,nil,c)==600");
    expect(script).toContain("local dg=g:Filter(Card.IsAttackAbove,nil,2500)");
    expect(script).toContain("Duel.BreakEffect()");
    expect(script).toContain("local ct=Duel.Destroy(dg,REASON_EFFECT)");
    expect(script).toContain("Duel.Recover(tp,ct*500,REASON_EFFECT)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 79922118, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [gingerbreadCode] },
      1: { main: [destroyTargetACode, destroyTargetBCode, survivorCode] },
    });
    startDuel(session);
    const gingerbread = requireCard(session, gingerbreadCode);
    const destroyTargetA = requireCard(session, destroyTargetACode);
    const destroyTargetB = requireCard(session, destroyTargetBCode);
    const survivor = requireCard(session, survivorCode);
    moveFaceUpSpell(session, gingerbread, 0);
    moveFaceUpAttack(session, destroyTargetA, 1, 0);
    moveFaceUpAttack(session, destroyTargetB, 1, 1);
    moveFaceUpAttack(session, survivor, 1, 2);
    session.state.turn = 2;
    session.state.turnPlayer = 1;
    session.state.phase = "draw";
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(gingerbreadCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredDraw = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredDraw);
    expectRestoredLegalActions(restoredDraw, 1);
    const standby = getLuaRestoreLegalActions(restoredDraw, 1).find((action) => action.type === "changePhase" && action.phase === "standby");
    expect(standby, JSON.stringify(getLuaRestoreLegalActions(restoredDraw, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDraw, standby!);
    expect(restoredDraw.session.state.phase).toBe("standby");
    expect(restoredDraw.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-2-4098", eventCode: 0x1002, eventName: "phaseStandby", player: 0, sourceUid: gingerbread.uid, triggerBucket: "opponentOptional" },
    ]);
    expect(restoredDraw.session.state.eventHistory.filter((event) => event.eventName === "phaseStandby")).toEqual([
      { eventName: "phaseStandby", eventCode: 0x1002 },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDraw.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === gingerbread.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    expect(JSON.stringify(trigger)).not.toContain("operationInfos");
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === gingerbread.uid)).toMatchObject({
      location: "spellTrapZone",
      controller: 0,
      faceUp: true,
    });
    for (const destroyed of [destroyTargetA, destroyTargetB]) {
      expect(restoredTrigger.session.state.cards.find((card) => card.uid === destroyed.uid)).toMatchObject({
        location: "graveyard",
        controller: 1,
        reason: duelReason.effect | duelReason.destroy,
        reasonPlayer: 0,
        reasonCardUid: gingerbread.uid,
        reasonEffectId: 2,
      });
    }
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === survivor.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
    });
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === survivor.uid), restoredTrigger.session.state)).toBe(2300);
    expect(restoredTrigger.session.state.players[0].lifePoints).toBe(9000);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["phaseStandby", "breakEffect", "destroyed", "recoveredLifePoints"].includes(event.eventName)).map((event) => ({
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
      { eventName: "phaseStandby", eventCode: 0x1002, eventCardUid: undefined, eventPlayer: undefined, eventValue: undefined, eventReason: undefined, eventReasonPlayer: undefined, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previousLocation: undefined, currentLocation: undefined },
      { eventName: "breakEffect", eventCode: 1050, eventCardUid: undefined, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: gingerbread.uid, eventReasonEffectId: 2, previousLocation: undefined, currentLocation: undefined },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: destroyTargetA.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: gingerbread.uid, eventReasonEffectId: 2, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: destroyTargetB.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: gingerbread.uid, eventReasonEffectId: 2, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: destroyTargetA.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: gingerbread.uid, eventReasonEffectId: 2, previousLocation: "monsterZone", currentLocation: "graveyard" },
      { eventName: "recoveredLifePoints", eventCode: 1112, eventCardUid: undefined, eventPlayer: 0, eventValue: 1000, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: gingerbread.uid, eventReasonEffectId: 2, previousLocation: undefined, currentLocation: undefined },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: gingerbreadCode, name: "Gingerbread House", kind: "spell", typeFlags: typeSpell | typeContinuous },
    { code: destroyTargetACode, name: "Gingerbread House Destroy Target A", kind: "monster", typeFlags: typeMonster, race: raceFiend, attribute: attributeDark, level: 4, attack: 1900, defense: 1200 },
    { code: destroyTargetBCode, name: "Gingerbread House Destroy Target B", kind: "monster", typeFlags: typeMonster, race: raceFiend, attribute: attributeDark, level: 4, attack: 2400, defense: 1200 },
    { code: survivorCode, name: "Gingerbread House Survivor", kind: "monster", typeFlags: typeMonster, race: raceFiend, attribute: attributeDark, level: 4, attack: 1700, defense: 1200 },
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

function moveFaceUpSpell(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", player);
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
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
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
