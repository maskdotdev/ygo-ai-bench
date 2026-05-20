import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const shuttleroidCode = "10449150";
const hasShuttleroidScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${shuttleroidCode}.lua`));
const attackerCode = "104491500";
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasShuttleroidScript)("Lua real script Shuttleroid battle-target flag return damage", () => {
  it("restores battle-target banish flag into self Standby return and special-summon damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${shuttleroidCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_BE_BATTLE_TARGET)");
    expect(script).toContain("Duel.Remove(c,POS_FACEUP,REASON_EFFECT)");
    expect(script).toContain("c:RegisterFlagEffect(id,RESET_EVENT|RESETS_STANDARD|RESET_PHASE|PHASE_STANDBY|RESET_SELF_TURN,0,1)");
    expect(script).toContain("e2:SetCode(EVENT_PHASE|PHASE_STANDBY)");
    expect(script).toContain("return e:GetHandler():GetFlagEffect(id)~=0");
    expect(script).toContain("e:GetHandler():ResetFlagEffect(id)");
    expect(script).toContain("Duel.SpecialSummon(c,1,tp,tp,false,false,POS_FACEUP)");
    expect(script).toContain("return e:GetHandler():GetSummonType()==SUMMON_TYPE_SPECIAL+1");
    expect(script).toContain("Duel.SetTargetParam(1000)");
    expect(script).toContain("Duel.Damage(p,d,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      { code: shuttleroidCode, name: "Shuttleroid", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1200 },
      { code: attackerCode, name: "Shuttleroid Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 10449150, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [shuttleroidCode] }, 1: { main: [attackerCode] } });
    startDuel(session);

    const shuttle = requireCard(session, shuttleroidCode);
    const attacker = requireCard(session, attackerCode);
    moveFaceUpAttack(session, shuttle.uid, 0);
    moveFaceUpAttack(session, attacker.uid, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(shuttleroidCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 1).find((action) => action.type === "declareAttack" && action.attackerUid === attacker.uid && action.targetUid === shuttle.uid);
    expect(attack, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);

    const restoredTargeted = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTargeted);
    expectRestoredLegalActions(restoredTargeted, 0);
    expect(restoredTargeted.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-3-1",
        effectId: "lua-1-1131",
        sourceUid: shuttle.uid,
        player: 0,
        triggerBucket: "opponentOptional",
        eventName: "battleTargeted",
        eventCode: 1131,
        eventCardUid: shuttle.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
    ]);
    const banishTrigger = getLuaRestoreLegalActions(restoredTargeted, 0).find((action) => action.type === "activateTrigger" && action.uid === shuttle.uid);
    expect(banishTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredTargeted, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTargeted, banishTrigger!);
    expect(restoredTargeted.session.state.chain).toEqual([]);
    expect(restoredTargeted.session.state.cards.find((card) => card.uid === shuttle.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: shuttle.uid,
      reasonEffectId: 1,
    });
    expect(restoredTargeted.session.state.flagEffects.filter((flag) => flag.ownerType === "card" && flag.ownerId === shuttle.uid)).toEqual([
      {
        ownerType: "card",
        ownerId: shuttle.uid,
        code: Number(shuttleroidCode),
        reset: 1375604738,
        resetCount: 1,
        property: 0,
        value: 0,
        turn: 1,
      },
    ]);
    expect(restoredTargeted.session.state.eventHistory.filter((event) => event.eventName === "banished" && event.eventCardUid === shuttle.uid)).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: shuttle.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: shuttle.uid,
        eventReasonEffectId: 1,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "banished", position: "faceUpAttack", sequence: 0 },
      },
    ]);

    restoredTargeted.session.state.turn = 2;
    restoredTargeted.session.state.turnPlayer = 0;
    restoredTargeted.session.state.phase = "draw";
    restoredTargeted.session.state.waitingFor = 0;
    delete restoredTargeted.session.state.currentAttack;
    delete restoredTargeted.session.state.pendingBattle;
    delete restoredTargeted.session.state.battleStep;
    delete restoredTargeted.session.state.battleWindow;
    const restoredDraw = restoreDuelWithLuaScripts(serializeDuel(restoredTargeted.session), workspace, reader);
    expectCleanRestore(restoredDraw);
    expectRestoredLegalActions(restoredDraw, 0);
    const standby = getLuaRestoreLegalActions(restoredDraw, 0).find((action) => action.type === "changePhase" && action.phase === "standby");
    expect(standby, JSON.stringify(getLuaRestoreLegalActions(restoredDraw, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDraw, standby!);
    expect(restoredDraw.session.state.pendingTriggers).toEqual([
      {
        id: "trigger-7-1",
        effectId: "lua-2-4098",
        sourceUid: shuttle.uid,
        player: 0,
        triggerBucket: "turnMandatory",
        eventName: "phaseStandby",
        eventCode: 0x1002,
        eventTriggerTiming: "when",
      },
    ]);

    const restoredReturn = restoreDuelWithLuaScripts(serializeDuel(restoredDraw.session), workspace, reader);
    expectCleanRestore(restoredReturn);
    expectRestoredLegalActions(restoredReturn, 0);
    const returnTrigger = getLuaRestoreLegalActions(restoredReturn, 0).find((action) => action.type === "activateTrigger" && action.uid === shuttle.uid);
    expect(returnTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredReturn, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredReturn, returnTrigger!);
    expect(restoredReturn.session.state.cards.find((card) => card.uid === shuttle.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: shuttle.uid,
      reasonEffectId: 2,
    });
    expect(restoredReturn.session.state.flagEffects.filter((flag) => flag.ownerType === "card" && flag.ownerId === shuttle.uid)).toEqual([]);

    const restoredDamage = restoreDuelWithLuaScripts(serializeDuel(restoredReturn.session), workspace, reader);
    expectCleanRestore(restoredDamage);
    expectRestoredLegalActions(restoredDamage, 0);
    const damageTrigger = getLuaRestoreLegalActions(restoredDamage, 0).find((action) => action.type === "activateTrigger" && action.uid === shuttle.uid);
    expect(damageTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDamage, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDamage, damageTrigger!);
    expect(restoredDamage.session.state.chain).toEqual([]);
    expect(restoredDamage.session.state.players[1].lifePoints).toBe(7000);
    expect(restoredDamage.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 1000,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: shuttle.uid,
        eventReasonEffectId: 3,
      },
    ]);
    expect(restoredDamage.host.messages).not.toContain("attempt to call a nil value");
  });
});

function moveFaceUpAttack(session: DuelSession, uid: string, controller: 0 | 1): void {
  const card = moveDuelCard(session.state, uid, "monsterZone", controller);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const player = session.state.waitingFor ?? session.state.turnPlayer;
  expect(response.legalActions).toEqual(getLegalActions(session, player));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}
